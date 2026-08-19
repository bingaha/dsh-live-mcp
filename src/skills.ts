/**
 * Skills filesystem engine — scans the four manageable skill roots, parses
 * SKILL.md frontmatter, and performs enable/disable (via the plugin's own
 * switch set — never by rewriting SKILL.md's disable-model-invocation),
 * delete, scan-for-import, and import. Runs in the Host process with direct
 * node:fs access (a real npm package no longer needs the shell+node hack the
 * dynamic plugin used).
 * @module
 */

import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { effectiveSkillEnabled, readState, writeState } from './state.ts'
import type { ImportItem, ImportResult, ScannedSkill, SkillDetail, SkillLevel, SkillSource, SkillSummary } from './protocol.ts'

/** User-level skill roots (project roots are derived from the workspace cwd). */
export interface SkillRoots {
  home: string
  dshHome: string
  agentsHome: string
  userSkillsDir: string
  agentsSkillsDir: string
}

function dshHomeDir(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function agentsHomeDir(): string {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** Resolve (and materialize) the user-level skill roots. */
export function getRoots(): SkillRoots {
  const home = homedir()
  const dshHome = dshHomeDir()
  const agentsHome = agentsHomeDir()
  const userSkillsDir = join(dshHome, 'skills')
  mkdirSync(userSkillsDir, { recursive: true })
  return { home, dshHome, agentsHome, userSkillsDir, agentsSkillsDir: join(agentsHome, 'skills') }
}

/** Walk up from cwd to the nearest .git directory (the project root). */
export function findProjectRoot(cwd?: string): string {
  let dir = resolve(cwd ?? process.cwd())
  for (let i = 0; i < 100; i++) {
    if (existsSync(join(dir, '.git'))) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dir
}

function levelOf(source: SkillSource): SkillLevel {
  return source === 'project-dsh' || source === 'project-agents' ? 'project' : 'user'
}

function scalarValue(v: string): unknown {
  if (v === 'true' || v === 'True' || v === 'TRUE') return true
  if (v === 'false' || v === 'False' || v === 'FALSE') return false
  if (v === 'null' || v === '~') return null
  if (/^-?\d+$/.test(v)) return parseInt(v, 10)
  return v
}

function parseBool(v: unknown): boolean | undefined {
  if (v === true || v === 1 || v === '1') return true
  if (v === false || v === 0 || v === '0') return false
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (s === 'true' || s === 'yes' || s === 'on') return true
    if (s === 'false' || s === 'no' || s === 'off') return false
  }
  return undefined
}

interface Frontmatter { data: Record<string, unknown>; body: string }

/** Parse a YAML-style frontmatter block; null when absent or malformed. */
function parseFrontmatter(raw: string): Frontmatter | null {
  const lines = raw.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { closeIdx = i; break }
  }
  if (closeIdx < 0) return null
  const data: Record<string, unknown> = {}
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i]
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    let val = line.slice(colon + 1).trim()
    if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'"))) {
      val = val.slice(1, -1)
    }
    data[key] = scalarValue(val)
  }
  const body = lines.slice(closeIdx + 1).join('\n')
  return { data, body }
}

interface ParsedSkill { name: string; description: string; whenToUse: string; enabled: boolean; content: string }

/** Parse one skill document; null when it lacks a name/description. */
function parseSkillFile(raw: string): ParsedSkill | null {
  const fm = parseFrontmatter(raw)
  if (fm === null) return null
  const name = typeof fm.data.name === 'string' ? fm.data.name : ''
  const description = typeof fm.data.description === 'string' ? fm.data.description : ''
  if (name === '' || description === '') return null
  const whenToUse = typeof fm.data.whenToUse === 'string' ? fm.data.whenToUse : ''
  const disableModel = parseBool(fm.data['disable-model-invocation'])
  // Mirrors @deepseek-ai/dsh-skill-filesystem's parseInvocationPolicy:
  // modelInvocable = disable-model-invocation !== true. "Enabled" here means
  // the skill's MODEL invocation is NOT disabled — a false or absent
  // disable-model-invocation is enabled.
  return {
    name,
    description,
    whenToUse,
    enabled: disableModel !== true,
    content: fm.body.trim(),
  }
}

