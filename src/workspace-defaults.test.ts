import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WORKSPACE_DEFAULTS_FILE,
  WORKSPACE_DEFAULTS_VERSION,
  readWorkspaceDefaults,
  resetWorkspaceDefaultsOperations,
  updateWorkspaceDefaults,
  workspaceDefaultsPath,
  writeWorkspaceDefaults,
} from './workspace-defaults.ts'

const FIRST_CWD = '/workspaces/alpha'
const SECOND_CWD = '/workspaces/beta'

describe('workspace defaults', () => {
  let home: string
  let previousHome: string | undefined

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-defaults-'))
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    resetWorkspaceDefaultsOperations()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
    resetWorkspaceDefaultsOperations()
  })

  it('stores versioned blacklists independently by absolute cwd', async () => {
    await writeWorkspaceDefaults(FIRST_CWD, { mcp: ['mysql'] })
    await writeWorkspaceDefaults(SECOND_CWD, { mcp: ['chrome-devtools'] })

    expect(readWorkspaceDefaults(FIRST_CWD)).toEqual({ selection: { mcp: ['mysql'] } })
    expect(readWorkspaceDefaults(SECOND_CWD)).toEqual({ selection: { mcp: ['chrome-devtools'] } })
    expect(JSON.parse(fs.readFileSync(workspaceDefaultsPath(), 'utf8'))).toEqual({
      version: WORKSPACE_DEFAULTS_VERSION,
      workspaces: {
        [FIRST_CWD]: { mcp: ['mysql'] },
        [SECOND_CWD]: { mcp: ['chrome-devtools'] },
      },
    })
  })

  it('removes the cwd mapping for an empty blacklist', async () => {
    await writeWorkspaceDefaults(FIRST_CWD, { mcp: ['mysql'] })
    await writeWorkspaceDefaults(FIRST_CWD, { mcp: [] })

    expect(readWorkspaceDefaults(FIRST_CWD)).toEqual({ selection: {} })
    expect(JSON.parse(fs.readFileSync(workspaceDefaultsPath(), 'utf8'))).toEqual({
      version: WORKSPACE_DEFAULTS_VERSION,
      workspaces: {},
    })
  })

  it('ignores unknown fields while reading and retains known blacklist values', () => {
    fs.writeFileSync(workspaceDefaultsPath(), JSON.stringify({
      version: 99,
      futureTopLevel: true,
      workspaces: {
        [FIRST_CWD]: { mcp: ['mysql', 42], futureEntryField: 'ignored' },
      },
    }), 'utf8')

    expect(readWorkspaceDefaults(FIRST_CWD)).toEqual({ selection: { mcp: ['mysql'] } })
  })

  it('degrades corrupt and unreadable defaults to an empty blacklist with an error', () => {
    fs.writeFileSync(workspaceDefaultsPath(), '{not json', 'utf8')
    const corrupt = readWorkspaceDefaults(FIRST_CWD)
    expect(corrupt.selection).toEqual({})
    expect(corrupt.error).toContain('JSON')

    fs.rmSync(workspaceDefaultsPath())
    fs.mkdirSync(workspaceDefaultsPath())
    const unreadable = readWorkspaceDefaults(FIRST_CWD)
    expect(unreadable.selection).toEqual({})
    expect(unreadable.error).toBeTruthy()
  })

  it('serializes same-cwd read-modify-write updates without losing server names', async () => {
    await Promise.all([
      updateWorkspaceDefaults(FIRST_CWD, (current) => ({ mcp: [...(current.mcp ?? []), 'mysql'] })),
      updateWorkspaceDefaults(FIRST_CWD, (current) => ({ mcp: [...(current.mcp ?? []), 'chrome-devtools'] })),
    ])

    expect(readWorkspaceDefaults(FIRST_CWD)).toEqual({
      selection: { mcp: ['mysql', 'chrome-devtools'] },
    })
  })

  it('publishes through rename without leaving a temporary file', async () => {
    await writeWorkspaceDefaults(FIRST_CWD, { mcp: ['mysql'] })

    expect(fs.readdirSync(home)).toEqual([WORKSPACE_DEFAULTS_FILE])
  })

  it('rejects relative workspace paths', async () => {
    expect(() => readWorkspaceDefaults('relative')).toThrow('cwd must be absolute')
    await expect(writeWorkspaceDefaults('relative', { mcp: ['mysql'] })).rejects.toThrow('cwd must be absolute')
  })
})
