/**
 * /api/dsh-skills-mcp route family — the browser half's only data path.
 * Skills CRUD, MCP CRUD, and a one-shot connection test. Every route carries
 * a loopback-only trust fence (plus browser same-origin markers): these
 * endpoints read/write user files and spawn MCP servers, so a LAN-exposed dsh
 * web deployment must not serve them.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { McpManager, normalizeMcpServer, readMcpConfig, validateMcpServer, writeMcpConfig } from './mcp.ts'
import { SkillsManager } from './skills.ts'
import { hasSelection, readSelection, writeSelection } from './session-select.ts'
import { readWorkspaceDefaults, writeWorkspaceDefaults } from './workspace-defaults.ts'
import { SKILLS_MCP_API } from './protocol.ts'
import type { ConversationMcpOption, ConversationSelection, ConversationSkillOption, McpServerConfig, WorkspaceDefaultSelection } from './protocol.ts'

/** Cap on JSON request bodies (server definitions and import lists are small). */
const MAX_JSON_BODY_BYTES = 1024 * 1024

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

export interface RoutesDeps {
  skills: SkillsManager
  mcp: McpManager
  /** Resolve a session's project cwd by session id (for session-local storage). */
  resolveCwd: (sessionId: string) => string | undefined
  /**
   * Apply a just-saved selection to the conversation's live agent (if one is
   * running), so a status-bar change takes effect immediately — not only at
   * conversation creation. No-op when the agent is not live (the agent/created
   * hook re-applies later from the persisted file).
   */
  applyLive: (sessionId: string, selection: ConversationSelection) => void
}

type ConversationView = ReturnType<typeof resolveConversation> & { defaultsError?: string }

let sessionOperations = new Map<string, Promise<void>>()

function enqueueSession(sessionId: string, task: () => void): Promise<void> {
  const prior = sessionOperations.get(sessionId) ?? Promise.resolve()
  const next = prior.then(task, task)
  const settled = next.finally(() => {
    if (sessionOperations.get(sessionId) === settled) sessionOperations.delete(sessionId)
  })
  sessionOperations.set(sessionId, settled)
  return settled
}

function requireAbsoluteCwd(cwd: string): string | undefined {
  return cwd.length > 0 && isAbsolute(cwd) ? cwd : undefined
}

function selectionFromBody(body: Record<string, unknown>): ConversationSelection {
  return {
    skills: Array.isArray(body.skills) ? body.skills.filter((x): x is string => typeof x === 'string') : undefined,
    mcp: Array.isArray(body.mcp) ? body.mcp.filter((x): x is string => typeof x === 'string') : undefined,
  }
}

function workspaceSelectionFromBody(body: Record<string, unknown>): WorkspaceDefaultSelection {
  return { mcp: Array.isArray(body.mcp) ? body.mcp.filter((x): x is string => typeof x === 'string') : undefined }
}

/**
 * Build every /api/dsh-skills-mcp route (exact paths).
 * @param deps - skills engine and MCP connection manager.
 * @returns the route registrations.
 */
