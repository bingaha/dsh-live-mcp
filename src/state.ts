/**
 * Plugin-owned persistent state — the single source of truth for skills'
 * global enable/disable switches. The plugin NO LONGER rewrites
 * `disable-model-invocation` in SKILL.md files; that attribute is treated as
 * read-only display-only provenance, and toggling a skill writes here instead.
 * `mcp.json` remains the store for MCP servers' `enabled` flags.
 *
 * Shape is versioned defensively: unknown fields are ignored, absent fields
 * default. Parsing is never allowed to throw — a corrupted file degrades to
 * `{}` rather than breaking the whole plugin.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Global skill enable/disable set, keyed by the skill's SKILL.md / .md path. */
export interface SkillSwitchSet {
  /** `true` = enabled, `false` = disabled; absent = inherits file-derived default. */
  [path: string]: boolean
}

/** The persisted plugin state document. */
export interface PluginState {
  /** Global skill enable/disable switches. */
  skills?: SkillSwitchSet
  /** Reserved for per-conversation selections (later tickets). */
  conversations?: Record<string, unknown>
}

/** Resolve the state file path (DSH_HOME-aware, like the rest of the plugin). */
export function statePath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'skills-mcp-manager', 'state.json')
}

/** Read the state document; never throws (missing/corrupt → `{}`). */
export function readState(): PluginState {
  try {
    const target = statePath()
    if (!existsSync(target)) return {}
    const raw = readFileSync(target, 'utf8')
    if (!raw || raw.trim() === '') return {}
    const data = JSON.parse(raw) as unknown
    return (data !== null && typeof data === 'object') ? data as PluginState : {}
  } catch {
    return {}
  }
}

/** Persist the state document (creating the directory when needed). */
export function writeState(state: PluginState): void {
  const target = statePath()
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(state, null, 2), 'utf8')
}

/**
 * Read the effective enabled flag for one skill: a switch-set entry wins;
 * otherwise fall back to the file-derived value (which reflects a source that
 * authored `disable-model-invocation: true` as read-only display provenance).
 */
export function effectiveSkillEnabled(skills: SkillSwitchSet | undefined, path: string, fileDerived: boolean): boolean {
  const switched = skills?.[path]
  return switched === undefined ? fileDerived : switched
}
