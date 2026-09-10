// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { McpServerSummary } from '../protocol.ts'
import { SkillsMcpApi } from './api.ts'
import { SkillsMcpManager, WorkspaceDefaultsSection } from './manager.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getWorkspaceDefaults = vi.spyOn(SkillsMcpApi.prototype, 'getWorkspaceDefaults')
const setWorkspaceDefaults = vi.spyOn(SkillsMcpApi.prototype, 'setWorkspaceDefaults')

const servers: McpServerSummary[] = [
  { name: 'mysql', transport: 'stdio', status: 'running' },
  { name: 'broken', transport: 'stdio', status: 'failed' },
  { name: 'starting', transport: 'stdio', status: 'connecting' },
]

function workspaces(items: Array<{ workspaceId: string; title: string; path: string }>): WorkspaceListState {
  return {
    items: items.map((item) => ({ ...item, sessionIds: [], createdAt: 0, updatedAt: 0 })), 
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined,
  } as unknown as WorkspaceListState
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
  if (!(element instanceof HTMLButtonElement)) throw new Error('button not found: ' + text)
  return element
}

describe('WorkspaceDefaultsSection', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    getWorkspaceDefaults.mockReset()
    setWorkspaceDefaults.mockReset()
  })

  it('uses the runtime workspace order and writes only the selected non-first cwd', async () => {
    getWorkspaceDefaults.mockImplementation(async (cwd) => ({ selection: cwd === '/beta' ? { mcp: ['mysql'] } : {} }))
    setWorkspaceDefaults.mockResolvedValue({ selection: {} })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<WorkspaceDefaultsSection workspaces={workspaces([
        { workspaceId: 'first', title: 'Alpha', path: '/alpha' },
        { workspaceId: 'second', title: 'Beta', path: '/beta' },
      ])} servers={servers} loadingServers={false} refreshKey={0} />)
    })
    await flush()

    expect([...container.querySelectorAll('button')].map((element) => element.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Alpha'), expect.stringContaining('Beta'),
    ]))
    expect(getWorkspaceDefaults.mock.calls.map(([cwd]) => cwd)).toEqual(['/alpha', '/beta'])
    expect(container.textContent).toContain('默认屏蔽 1 个 MCP')

    await act(async () => { button(container, 'Beta').click() })
    await act(async () => { button(container, 'mysql').click() })
    await flush()

    expect(setWorkspaceDefaults).toHaveBeenCalledWith('/beta', { mcp: [] })
  })

  it('keeps only one workspace expanded at a time', async () => {
    getWorkspaceDefaults.mockResolvedValue({ selection: {} })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<WorkspaceDefaultsSection workspaces={workspaces([
        { workspaceId: 'first', title: 'Alpha', path: '/alpha' },
        { workspaceId: 'second', title: 'Beta', path: '/beta' },
      ])} servers={servers} loadingServers={false} refreshKey={0} />)
    })
    await flush()

    await act(async () => { button(container, 'Alpha').click() })
    expect(container.querySelectorAll('button').length).toBe(5)
    await act(async () => { button(container, 'Beta').click() })
    expect(container.querySelectorAll('button').length).toBe(5)
    expect(button(container, 'Alpha').getAttribute('aria-expanded')).toBe('false')
    expect(button(container, 'Beta').getAttribute('aria-expanded')).toBe('true')
  })

  it('renders workspace defaults only after selecting the workspace configuration tab', async () => {
    getWorkspaceDefaults.mockResolvedValue({ selection: {} })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<SkillsMcpManager workspaces={workspaces([{ workspaceId: 'first', title: 'Alpha', path: '/alpha' }])} enabled={true} pickDirectory={async () => null} />)
    })
    await flush()

    expect(container.textContent).not.toContain('工作区的新对话默认')
    await act(async () => { button(container, '工作区配置').click() })
    await flush()

    expect(container.textContent).toContain('工作区的新对话默认')
    expect(getWorkspaceDefaults).toHaveBeenCalledWith('/alpha')
  })

  it('renders the empty workspace summary without reading or writing defaults', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<WorkspaceDefaultsSection workspaces={workspaces([])} servers={servers} loadingServers={false} refreshKey={0} />)
    })
    await flush()

    expect(container.textContent).toContain('尚未配置工作区')
    expect(getWorkspaceDefaults).not.toHaveBeenCalled()
    expect(setWorkspaceDefaults).not.toHaveBeenCalled()
  })
})
