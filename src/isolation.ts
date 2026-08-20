/**
 * Per-conversation MCP isolation, applied live to a running agent.
 *
 * This replaces the old design's fatal shortcut — restrict only once at
 * `agent/created`, discarding the disposers and never reflecting later
 * selection changes. That made conversation-level MCP toggles impossible
 * after the conversation started.
 *
 * Key properties of the new engine:
 *
 * - **No sessionId-keyed table.** Runtime state lives in a `WeakMap` keyed by
 *   the live `Agent` object and every Cordis effect (restrict, guard,
 *   tools/change listener) is registered on `agent.ctx`, so disposing the
 *   agent unwinds it all automatically. No sync-cleanup, no orphan handles.
 *   The DURABLE source of truth is the per-session blacklist file (see
 *   session-select.ts); this class only *applies* that file to a live agent.
 *
 * - **Anytime toggling.** `apply(agent, selection)` swaps the current deny set
 *   (dispose the previous restriction, then re-restrict) each time the user
 *   changes the conversation's selection — not just at creation.
 *
 * - **Reactive to async MCP startup.** MCP servers connect asynchronously, so
 *   their `mcp__<server>__<tool>` names may not exist at `agent/created`. We
 *   only ever deny names that are *currently* registered (querying the HOST,
 *   global schema surface, so the deny set is stable regardless of earlier
 *   restrictions), and a scope-local `tools/change` listener re-syncs. When
 *   `restrict()` rejects an as-yet-unknown name we stay quiet and let the next
 *   change event retry — never throw out of the host.
 *
 * - **Guard safety net.** A live `guard` (reads the *current* selection, not a
 *   snapshot) denies dispatch for a blacklisted server's tool that somehow
 *   slipped through before the next schema refresh.
 *
 * Blacklist (deny-list) semantics: the default (empty selection) injects every
 * globally-enabled candidate; a conversation lists only what to KEEP OUT, and
 * those `mcp__` tools are denied on this agent's own scope (per server). Skills
 * are kept in the selection model for the UI, but tool-level hiding is not
 * implemented (they surface through one shared `skill` tool), so the deny set
 * targets only MCP tools.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { ConversationSelection } from './protocol.ts'

/** One live agent's isolation state; fields are mutated by apply/sync only. */
interface Isolator {
  /** The agent's current selection (mutable; guard reads it live). */
  selection: ConversationSelection
  /** Disposer for the active `restrict({ deny })`, or null. */
  denyDispose: (() => void) | null
  /** Disposer for the scope-local guard, or null. */
  guardDispose: (() => void) | null
  /** Disposer for the scope-local tools/change listener, or null. */
  changeDispose: (() => void) | null
  /** The deny list last applied, for idempotent re-sync (avoids restrict loops). */
  lastDeny: readonly string[]
  /**
   * True while this isolator is inside {@link ConversationIsolation.sync}.
   * `restrict()` / its disposer both emit `tools/change` synchronously; without
   * this latch the listener re-enters sync, applies a second restrict, and
   * overwrites `denyDispose` so the first layer is leaked forever.
   */
  syncing: boolean
}

/** Matches a model-facing MCP tool name, capturing the server namespace. */
const MCP_TOOL = /^mcp__([A-Za-z0-9_-]+)__/

/** Minimal live-agent shape this engine needs (Agent from @deepseek-ai/dsh-agent). */
export interface LiveAgent {
  readonly id: string
  readonly ctx: Context
}

function isSame(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Applies per-conversation MCP isolation to live agents. Call {@link apply}
 * whenever a selection should be in force (at agent creation for an isolated
 * conversation, and again on every selection change from the status bar).
 */
export class ConversationIsolation {
  /** Live agents keyed by object identity — GC'd with the agent, no cleanup. */
  private readonly isolators = new WeakMap<object, Isolator>()

  constructor(private readonly ctx: Context) {}

  /**
   * Put the given selection into force on a live agent. Safe to call
   * repeatedly: the previous restriction is lifted before the new one is
   * applied, so the conversation's effective set tracks the selection at any
   * time (between model requests).
   * @param agent - a live agent handle (from `agent/created` or `ctx.agents.get`).
   * @param selection - the selection to enforce.
   */
  apply(agent: LiveAgent, selection: ConversationSelection): void {
    let iso = this.isolators.get(agent)
    if (iso === undefined) {
      iso = this.create(agent)
      this.isolators.set(agent, iso)
    }
    iso.selection = selection
    this.sync(agent, iso)
  }

  /** Install the agent-scoped guard + tools/change listener (once per agent). */
  private create(agent: LiveAgent): Isolator {
    const iso: Isolator = {
      selection: {},
      denyDispose: null,
      guardDispose: null,
      changeDispose: null,
      lastDeny: [],
      syncing: false,
    }
    // Safety net: deny dispatch for a blacklisted server's tool. Reads the
    // CURRENT selection so a mid-conversation toggle is reflected without
    // re-registering the guard.
    iso.guardDispose = agent.ctx.tools.guard((execution) => {
      const match = MCP_TOOL.exec(execution.name)
      if (match !== null && (iso.selection.mcp ?? []).includes(match[1])) {
        return `MCP server "${match[1]}" is blacklisted for this conversation`
      }
      return undefined
    })
    // Re-sync whenever the tool catalog changes — catches MCP tools that
    // register late (after agent creation) and any that get disconnected.
    iso.changeDispose = agent.ctx.on('tools/change', () => this.sync(agent, iso))
    return iso
  }

  /** Recompute and swap the agent's deny restriction to match its selection. */
  private sync(agent: LiveAgent, iso: Isolator): void {
    // `restrict()` and its disposer both emit `tools/change` synchronously.
    // Ignore those self-inflicted events: the deny set is computed from the
    // host global catalog, which a scope-local restrict does not change.
    if (iso.syncing) return
    iso.syncing = true
    try {
      // Blacklist model: deny every tool of the blacklisted servers; an empty
      // blacklist injects everything (no-op, the default).
      const blocked = new Set(iso.selection.mcp ?? [])
      // Read the HOST global schema surface (not the agent's restricted view) so
      // the deny set is computed against the full candidate universe and is
      // stable even after our own earlier restriction hid tools from the agent.
      const deny: string[] = []
      for (const tool of this.ctx.tools.schemas()) {
        const match = MCP_TOOL.exec(tool.name)
        if (match !== null && blocked.has(match[1])) deny.push(tool.name)
      }
      deny.sort()
      if (isSame(deny, iso.lastDeny)) return
      this.disposeRestrict(iso)
      if (deny.length === 0) {
        iso.lastDeny = []
        return
      }
      try {
        // An unknown name rejects the whole call; if MCP is still connecting the
        // names simply aren't known yet and the next tools/change re-syncs.
        iso.denyDispose = agent.ctx.tools.restrict({ deny })
        iso.lastDeny = deny
      } catch {
        iso.lastDeny = []
      }
    } finally {
      iso.syncing = false
    }
  }

  private disposeRestrict(iso: Isolator): void {
    const dispose = iso.denyDispose
    iso.denyDispose = null
    if (dispose !== null) dispose()
  }
}
