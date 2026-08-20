/**
 * MCP manager — bridges ~/.dsh/mcp.json to real @deepseek-ai/dsh-mcp-client
 * instances. Each enabled server is loaded as a live plugin fiber (its tools
 * are registered on ctx.tools under mcp__<server>__<tool>); toggling a server
 * off disposes its fiber, which disconnects and unregisters the tools. This is
 * the "真连接" layer the dynamic plugin could not provide.
 * @module
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpConnectionStatus, McpServerConfig, McpServerSummary } from './protocol.ts'

/** Defaults for the mcp-client connection (per-call timeout + reconnect policy). */
const TOOL_CALL_TIMEOUT_MS = 60_000
const RECONNECT = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }

/** The ~/.dsh/mcp.json path this manager owns. */
export function mcpConfigPath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'mcp.json')
}

/** Read the persisted servers document (never throws). */
export function readMcpConfig(): { servers: McpServerConfig[] } {
  const target = mcpConfigPath()
  try {
    if (!existsSync(target)) return { servers: [] }
    const raw = readFileSync(target, 'utf8')
    if (!raw || raw.trim() === '') return { servers: [] }
    const data = JSON.parse(raw) as { servers?: unknown }
    return { servers: Array.isArray(data.servers) ? (data.servers as McpServerConfig[]) : [] }
  } catch {
    return { servers: [] }
  }
}

/** Persist the servers document (creating the directory when needed). */
export function writeMcpConfig(data: { servers: McpServerConfig[] }): void {
  const target = mcpConfigPath()
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
}

/** Validate one server definition; returns an error string, or null when valid. */
export function validateMcpServer(server: unknown): string | null {
  if (!server || typeof server !== 'object') return 'server must be an object'
  const s = server as McpServerConfig
  const name = s.name
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) return 'invalid name (1-32 chars of A-Za-z0-9_-)'
  if (s.transport !== 'stdio' && s.transport !== 'streamable-http') return "transport must be 'stdio' or 'streamable-http'"
  if (s.transport === 'stdio' && (typeof s.command !== 'string' || s.command.trim() === '')) return 'stdio transport requires command'
  if (s.transport === 'streamable-http' && (typeof s.url !== 'string' || s.url.trim() === '')) return 'streamable-http transport requires url'
  return null
}

/** Normalize a server into its persisted shape (drop transport-irrelevant fields). */
export function normalizeMcpServer(server: McpServerConfig): McpServerConfig {
  const normalized: McpServerConfig = {
    name: server.name,
    transport: server.transport,
    enabled: server.enabled !== false,
  }
  if (server.transport === 'stdio') {
    normalized.command = server.command
    normalized.args = Array.isArray(server.args) ? server.args : []
    normalized.env = (server.env && typeof server.env === 'object' && !Array.isArray(server.env)) ? server.env : {}
    normalized.cwd = server.cwd || ''
  } else {
    normalized.url = server.url
    normalized.headers = (server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)) ? server.headers : {}
  }
  return normalized
}

/** Map a persisted server definition to the mcp-client plugin Config. */
function toMcpClientConfig(s: McpServerConfig): mcpClient.Config {
  const base = {
    serverName: s.name,
    toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: true,
    reconnect: RECONNECT,
  }
  if (s.transport === 'stdio') {
    return {
      ...base,
      transport: 'stdio',
      command: s.command ?? '',
      args: s.args ?? [],
      env: s.env ?? {},
      cwd: s.cwd ?? '',
    } as mcpClient.Config
  }
  return {
    ...base,
    transport: 'streamable-http',
    url: s.url ?? '',
    headers: s.headers ?? {},
  } as mcpClient.Config
}

/** Equality for re-connect decisions (config-relevant fields only). */
function configChanged(a: McpServerConfig, b: McpServerConfig): boolean {
  return JSON.stringify(normalizeMcpServer(a)) !== JSON.stringify(normalizeMcpServer(b))
}

interface LiveServer {
  config: McpServerConfig
  fiber: Fiber
}

/**
 * Owns the live mcp-client fibers keyed by server name. Loading/disposal is
 * effect-safe: dispose() tears every fiber down (disconnect + tool unregister).
 */
