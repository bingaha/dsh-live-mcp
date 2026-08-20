import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BLACKLIST_FILE,
  LEGACY_SELECTION_FILE,
  blacklistPath,
  deleteSelection,
  readSelection,
  sessionDir,
  writeSelection,
} from './session-select.ts'

const SESSION = 'session-93dbcae2-804c-4c0a-a73e-1befd6d6d627'
const CWD = '/home/bing/workspace/dsh-skills-mcp-manager'

describe('session-select paths', () => {
  let home: string
  let prevHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skills-mcp-'))
    prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('puts the blacklist file in the official session directory', () => {
    const dir = sessionDir(SESSION, CWD)
    const file = blacklistPath(SESSION, CWD)
    expect(dir.endsWith(`/${SESSION}`)).toBe(true)
    expect(dir.includes('session-session-')).toBe(false)
    expect(file).toBe(path.join(dir, BLACKLIST_FILE))
    expect(file.endsWith(LEGACY_SELECTION_FILE)).toBe(false)
  })

  it('round-trips a non-empty blacklist', () => {
    writeSelection(SESSION, CWD, { mcp: ['mysql'] })
    expect(readSelection(SESSION, CWD)).toEqual({ mcp: ['mysql'] })
    expect(fs.readFileSync(blacklistPath(SESSION, CWD), 'utf8')).toContain('mysql')
  })

  it('treats an empty blacklist as no file', () => {
    writeSelection(SESSION, CWD, { mcp: ['mysql'] })
    writeSelection(SESSION, CWD, { mcp: [] })
    expect(readSelection(SESSION, CWD)).toEqual({})
    expect(() => fs.readFileSync(blacklistPath(SESSION, CWD), 'utf8')).toThrow()
  })

  it('reads a leftover orphan session-session-* selection file', () => {
    const orphan = path.join(
      home,
      'sessions',
      '--home-bing-workspace-dsh-skills-mcp-manager--',
      `session-${SESSION}`,
      LEGACY_SELECTION_FILE,
    )
    fs.mkdirSync(path.join(orphan, '..'), { recursive: true })
    fs.writeFileSync(orphan, JSON.stringify({ mcp: ['mysql'] }, null, 2), 'utf8')
    expect(readSelection(SESSION, CWD)).toEqual({ mcp: ['mysql'] })
  })

  it('migrates an orphan file onto the official path on write', () => {
    const orphanDir = path.join(
      home,
      'sessions',
      '--home-bing-workspace-dsh-skills-mcp-manager--',
      `session-${SESSION}`,
    )
    const orphan = path.join(orphanDir, LEGACY_SELECTION_FILE)
    fs.mkdirSync(orphanDir, { recursive: true })
    fs.writeFileSync(orphan, JSON.stringify({ mcp: ['chrome-devtools'] }, null, 2), 'utf8')

    writeSelection(SESSION, CWD, { mcp: ['mysql'] })

    expect(readSelection(SESSION, CWD)).toEqual({ mcp: ['mysql'] })
    expect(fs.readFileSync(blacklistPath(SESSION, CWD), 'utf8')).toContain('mysql')
    expect(() => fs.readFileSync(orphan, 'utf8')).toThrow()
  })

  it('deleteSelection removes both the new file and leftover orphans', () => {
    writeSelection(SESSION, CWD, { mcp: ['mysql'] })
    const orphanDir = path.join(
      home,
      'sessions',
      '--home-bing-workspace-dsh-skills-mcp-manager--',
      `session-${SESSION}`,
    )
    fs.mkdirSync(orphanDir, { recursive: true })
    fs.writeFileSync(path.join(orphanDir, LEGACY_SELECTION_FILE), '{"mcp":["x"]}', 'utf8')

    deleteSelection(SESSION, CWD)
    expect(readSelection(SESSION, CWD)).toEqual({})
  })
})