export function makeRoutes(deps: RoutesDeps): { routes: WebRoute[] } {
  const { skills, mcp, resolveCwd, applyLive } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { ok: false, error: 'method not allowed' })
      return false
    }
    return true
  }

  const handle = (method: string, path: string, fn: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>, url: URL) => Promise<void>): WebRoute => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!guard(req, res, method)) return
      let body: Record<string, unknown> = {}
      if (method === 'POST') {
        const parsed = await readJsonBody(req)
        if (parsed === undefined) { writeJson(res, 400, { ok: false, error: 'invalid or oversized JSON body' }); return }
        body = parsed
      }
      try {
        await fn(req, res, body, new URL(req.url ?? '/', 'http://localhost'))
      } catch (e) {
        writeJson(res, 500, { ok: false, error: String((e as Error)?.message ?? e) })
      }
    },
  })

  const ok = (data: Record<string, unknown> = {}): Record<string, unknown> => ({ ok: true, ...data })
  const resolveSessionCwd = (session: string, fallback: string): string | undefined =>
    requireAbsoluteCwd(resolveCwd(session) ?? fallback)
  const conversationView = (session: string, cwd: string): ConversationView => {
    const defaults = readWorkspaceDefaults(cwd)
    const view = resolveConversation(skills, mcp, readSelection(session, cwd), cwd)
    return defaults.error === undefined ? view : { ...view, defaultsError: defaults.error }
  }

  return {
    routes: [
      // ── skills ───────────────────────────────────────────────────────────
      handle('GET', SKILLS_MCP_API.skills, async (_req, res, _body, url) => {
        writeJson(res, 200, ok({ items: skills.listSkills(queryParam(url, 'cwd')) }))
      }),

      handle('POST', SKILLS_MCP_API.skillRead, async (_req, res, body, _url) => {
        const path = typeof body?.path === 'string' ? body.path : ''
        if (!path) { writeJson(res, 400, { ok: false, error: 'path required' }); return }
        const skill = skills.readSkill(path)
        if (skill === null) { writeJson(res, 404, { ok: false, error: 'not a valid skill file: ' + path }); return }
        writeJson(res, 200, ok({ skill }))
      }),

      handle('POST', SKILLS_MCP_API.skillDelete, async (_req, res, body, _url) => {
        const path = typeof body?.path === 'string' ? body.path : ''
        if (!path) { writeJson(res, 400, { ok: false, error: 'path required' }); return }
        const kind = body.kind === 'bundle' ? 'bundle' : 'file'
        const removed = skills.deleteSkill(path, kind)
        writeJson(res, 200, ok({ path, removed }))
      }),

      handle('POST', SKILLS_MCP_API.skillScan, async (_req, res, body, _url) => {
        const dir = typeof body?.dir === 'string' ? body.dir : ''
        if (!dir) { writeJson(res, 400, { ok: false, error: 'directory is required' }); return }
        writeJson(res, 200, ok({ items: skills.scanSkills(dir) }))
      }),

      handle('POST', SKILLS_MCP_API.skillImport, async (_req, res, body, _url) => {
        const items = Array.isArray(body?.items) ? body.items as Array<{ sourcePath?: unknown; kind?: unknown; mode?: unknown }> : []
        if (items.length === 0) { writeJson(res, 400, { ok: false, error: 'nothing selected' }); return }
        const results = skills.importSkills(items.map((it) => ({
          sourcePath: typeof it.sourcePath === 'string' ? it.sourcePath : '',
          kind: it.kind === 'bundle' ? 'bundle' : 'file',
          mode: it.mode === 'link' ? 'link' : 'copy',
        })))
        writeJson(res, 200, ok({ results }))
      }),

      // ── mcp ──────────────────────────────────────────────────────────────
      handle('GET', SKILLS_MCP_API.mcp, async (_req, res, _body, _url) => {
        const { servers } = readMcpConfig()
        writeJson(res, 200, ok({ servers: mcp.summarize(servers) }))
      }),

      handle('POST', SKILLS_MCP_API.mcpSave, async (_req, res, body, _url) => {
        const server = body?.server as McpServerConfig | undefined
        const err = validateMcpServer(server)
        if (err) { writeJson(res, 400, { ok: false, error: err }); return }
        const normalized = normalizeMcpServer(server as McpServerConfig)
        const data = readMcpConfig()
        const idx = data.servers.findIndex((s) => s.name === normalized.name)
        if (idx >= 0) data.servers[idx] = normalized
        else data.servers.push(normalized)
        writeMcpConfig(data)
        await mcp.sync(data.servers)
        writeJson(res, 200, ok({ server: normalized }))
      }),

      handle('POST', SKILLS_MCP_API.mcpEnabled, async (_req, res, body, _url) => {
        const name = typeof body?.name === 'string' ? body.name : ''
        const enabled = body.enabled === true
        if (!name) { writeJson(res, 400, { ok: false, error: 'name required' }); return }
        const data = readMcpConfig()
        const s = data.servers.find((x) => x.name === name)
        if (s === undefined) { writeJson(res, 404, { ok: false, error: 'server not found: ' + name }); return }
        s.enabled = enabled
        writeMcpConfig(data)
        await mcp.sync(data.servers)
        writeJson(res, 200, ok({ name, enabled }))
      }),

      handle('POST', SKILLS_MCP_API.mcpDelete, async (_req, res, body, _url) => {
        const name = typeof body?.name === 'string' ? body.name : ''
        if (!name) { writeJson(res, 400, { ok: false, error: 'name required' }); return }
        const data = readMcpConfig()
        data.servers = data.servers.filter((x) => x.name !== name)
        writeMcpConfig(data)
        await mcp.sync(data.servers)
        writeJson(res, 200, ok({ name }))
      }),

      handle('POST', SKILLS_MCP_API.mcpRetry, async (_req, res, body, _url) => {
        const name = typeof body?.name === 'string' ? body.name : ''
        if (!name) { writeJson(res, 400, { ok: false, error: 'name required' }); return }
        const data = readMcpConfig()
        const s = data.servers.find((x) => x.name === name)
        if (s === undefined) { writeJson(res, 404, { ok: false, error: 'server not found: ' + name }); return }
        if (s.enabled === false) { writeJson(res, 200, ok({ name, skipped: 'disabled' })); return }
        await mcp.retry(name)
        writeJson(res, 200, ok({ name }))
      }),

      handle('POST', SKILLS_MCP_API.mcpTest, async (_req, res, body, _url) => {
        const server = body?.server as McpServerConfig | undefined
        const err = validateMcpServer(server)
        if (err) { writeJson(res, 400, { ok: false, error: err }); return }
        const result = await mcp.testConnect(server as McpServerConfig)
        writeJson(res, 200, ok({ test: result }))
      }),

      // ── workspace defaults ────────────────────────────────────────────────
      // Exact web routes are keyed by path, so GET and POST share one handler.
      {
        kind: 'exact',
        path: SKILLS_MCP_API.workspaceDefaults,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return }
          if (req.method === 'GET') {
            const cwd = requireAbsoluteCwd(queryParam(new URL(req.url ?? '/', 'http://localhost'), 'cwd') ?? '')
            if (cwd === undefined) { writeJson(res, 400, { ok: false, error: 'absolute cwd required' }); return }
            const result = readWorkspaceDefaults(cwd)
            writeJson(res, 200, ok({ selection: result.selection, ...(result.error === undefined ? {} : { error: result.error }) }))
            return
          }
          if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
          const body = await readJsonBody(req)
          if (body === undefined) { writeJson(res, 400, { ok: false, error: 'invalid or oversized JSON body' }); return }
          const cwd = requireAbsoluteCwd(typeof body.cwd === 'string' ? body.cwd : '')
          if (cwd === undefined) { writeJson(res, 400, { ok: false, error: 'absolute cwd required' }); return }
          const result = await writeWorkspaceDefaults(cwd, workspaceSelectionFromBody(body))
          writeJson(res, 200, ok({ selection: result.selection, ...(result.error === undefined ? {} : { error: result.error }) }))
        },
      },

      // ── per-conversation ─────────────────────────────────────────────────
      // GET = resolve this session's selection + available set; POST = save a
      // selection. One WebRoute (exact paths are keyed by path alone, with no
      // method axis), so a single handler dispatches on the method.
      {
        kind: 'exact',
        path: SKILLS_MCP_API.conversation,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return }
          try {
            if (req.method === 'GET') {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const session = queryParam(url, 'session') ?? ''
              if (!session) { writeJson(res, 400, { ok: false, error: 'session required' }); return }
              const cwd = resolveSessionCwd(session, queryParam(url, 'cwd') ?? '')
              if (cwd === undefined) { writeJson(res, 400, { ok: false, error: 'absolute cwd required' }); return }
              writeJson(res, 200, ok(conversationView(session, cwd)))
              return
            }
            if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
            const body = await readJsonBody(req)
            if (body === undefined) { writeJson(res, 400, { ok: false, error: 'invalid or oversized JSON body' }); return }
            const session = typeof body?.session === 'string' ? body.session : ''
            if (!session) { writeJson(res, 400, { ok: false, error: 'session required' }); return }
            const cwd = resolveSessionCwd(session, typeof body.cwd === 'string' ? body.cwd : '')
            if (cwd === undefined) { writeJson(res, 400, { ok: false, error: 'absolute cwd required' }); return }
            const request = selectionFromBody(body)
            // Initialization and status-bar writes share this queue. A user
            // selection queued after initialization always wins its final state.
            await enqueueSession(session, () => {
              writeSelection(session, cwd, request)
              // Apply within the same sequence as persistence so concurrent
              // initialization or toggles cannot leave the live agent stale.
              applyLive(session, request)
            })
            writeJson(res, 200, ok(conversationView(session, cwd)))
          } catch (e) {
            writeJson(res, 500, { ok: false, error: String((e as Error)?.message ?? e) })
          }
        },
      },

      // A blank browser session explicitly opts into this operation. Ordinary
      // conversation reads never alter persisted historical sessions.
      handle('POST', SKILLS_MCP_API.conversationInitialize, async (_req, res, body, _url) => {
        const session = typeof body.session === 'string' ? body.session : ''
        if (!session) { writeJson(res, 400, { ok: false, error: 'session required' }); return }
        const cwd = resolveSessionCwd(session, typeof body.cwd === 'string' ? body.cwd : '')
        if (cwd === undefined) { writeJson(res, 400, { ok: false, error: 'absolute cwd required' }); return }
        let initialized: ConversationSelection | undefined
        let defaultsError: string | undefined
        await enqueueSession(session, () => {
          if (hasSelection(session, cwd)) return
          const defaults = readWorkspaceDefaults(cwd)
          defaultsError = defaults.error
          if ((defaults.selection.mcp ?? []).length === 0) return
          initialized = { mcp: defaults.selection.mcp }
          writeSelection(session, cwd, initialized)
          // Keep the live update in the same queue as user writes so a later
          // status-bar choice is necessarily the final agent state.
          applyLive(session, initialized)
        })
        const view = conversationView(session, cwd)
        writeJson(res, 200, ok(defaultsError === undefined ? view : { ...view, defaultsError }))
      }),
    ],
  }
}

/**
 * Resolve the conversation's selectable capabilities. Skills are every
 * scanned document plus author invocation flags (not filtered by plugin
 * switches or by model/user policy). MCP options remain globally-enabled
 * servers with live connection status. The conversation's `selection`
 * (MCP blacklist) decides which of those servers are denied here.
 */
export function resolveConversation(
  skills: SkillsManager,
  mcp: Pick<McpManager, 'summarize'>,
  selection: ConversationSelection,
  cwd: string,
): { selection: ConversationSelection; available: { skills: ConversationSkillOption[]; mcp: ConversationMcpOption[] } } {
  const skillOptions = skills
    .listSkills(cwd)
    .map((s) => ({ name: s.name, modelInvocable: s.modelInvocable, userInvocable: s.userInvocable }))
  const enabledMcp = mcp
    .summarize(readMcpConfig().servers)
    .filter((s) => s.enabled)
    .map((s) => ({ name: s.name, status: s.status }))
  return {
    selection,
    available: { skills: skillOptions, mcp: enabledMcp },
  }
}
