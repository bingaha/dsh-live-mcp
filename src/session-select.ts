/**
 * Per-conversation capability blacklist — stored in the session's own
 * directory (`<dshHome>/sessions/<project>/<sessionId>/skills-mcp.blacklist.json`),
 * so a conversation has its config from the moment it exists and deleting the
 * session removes the config with it (session-local artifact).
 *
 * The session directory layout is the jsonl persistence backend's; the plugin
 * replicates the deterministic encoding (projectKey(cwd) + encodeSegment(id))
 * rather than editing DSH source. SessionId already looks like `session-<uuid>`,
 * so the directory name is `encodeSegment(id)` — never another `session-` prefix.
 * If the directory cannot be resolved/written it degrades to in-memory defaults
 * rather than throwing.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ConversationSelection } from './protocol.ts'

/** On-disk name: this file lists what the conversation keeps OUT. */
export const BLACKLIST_FILE = 'skills-mcp.blacklist.json'

/** Pre-rename filename; still read, then migrated on the next write. */
export const LEGACY_SELECTION_FILE = 'skills-mcp.selection.json'

/** @deprecated Use {@link BLACKLIST_FILE}. Kept so older imports keep compiling. */
export const SELECTION_FILE = BLACKLIST_FILE

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

/** Official session directory (same layout as dsh-session-persistence-jsonl). */
export function sessionDir(sessionId: string, cwd: string): string {
  return join(sessionRoot(), projectKey(cwd), encodeSegment(sessionId))
}

/** Canonical blacklist file path for one session. */
export function blacklistPath(sessionId: string, cwd: string): string {
  return join(sessionDir(sessionId, cwd), BLACKLIST_FILE)
}

/** @deprecated Use {@link blacklistPath}. */
export function selectionPath(sessionId: string, cwd: string): string {
  return blacklistPath(sessionId, cwd)
}

/** Old filename sitting in the official session directory. */
function legacyInSessionDir(sessionId: string, cwd: string): string {
  return join(sessionDir(sessionId, cwd), LEGACY_SELECTION_FILE)
}

/**
 * Bug-era path: the plugin used to prefix `session-` onto an id that already
 * started with `session-`, creating an orphan `session-session-<uuid>/` dir.
 */
function orphanLegacyPath(sessionId: string, cwd: string): string {
  return join(sessionRoot(), projectKey(cwd), `session-${encodeSegment(sessionId)}`, LEGACY_SELECTION_FILE)
}

function parseSelection(raw: string): ConversationSelection {
  if (!raw || raw.trim() === '') return {}
  const data = JSON.parse(raw) as unknown
  if (data === null || typeof data !== 'object') return {}
  const s = data as Record<string, unknown>
  return {
    skills: Array.isArray(s.skills) ? (s.skills as string[]).filter((x) => typeof x === 'string') : undefined,
    mcp: Array.isArray(s.mcp) ? (s.mcp as string[]).filter((x) => typeof x === 'string') : undefined,
  }
}

function readFileIfPresent(target: string): ConversationSelection | undefined {
  if (!existsSync(target)) return undefined
  const raw = readFileSync(target, 'utf8')
  return parseSelection(raw)
}

function isEmptySelection(selection: ConversationSelection): boolean {
  return (selection.mcp ?? []).length === 0 && (selection.skills ?? []).length === 0
}

function removeFile(target: string): void {
  try { rmSync(target, { force: true }) } catch { /* ignore */ }
}

/** Drop an orphan `session-session-*` directory once it has no leftover files. */
function removeOrphanDirIfEmpty(sessionId: string, cwd: string): void {
  const dir = dirname(orphanLegacyPath(sessionId, cwd))
  try {
    if (!existsSync(dir)) return
    if (readdirSync(dir).length === 0) rmdirSync(dir)
  } catch { /* ignore */ }
}

/** Candidate files, newest contract first. */
function candidatePaths(sessionId: string, cwd: string): string[] {
  return [
    blacklistPath(sessionId, cwd),
    legacyInSessionDir(sessionId, cwd),
    orphanLegacyPath(sessionId, cwd),
  ]
}

/** Read one session's blacklist; never throws. Empty / missing = deny nothing. */
export function readSelection(sessionId: string, cwd: string): ConversationSelection {
  try {
    for (const target of candidatePaths(sessionId, cwd)) {
      const parsed = readFileIfPresent(target)
      if (parsed !== undefined) return parsed
    }
    return {}
  } catch {
    return {}
  }
}

/** Whether this session has any persisted blacklist, including legacy files. */
export function hasSelection(sessionId: string, cwd: string): boolean {
  try {
    return candidatePaths(sessionId, cwd).some((target) => existsSync(target))
  } catch {
    return false
  }
}

/**
 * Persist one session's blacklist into the official session directory.
 * An empty blacklist deletes the file (no config = everything available).
 * Legacy / orphan files are removed so a later read cannot pick them back up.
 */
export function writeSelection(sessionId: string, cwd: string, selection: ConversationSelection): void {
  const target = blacklistPath(sessionId, cwd)
  if (isEmptySelection(selection)) {
    deleteSelection(sessionId, cwd)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(selection, null, 2), 'utf8')
  removeFile(legacyInSessionDir(sessionId, cwd))
  removeFile(orphanLegacyPath(sessionId, cwd))
  removeOrphanDirIfEmpty(sessionId, cwd)
}

/** Remove one session's blacklist file and any leftover legacy copies. */
export function deleteSelection(sessionId: string, cwd: string): void {
  for (const target of candidatePaths(sessionId, cwd)) removeFile(target)
  removeOrphanDirIfEmpty(sessionId, cwd)
}
