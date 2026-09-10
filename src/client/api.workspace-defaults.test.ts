import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILLS_MCP_API } from '../protocol.ts'
import { SkillsMcpApi } from './api.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('SkillsMcpApi workspace defaults contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('uses the shared defaults paths and preserves non-blocking read errors', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, selection: { mcp: ['mysql'] }, error: 'defaults unreadable' }))
      .mockResolvedValueOnce(json({ ok: true, selection: { mcp: ['chrome-devtools'] } }))

    const api = new SkillsMcpApi()
    await expect(api.getWorkspaceDefaults('/workspaces/project')).resolves.toEqual({
      selection: { mcp: ['mysql'] }, error: 'defaults unreadable',
    })
    await expect(api.setWorkspaceDefaults('/workspaces/project', { mcp: ['chrome-devtools'] })).resolves.toEqual({
      selection: { mcp: ['chrome-devtools'] }, error: undefined,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, SKILLS_MCP_API.workspaceDefaults + '?cwd=%2Fworkspaces%2Fproject')
    expect(fetchMock).toHaveBeenNthCalledWith(2, SKILLS_MCP_API.workspaceDefaults, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/workspaces/project', mcp: ['chrome-devtools'] }),
    })
  })

  it('passes cwd to conversation reads and writes', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const body = { ok: true, selection: {}, available: { skills: [], mcp: [] } }
    fetchMock.mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body))
    const api = new SkillsMcpApi()

    await api.getConversation('session-a', '/workspaces/project')
    await api.setConversation('session-a', '/workspaces/project', { mcp: ['mysql'] })

    expect(fetchMock).toHaveBeenNthCalledWith(1, SKILLS_MCP_API.conversation + '?session=session-a&cwd=%2Fworkspaces%2Fproject')
    expect(fetchMock).toHaveBeenNthCalledWith(2, SKILLS_MCP_API.conversation, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'session-a', cwd: '/workspaces/project', mcp: ['mysql'] }),
    })
  })

  it('calls the dedicated blank initialization endpoint', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(json({ ok: true, selection: { mcp: ['mysql'] }, available: { skills: [], mcp: [] } }))

    await expect(new SkillsMcpApi().initializeConversation('session-blank', '/workspaces/project')).resolves.toEqual({
      selection: { mcp: ['mysql'] }, available: { skills: [], mcp: [] }, defaultsError: undefined,
    })
    expect(fetchMock).toHaveBeenCalledWith(SKILLS_MCP_API.conversationInitialize, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'session-blank', cwd: '/workspaces/project' }),
    })
  })
})
