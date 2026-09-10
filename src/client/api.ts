/**
 * Browser-side API client for the /api/dsh-skills-mcp route family. The only
 * data path the card components use — plain fetch, same origin.
 */

import { SKILLS_MCP_API } from '../protocol.ts'
import type { ConversationMcpOption, ConversationSelection, ConversationSkillOption, ImportItem, ImportResult, McpServerConfig, McpServerSummary, ScannedSkill, SkillDetail, SkillSummary, WorkspaceDefaultSelection } from '../protocol.ts'

/** The conversation-capability view the host resolves for one session. */
export interface ConversationView {
  selection: ConversationSelection
  available: { skills: ConversationSkillOption[]; mcp: ConversationMcpOption[] }
  defaultsError?: string
}

/** Workspace defaults response; a read error remains non-blocking. */
export interface WorkspaceDefaultsView {
  selection: WorkspaceDefaultSelection
  error?: string
}

/** Error carrying the route's JSON error message. */
export class SkillsMcpApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillsMcpApiError'
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new SkillsMcpApiError('HTTP ' + response.status + ': invalid JSON response')
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'HTTP ' + response.status
    throw new SkillsMcpApiError(message)
  }
  return body as T
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson<T>(response)
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  return readJson<T>(response)
}

/** The browser half's only data entry point. */
export class SkillsMcpApi {
  async listSkills(cwd: string): Promise<SkillSummary[]> {
    const q = cwd ? '?cwd=' + encodeURIComponent(cwd) : ''
    const body = await get<{ ok: boolean; items: SkillSummary[] }>(SKILLS_MCP_API.skills + q)
    return body.items
  }

  async readSkill(path: string): Promise<SkillDetail> {
    const body = await post<{ ok: boolean; skill: SkillDetail }>(SKILLS_MCP_API.skillRead, { path })
    return body.skill
  }

  async deleteSkill(path: string, kind: 'bundle' | 'file'): Promise<void> {
    await post<{ ok: boolean }>(SKILLS_MCP_API.skillDelete, { path, kind })
  }

  async scanSkills(dir: string): Promise<ScannedSkill[]> {
    const body = await post<{ ok: boolean; items: ScannedSkill[] }>(SKILLS_MCP_API.skillScan, { dir })
    return body.items
  }

  async importSkills(items: ImportItem[]): Promise<ImportResult[]> {
    const body = await post<{ ok: boolean; results: ImportResult[] }>(SKILLS_MCP_API.skillImport, { items })
    return body.results
  }

  async listMcp(): Promise<McpServerSummary[]> {
    const body = await get<{ ok: boolean; servers: McpServerSummary[] }>(SKILLS_MCP_API.mcp)
    return body.servers
  }

  async saveMcp(server: McpServerConfig): Promise<void> {
    await post<{ ok: boolean }>(SKILLS_MCP_API.mcpSave, { server })
  }

  async setMcpEnabled(name: string, enabled: boolean): Promise<void> {
    await post<{ ok: boolean }>(SKILLS_MCP_API.mcpEnabled, { name, enabled })
  }

  async retryMcp(name: string): Promise<void> {
    await post<{ ok: boolean }>(SKILLS_MCP_API.mcpRetry, { name })
  }

  async deleteMcp(name: string): Promise<void> {
    await post<{ ok: boolean }>(SKILLS_MCP_API.mcpDelete, { name })
  }

  async testMcp(server: McpServerConfig): Promise<{ ok: boolean; error?: string }> {
    const body = await post<{ ok: boolean; test: { ok: boolean; error?: string } }>(SKILLS_MCP_API.mcpTest, { server })
    return body.test
  }

  async getWorkspaceDefaults(cwd: string): Promise<WorkspaceDefaultsView> {
    const body = await get<{ ok: boolean; selection: WorkspaceDefaultSelection; error?: string }>(
      SKILLS_MCP_API.workspaceDefaults + '?cwd=' + encodeURIComponent(cwd),
    )
    return { selection: body.selection, error: body.error }
  }

  async setWorkspaceDefaults(cwd: string, selection: WorkspaceDefaultSelection): Promise<WorkspaceDefaultsView> {
    const body = await post<{ ok: boolean; selection: WorkspaceDefaultSelection; error?: string }>(
      SKILLS_MCP_API.workspaceDefaults,
      { cwd, ...selection },
    )
    return { selection: body.selection, error: body.error }
  }

  async getConversation(session: string, cwd: string): Promise<ConversationView> {
    const body = await get<{ ok: boolean; selection: ConversationSelection; available: { skills: ConversationSkillOption[]; mcp: ConversationMcpOption[] }; defaultsError?: string }>(
      SKILLS_MCP_API.conversation + '?session=' + encodeURIComponent(session) + '&cwd=' + encodeURIComponent(cwd),
    )
    return { selection: body.selection, available: body.available, defaultsError: body.defaultsError }
  }

  async initializeConversation(session: string, cwd: string): Promise<ConversationView> {
    const body = await post<{ ok: boolean; selection: ConversationSelection; available: { skills: ConversationSkillOption[]; mcp: ConversationMcpOption[] }; defaultsError?: string }>(
      SKILLS_MCP_API.conversationInitialize,
      { session, cwd },
    )
    return { selection: body.selection, available: body.available, defaultsError: body.defaultsError }
  }

  async setConversation(session: string, cwd: string, selection: ConversationSelection): Promise<ConversationView> {
    const body = await post<{ ok: boolean; selection: ConversationSelection; available: { skills: ConversationSkillOption[]; mcp: ConversationMcpOption[] }; defaultsError?: string }>(
      SKILLS_MCP_API.conversation,
      { session, cwd, ...selection },
    )
    return { selection: body.selection, available: body.available, defaultsError: body.defaultsError }
  }
}