export class SkillsManager {
  /** Scan one skill root directory into SkillSummary records. */
  scanRoot(dir: string, source: SkillSource): SkillSummary[] {
    const items: SkillSummary[] = []
    if (!existsSync(dir)) return items
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return items }
    for (const entry of entries) {
      const name = entry.name
      if (!name || name === '.system' || name[0] === '.') continue
      const full = join(dir, name)
      // statSync follows symlinks (Dirent.isDirectory/isFile do not), so skills
      // exposed through a symlink into a user root are listed too.
      let st
      try { st = statSync(full) } catch { continue }
      let linked = false
      try { linked = lstatSync(full).isSymbolicLink() } catch { /* ignore */ }
      if (st.isDirectory()) {
        const mdPath = join(full, 'SKILL.md')
        if (!existsSync(mdPath)) continue
        let raw: string
        try { raw = readFileSync(mdPath, 'utf8') } catch { continue }
        const parsed = parseSkillFile(raw)
        if (parsed === null) continue
        items.push({ ...parsed, source, level: levelOf(source), kind: 'bundle', linked, path: mdPath })
      } else if (st.isFile() && name.endsWith('.md')) {
        let raw: string
        try { raw = readFileSync(full, 'utf8') } catch { continue }
        const parsed = parseSkillFile(raw)
        if (parsed === null) continue
        items.push({ ...parsed, source, level: levelOf(source), kind: 'file', linked, path: full })
      }
    }
    return items
  }

  /** List skills across project and/or user roots, de-duplicated by path. */
  listSkills(cwd?: string): SkillSummary[] {
    const roots = getRoots()
    const scans: Array<{ path: string; source: SkillSource }> = []
    if (cwd) {
      const projectRoot = findProjectRoot(cwd)
      scans.push(
        { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' },
        { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents' },
        { path: roots.userSkillsDir, source: 'user-dsh' },
        { path: roots.agentsSkillsDir, source: 'user-agents' },
      )
    } else {
      scans.push(
        { path: roots.userSkillsDir, source: 'user-dsh' },
        { path: roots.agentsSkillsDir, source: 'user-agents' },
      )
    }
    const seen = new Set<string>()
    const items: SkillSummary[] = []
    for (const s of scans) {
      for (const it of this.scanRoot(s.path, s.source)) {
        if (seen.has(it.path)) continue
        seen.add(it.path)
        items.push(it)
      }
    }
    items.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'project' ? -1 : 1
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    // Apply the plugin's own global switch set (never the SKILL.md attribute).
    const switches = readState().skills
    for (const it of items) it.enabled = effectiveSkillEnabled(switches, it.path, it.enabled)
    return items
  }

  /** Read one skill document (body included). */
  readSkill(path: string): SkillDetail | null {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8')
    const parsed = parseSkillFile(raw)
    if (parsed === null) return null
    return { ...parsed, path, enabled: effectiveSkillEnabled(readState().skills, path, parsed.enabled) }
  }

  /**
   * Enable/disable a skill by recording it in the plugin-owned switch set.
   * The SKILL.md file is never rewritten (the disable-model-invocation
   * attribute is no longer modified).
   */
  setSkillEnabled(path: string, enabled: boolean): void {
    const state = readState()
    state.skills = { ...state.skills, [path]: enabled }
    writeState(state)
  }

  /** Delete a skill (the whole bundle directory, or the flat .md file). */
  deleteSkill(path: string, kind: 'bundle' | 'file'): string {
    const target = kind === 'bundle' ? dirname(path) : path
    // A symlinked skill removes only the link (never the target's contents).
    let linked = false
    try { linked = lstatSync(target).isSymbolicLink() } catch { /* ignore */ }
    if (linked) { unlinkSync(target); return target }
    rmSync(target, { recursive: true, force: true })
    return target
  }

  /** Scan an arbitrary directory for importable skills. */
  scanSkills(dir: string): ScannedSkill[] {
    if (!existsSync(dir)) throw new Error('directory not found: ' + dir)
    const entries = readdirSync(dir, { withFileTypes: true })
    const items: ScannedSkill[] = []
    for (const entry of entries) {
      const name = entry.name
      if (!name || name[0] === '.') continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        const mdPath = join(full, 'SKILL.md')
        if (!existsSync(mdPath)) continue
        let raw: string
        try { raw = readFileSync(mdPath, 'utf8') } catch { continue }
        const parsed = parseSkillFile(raw)
        if (parsed !== null) items.push({ name: parsed.name, description: parsed.description, sourcePath: full, kind: 'bundle' })
      } else if (st.isFile() && name.endsWith('.md') && name !== 'SKILL.md') {
        let raw: string
        try { raw = readFileSync(full, 'utf8') } catch { continue }
        const parsed = parseSkillFile(raw)
        if (parsed !== null) items.push({ name: parsed.name, description: parsed.description, sourcePath: full, kind: 'file' })
      }
    }
    return items
  }

  /** Import selected skills into ~/.dsh/skills (skip names that already exist). */
  importSkills(items: ImportItem[]): ImportResult[] {
    const destDir = getRoots().userSkillsDir
    mkdirSync(destDir, { recursive: true })
    const results: ImportResult[] = []
    for (const it of items) {
      const base = join(destDir, it.sourcePath.split(/[\\/]/).pop() || '')
      if (existsSync(base)) {
        results.push({ name: base, ok: false, reason: 'already exists' })
        continue
      }
      try {
        if (it.mode === 'link') symlinkSync(it.sourcePath, base)
        else if (it.kind === 'bundle') cpSync(it.sourcePath, base, { recursive: true })
        else copyFileSync(it.sourcePath, base)
        results.push({ name: base, ok: true })
      } catch (e) {
        results.push({ name: base, ok: false, reason: String((e as Error)?.message ?? e) })
      }
    }
    return results
  }
}
