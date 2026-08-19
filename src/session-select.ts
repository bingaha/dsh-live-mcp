/**
 * Per-conversation capability selection — stored in the session's own
 * directory (`<dshHome>/sessions/<project>/session-<id>/skills-mcp.selection.json`),
 * so a conversation has its config from the moment it exists and deleting the
 * session removes the config with it (session-local artifact).
 *
 * The session directory layout is the jsonl persistence backend's; the plugin
 * replicates the deterministic encoding (projectKey(cwd) + encodeSegment(id))
 * rather than editing DSH source. If the directory cannot be resolved/written
 * it degrades to in-memory defaults rather than throwing.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ConversationSelection } from './protocol.ts'

/** Hard link: the selection file name inside one session's directory. */
export const SELECTION_FILE = 'skills-mcp.selection.json'

/** Session root used by this deployment's jsonl persistence. */
export function sessionRoot(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'sessions')
}

/** Mirror of dsh-session-persistence-jsonl encodeSegment (safe path segment). */
function encodeSegment(raw: string): string {
  if (raw.length === 0) return '~0000'
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** Mirror of dsh-session-persistence-jsonl projectKey (cwd → one dir name). */
function projectKey(cwd: string): string {
  if (cwd.length === 0) return '--root--'
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const ch = String.fromCharCode(cwd.charCodeAt(i))
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** The selection file path for one session (id + its project cwd). */
export function selectionPath(sessionId: string, cwd: string): string {
  return join(sessionRoot(), projectKey(cwd), `session-${encodeSegment(sessionId)}`, SELECTION_FILE)
}

/** Read one session's selection; never throws. */
export function readSelection(sessionId: string, cwd: string): ConversationSelection {
  try {
    const target = selectionPath(sessionId, cwd)
    if (!existsSync(target)) return {}
    const raw = readFileSync(target, 'utf8')
    if (!raw || raw.trim() === '') return {}
    const data = JSON.parse(raw) as unknown
    if (data === null || typeof data !== 'object') return {}
    const s = data as Record<string, unknown>
    return {
      isolated: typeof s.isolated === 'boolean' ? s.isolated : undefined,
      skills: Array.isArray(s.skills) ? (s.skills as string[]).filter((x) => typeof x === 'string') : undefined,
      mcp: Array.isArray(s.mcp) ? (s.mcp as string[]).filter((x) => typeof x === 'string') : undefined,
    }
  } catch {
    return {}
  }
}

/** Persist one session's selection (creating the session dir when present). */
export function writeSelection(sessionId: string, cwd: string, selection: ConversationSelection): void {
  const target = selectionPath(sessionId, cwd)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(selection, null, 2), 'utf8')
}

/** Remove one session's selection file (session cleanup). */
export function deleteSelection(sessionId: string, cwd: string): void {
  try { rmSync(selectionPath(sessionId, cwd), { force: true }) } catch { /* ignore */ }
}