export class McpManager {
  private readonly live = new Map<string, LiveServer>()
  private readonly statuses = new Map<string, { status: McpConnectionStatus; error?: string }>()
  // All mutations are serialized so an initial fire-and-forget reload cannot
  // race a route-triggered sync or plugin teardown.
  private operation: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly ctx: Context) {}

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.operation.then(task, task)
    this.operation = run.catch(() => undefined)
    return run
  }

  /** Re-read the persisted document and converge the live fiber set onto it. */
  async reload(): Promise<void> {
    await this.sync(readMcpConfig().servers)
  }

  /**
   * Converge the live fiber set onto the given enabled server list: dispose
   * removed/changed/disabled servers, then connect newly-enabled ones.
   * @param servers - the complete next server list (enabled flag respected).
   */
  async sync(servers: McpServerConfig[]): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed) return
      const next = new Map<string, McpServerConfig>()
      for (const s of servers) {
        if (s.enabled !== false) next.set(s.name, s)
      }
      // Tear down anything removed, disabled, or changed.
      const closing: Promise<unknown>[] = []
      for (const [name, entry] of [...this.live]) {
        const target = next.get(name)
        if (target === undefined || configChanged(entry.config, target)) {
          this.live.delete(name)
          this.statuses.delete(name)
          closing.push(Promise.resolve(entry.fiber.dispose()).catch(() => undefined))
        }
      }
      // Close all obsolete transports together; never hold up one server
      // behind another server's stdio shutdown grace period.
      await Promise.all(closing)
      // Bring up newly-enabled servers (or ones whose config just changed).
      for (const [name, cfg] of next) {
        if (this.disposed || this.live.has(name)) continue
        this.statuses.set(name, { status: 'connecting' })
        let fiber: Fiber & PromiseLike<Fiber>
        try {
          fiber = this.ctx.plugin(mcpClient, toMcpClientConfig(cfg))
        } catch (e) {
          this.statuses.set(name, { status: 'failed', error: String((e as Error)?.message ?? e) })
          continue
        }
        const entry: LiveServer = { config: normalizeMcpServer(cfg), fiber }
        this.live.set(name, entry)
        fiber.then(
          () => {
            if (this.live.get(name) === entry) this.statuses.set(name, { status: 'running' })
          },
          (e) => {
            // Ignore a late settlement from an entry already replaced or
            // disposed; it must not delete or overwrite the current entry.
            if (this.live.get(name) !== entry) return
            this.live.delete(name)
            this.statuses.set(name, { status: 'failed', error: String((e as Error)?.message ?? e) })
          },
        )
      }
    })
  }

  /** Stop and dispose every live connection (plugin teardown). */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.enqueue(async () => {
      const closing: Promise<unknown>[] = []
      for (const [name, entry] of [...this.live]) {
        this.live.delete(name)
        this.statuses.delete(name)
        closing.push(Promise.resolve(entry.fiber.dispose()).catch(() => undefined))
      }
      await Promise.all(closing)
    })
  }

  /**
   * One-shot connection probe for the test button: connect with
   * failOnStartupError so a failure rejects, then always dispose. A server
   * that is already live answers ok immediately — re-testing would collide on
   * its reserved serverName namespace.
   */
  async testConnect(server: McpServerConfig): Promise<{ ok: boolean; error?: string }> {
    const normalized = normalizeMcpServer(server)
    if (this.live.has(normalized.name)) return { ok: true }
    const fiber = this.ctx.plugin(mcpClient, toMcpClientConfig(normalized)) as Fiber & PromiseLike<Fiber>
    try {
      await fiber
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) }
    } finally {
      try { await fiber.dispose() } catch { /* already gone */ }
    }
  }

  /**
   * Force-reconnect a single server (retry after a failure). Disposes any
   * existing fiber for the name, then starts a fresh live fiber for just this
   * server. Deliberately does NOT call sync(): sync treats its argument as the
   * complete server set and would tear down every other live connection.
   * A no-op for a missing or disabled server.
   * @param name - the server name to reconnect.
   */
  async retry(name: string): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed) return
      const server = readMcpConfig().servers.find((s) => s.name === name)
      if (server === undefined || server.enabled === false) return
      const entry = this.live.get(name)
      if (entry !== undefined) {
        this.live.delete(name)
        this.statuses.delete(name)
        try { await entry.fiber.dispose() } catch { /* already gone */ }
      }
      const normalized = normalizeMcpServer(server)
      this.statuses.set(name, { status: 'connecting' })
      let fiber: Fiber & PromiseLike<Fiber>
      try {
        fiber = this.ctx.plugin(mcpClient, toMcpClientConfig(normalized)) as Fiber & PromiseLike<Fiber>
      } catch (e) {
        this.statuses.set(name, { status: 'failed', error: String((e as Error)?.message ?? e) })
        return
      }
      const next: LiveServer = { config: normalized, fiber }
      this.live.set(name, next)
      fiber.then(
        () => {
          if (this.live.get(name) === next) this.statuses.set(name, { status: 'running' })
        },
        (e) => {
          if (this.live.get(name) !== next) return
          this.live.delete(name)
          this.statuses.set(name, { status: 'failed', error: String((e as Error)?.message ?? e) })
        },
      )
    })
  }

  /** Build the UI summary list (persisted config + live status). */
  summarize(servers: McpServerConfig[]): McpServerSummary[] {
    return servers.map((s) => {
      const st = this.statuses.get(s.name)
      const enabled = s.enabled !== false
      const status: McpConnectionStatus = !enabled ? 'stopped' : (st?.status ?? 'connecting')
      return {
        ...s,
        enabled,
        status,
        error: st?.error,
      }
    })
  }
}
