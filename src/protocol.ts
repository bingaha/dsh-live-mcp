/**
 * Shared wire contract between the host and browser halves. Types only (no
 * value exports needed by the host side); the API path constants are the one
 * value both halves import so a route rename is a single edit.
 * @module
 */

/** Skill source labels (matching the filesystem root a skill was found in). */
export type SkillSource = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents'

/** Skill level, used for grouping in the UI. */
export type SkillLevel = 'project' | 'user'

/** One skill as listed in the UI. */
export interface SkillSummary {
  name: string
  description: string
  whenToUse: string
  enabled: boolean
  source: SkillSource
  level: SkillLevel
  kind: 'bundle' | 'file'
  /** True when the skill lives behind a symlink — deleting removes only the link. */
  linked?: boolean
  /** Absolute filesystem path of the SKILL.md (bundle) or the .md file. */
  path: string
}

/** A skill with its full body, for the detail view. */
export interface SkillDetail {
  name: string
  description: string
  whenToUse: string
  enabled: boolean
  content: string
  path: string
}

/** A candidate skill found by scanning an arbitrary directory. */
export interface ScannedSkill {
  name: string
  description: string
  sourcePath: string
  kind: 'bundle' | 'file'
}

/** Import strategy for one selected skill. */
export type ImportMode = 'copy' | 'link'

/** One item selected for import. */
export interface ImportItem {
  sourcePath: string
  kind: 'bundle' | 'file'
  /** 'link' creates a symlink into ~/.dsh/skills; 'copy' duplicates the files. */
  mode: ImportMode
}

/** Result of importing one skill. */
export interface ImportResult {
  name: string
  ok: boolean
  reason?: string
}

/** MCP transport kinds the manager supports. */
export type McpTransport = 'stdio' | 'streamable-http'

/** One persisted MCP server definition (mirrors ~/.dsh/mcp.json entries). */
export interface McpServerConfig {
  name: string
  transport: McpTransport
  enabled?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/** Connection state the manager reports for one server. */
export type McpConnectionStatus = 'connecting' | 'running' | 'failed' | 'stopped'

/** One MCP server as returned to the UI (full config + live connection state). */
export interface McpServerSummary extends McpServerConfig {
  status: McpConnectionStatus
  error?: string
}

/** API paths shared by the host routes and the browser api client. */
export const SKILLS_MCP_API = {
  skills: '/api/dsh-skills-mcp/skills',
  skillRead: '/api/dsh-skills-mcp/skills/read',
  skillToggle: '/api/dsh-skills-mcp/skills/toggle',
  skillDelete: '/api/dsh-skills-mcp/skills/delete',
  skillScan: '/api/dsh-skills-mcp/skills/scan',
  skillImport: '/api/dsh-skills-mcp/skills/import',
  mcp: '/api/dsh-skills-mcp/mcp',
  mcpSave: '/api/dsh-skills-mcp/mcp/save',
  mcpRetry: '/api/dsh-skills-mcp/mcp/retry',
  mcpEnabled: '/api/dsh-skills-mcp/mcp/enabled',
  mcpDelete: '/api/dsh-skills-mcp/mcp/delete',
  mcpTest: '/api/dsh-skills-mcp/mcp/test',
  conversation: '/api/dsh-skills-mcp/conversation',
} as const

/** One conversation's capability selection (stored in the session's own dir). */
export interface ConversationSelection {
  /** True = isolated: only `skills`/`mcp` enter this conversation's context. */
  isolated?: boolean
  /** Selected skill names (only ever globally-enabled ones). */
  skills?: string[]
  /** Selected MCP server names (only ever globally-enabled ones). */
  mcp?: string[]
}
