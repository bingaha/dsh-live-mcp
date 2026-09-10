/**
 * Workspace MCP defaults persisted outside project trees.
 *
 * Each cwd maps to a blacklist applied only when a new blank conversation is
 * initialized. Empty selections remove their mapping so they retain the normal
 * "all globally enabled servers are available" behavior.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** Version of the workspace defaults document. */
export const WORKSPACE_DEFAULTS_VERSION = 1
/** User-level filename owned by this plugin. */
export const WORKSPACE_DEFAULTS_FILE = 'skills-mcp-workspace-defaults.json'

export interface WorkspaceDefaultSelection {
  mcp?: string[]
}

interface WorkspaceDefaultsDocument {
  version: number
  workspaces: Record<string, WorkspaceDefaultSelection>
}

export interface WorkspaceDefaultsRead {
  selection: WorkspaceDefaultSelection
  error?: string
}

let operations = new Map<string, Promise<void>>()

/** Resolve the user-level defaults document path. */
export function workspaceDefaultsPath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, WORKSPACE_DEFAULTS_FILE)
}

function normalizeSelection(value: unknown): WorkspaceDefaultSelection {
  if (value === null || typeof value !== 'object') return {}
  const mcp = (value as { mcp?: unknown }).mcp
  return { mcp: Array.isArray(mcp) ? mcp.filter((name): name is string => typeof name === 'string') : undefined }
}

function assertAbsoluteCwd(cwd: string): void {
  if (!isAbsolute(cwd)) throw new Error(`cwd must be absolute: ${cwd}`)
}

function isEmpty(selection: WorkspaceDefaultSelection): boolean {
  return (selection.mcp ?? []).length === 0
}

function parseDocument(raw: string): WorkspaceDefaultsDocument {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object') throw new Error('workspace defaults must be an object')
  const workspaces = (parsed as { workspaces?: unknown }).workspaces
  const entries: Record<string, WorkspaceDefaultSelection> = {}
  if (workspaces !== null && typeof workspaces === 'object' && !Array.isArray(workspaces)) {
    for (const [cwd, selection] of Object.entries(workspaces)) {
      if (typeof cwd !== 'string') continue
      const normalized = normalizeSelection(selection)
      if (!isEmpty(normalized)) entries[cwd] = normalized
    }
  }
  return { version: WORKSPACE_DEFAULTS_VERSION, workspaces: entries }
}

function readDocument(): { document: WorkspaceDefaultsDocument; error?: string } {
  const target = workspaceDefaultsPath()
  try {
    if (!existsSync(target)) return { document: { version: WORKSPACE_DEFAULTS_VERSION, workspaces: {} } }
    const raw = readFileSync(target, 'utf8')
    if (raw.trim() === '') return { document: { version: WORKSPACE_DEFAULTS_VERSION, workspaces: {} } }
    return { document: parseDocument(raw) }
  } catch (error) {
    return {
      document: { version: WORKSPACE_DEFAULTS_VERSION, workspaces: {} },
      error: String((error as Error)?.message ?? error),
    }
  }
}

/** Read one workspace's default MCP blacklist without throwing. */
export function readWorkspaceDefaults(cwd: string): WorkspaceDefaultsRead {
  assertAbsoluteCwd(cwd)
  const { document, error } = readDocument()
  const selection = document.workspaces[cwd] ?? {}
  return error === undefined ? { selection } : { selection, error }
}

function writeDocument(document: WorkspaceDefaultsDocument): void {
  const target = workspaceDefaultsPath()
  mkdirSync(dirname(target), { recursive: true })
  const temp = target + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2)
  try {
    writeFileSync(temp, JSON.stringify(document, null, 2), 'utf8')
    renameSync(temp, target)
  } finally {
    try { rmSync(temp, { force: true }) } catch { /* temp was published or cannot be removed */ }
  }
}

function enqueue(cwd: string, task: () => void): Promise<void> {
  const prior = operations.get(cwd) ?? Promise.resolve()
  const next = prior.then(task, task)
  const settled = next.finally(() => {
    if (operations.get(cwd) === settled) operations.delete(cwd)
  })
  operations.set(cwd, settled)
  return settled
}

/**
 * Serialize a read-modify-write update for one workspace. The updater observes
 * the preceding committed blacklist, so concurrent additions do not overwrite
 * each other. Empty results remove the cwd mapping.
 */
export async function updateWorkspaceDefaults(
  cwd: string,
  update: (current: Readonly<WorkspaceDefaultSelection>) => WorkspaceDefaultSelection,
): Promise<WorkspaceDefaultsRead> {
  assertAbsoluteCwd(cwd)
  let result: WorkspaceDefaultsRead = { selection: {} }
  await enqueue(cwd, () => {
    const { document, error } = readDocument()
    const normalized = normalizeSelection(update(document.workspaces[cwd] ?? {}))
    if (isEmpty(normalized)) delete document.workspaces[cwd]
    else document.workspaces[cwd] = normalized
    try {
      writeDocument(document)
      result = error === undefined ? { selection: normalized } : { selection: normalized, error }
    } catch (writeError) {
      result = { selection: document.workspaces[cwd] ?? {}, error: String((writeError as Error)?.message ?? writeError) }
    }
  })
  return result
}

/** Persist one workspace default blacklist, replacing its existing blacklist. */
export function writeWorkspaceDefaults(cwd: string, selection: WorkspaceDefaultSelection): Promise<WorkspaceDefaultsRead> {
  return updateWorkspaceDefaults(cwd, () => selection)
}

/** Test-only cleanup of serialized writes between isolated test homes. */
export function resetWorkspaceDefaultsOperations(): void {
  operations = new Map()
}
