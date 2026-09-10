import { Readable } from 'node:stream'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeRoutes } from './routes.ts'
import { SKILLS_MCP_API, type ConversationSelection } from './protocol.ts'
import { blacklistPath, writeSelection } from './session-select.ts'

const LIVE_CWD = '/workspaces/live'
const CLIENT_CWD = '/workspaces/client'
const SESSION = 'session-workspace-defaults'

interface Result {
  status: number
  body: Record<string, unknown>
}

function response(): { value: Result | undefined; res: Record<string, unknown> } {
  const state: { value: Result | undefined } = { value: undefined }
  const res = {
    writeHead: (status: number) => { state.value = { status, body: {} } },
    end: (body: string) => { state.value!.body = JSON.parse(body) as Record<string, unknown> },
  }
  return { value: state.value, res: Object.assign(res, { state }) }
}

async function request(routes: ReturnType<typeof makeRoutes>['routes'], method: string, target: string, body?: unknown): Promise<Result> {
  const route = routes.find((candidate) => candidate.path === new URL(target, 'http://localhost').pathname)
  if (route === undefined) throw new Error('route missing: ' + target)
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as Readable & Record<string, unknown>
  req.method = method
  req.url = target
  req.headers = { host: '127.0.0.1:3080' }
  req.socket = { remoteAddress: '127.0.0.1' }
  const output = response()
  await route.handler(req as never, output.res as never)
  return (output.res as { state: { value: Result } }).state.value
}

describe('workspace defaults HTTP seam', () => {
  let home: string
  let previousHome: string | undefined
  let applyCalls: Array<{ session: string; selection: ConversationSelection }>
  let resolvedCwd: string | undefined
  let routes: ReturnType<typeof makeRoutes>['routes']

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-routes-workspace-defaults-'))
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    applyCalls = []
    resolvedCwd = LIVE_CWD
    routes = makeRoutes({
      skills: { listSkills: () => [] } as never,
      mcp: { summarize: () => [] } as never,
      resolveCwd: () => resolvedCwd,
      applyLive: (session, selection) => { applyCalls.push({ session, selection }) },
    }).routes
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('reads and writes workspace defaults only for a non-empty absolute cwd', async () => {
    expect(await request(routes, 'GET', SKILLS_MCP_API.workspaceDefaults + '?cwd=relative')).toMatchObject({
      status: 400, body: { ok: false, error: 'absolute cwd required' },
    })
    expect(await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: LIVE_CWD, mcp: ['mysql'] })).toMatchObject({
      status: 200, body: { ok: true, selection: { mcp: ['mysql'] } },
    })
    expect(await request(routes, 'GET', SKILLS_MCP_API.workspaceDefaults + '?cwd=' + encodeURIComponent(LIVE_CWD))).toMatchObject({
      status: 200, body: { ok: true, selection: { mcp: ['mysql'] } },
    })
  })

  it('initializes a blank session once at the live agent cwd and applies it live', async () => {
    await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: LIVE_CWD, mcp: ['mysql'] })

    const initialized = await request(routes, 'POST', SKILLS_MCP_API.conversationInitialize, { session: SESSION, cwd: CLIENT_CWD })
    expect(initialized).toMatchObject({ status: 200, body: { ok: true, selection: { mcp: ['mysql'] }, available: { mcp: [], skills: [] } } })
    expect(fs.existsSync(blacklistPath(SESSION, LIVE_CWD))).toBe(true)
    expect(fs.existsSync(blacklistPath(SESSION, CLIENT_CWD))).toBe(false)
    expect(applyCalls).toEqual([{ session: SESSION, selection: { mcp: ['mysql'] } }])

    await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: LIVE_CWD, mcp: ['chrome-devtools'] })
    await request(routes, 'POST', SKILLS_MCP_API.conversationInitialize, { session: SESSION, cwd: CLIENT_CWD })
    expect(JSON.parse(fs.readFileSync(blacklistPath(SESSION, LIVE_CWD), 'utf8'))).toEqual({ mcp: ['mysql'] })
    expect(applyCalls).toHaveLength(1)
  })

  it('does not alter an existing historical blacklist and applies a user write live', async () => {
    writeSelection(SESSION, LIVE_CWD, { mcp: ['existing'] })
    await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: LIVE_CWD, mcp: ['mysql'] })

    await request(routes, 'POST', SKILLS_MCP_API.conversationInitialize, { session: SESSION })
    expect(JSON.parse(fs.readFileSync(blacklistPath(SESSION, LIVE_CWD), 'utf8'))).toEqual({ mcp: ['existing'] })
    expect(applyCalls).toEqual([])

    const saved = await request(routes, 'POST', SKILLS_MCP_API.conversation, { session: SESSION, cwd: CLIENT_CWD, mcp: ['user'] })
    expect(saved).toMatchObject({ status: 200, body: { ok: true, selection: { mcp: ['user'] } } })
    expect(JSON.parse(fs.readFileSync(blacklistPath(SESSION, LIVE_CWD), 'utf8'))).toEqual({ mcp: ['user'] })
    expect(applyCalls).toEqual([{ session: SESSION, selection: { mcp: ['user'] } }])
  })

  it('serializes initialization before a user choice for the same session', async () => {
    await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: LIVE_CWD, mcp: ['mysql'] })

    await Promise.all([
      request(routes, 'POST', SKILLS_MCP_API.conversationInitialize, { session: SESSION }),
      request(routes, 'POST', SKILLS_MCP_API.conversation, { session: SESSION, mcp: ['user'] }),
    ])

    expect(JSON.parse(fs.readFileSync(blacklistPath(SESSION, LIVE_CWD), 'utf8'))).toEqual({ mcp: ['user'] })
    expect(applyCalls).toEqual([
      { session: SESSION, selection: { mcp: ['mysql'] } },
      { session: SESSION, selection: { mcp: ['user'] } },
    ])
  })

  it('uses client cwd only when no live agent cwd resolves', async () => {
    resolvedCwd = undefined
    await request(routes, 'POST', SKILLS_MCP_API.workspaceDefaults, { cwd: CLIENT_CWD, mcp: ['mysql'] })
    await request(routes, 'POST', SKILLS_MCP_API.conversationInitialize, { session: SESSION, cwd: CLIENT_CWD })
    expect(fs.existsSync(blacklistPath(SESSION, CLIENT_CWD))).toBe(true)
  })
})
