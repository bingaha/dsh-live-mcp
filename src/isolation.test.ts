/**
 * ConversationIsolation must survive repeated status-bar toggles.
 *
 * DSH's tools.restrict() (and its disposer) emit `tools/change` synchronously.
 * The isolator listens to that event. If sync re-enters itself, the second
 * restrict overwrites denyDispose and the first layer is leaked — later
 * un-blacklisting a server cannot restore its tools.
 */
import { describe, expect, it } from 'vitest'
import { ConversationIsolation, type LiveAgent } from './isolation.ts'
import type { ConversationSelection } from './protocol.ts'

interface MockTool {
  name: string
}

function createHarness(tools: MockTool[]) {
  const agentRestrictions: Array<{ deny: readonly string[] }> = []
  const listeners = new Set<() => void>()

  const emitChange = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const host = {
    tools: {
      schemas: () => tools,
    },
  }

  const agentCtx = {
    tools: {
      guard: () => () => undefined,
      restrict: ({ deny }: { deny: readonly string[] }) => {
        const layer = { deny: [...deny] }
        agentRestrictions.push(layer)
        emitChange()
        return () => {
          const idx = agentRestrictions.indexOf(layer)
          if (idx >= 0) agentRestrictions.splice(idx, 1)
          emitChange()
        }
      },
    },
    on: (_event: string, listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  const agent: LiveAgent = { id: 'session-test', ctx: agentCtx as never }
  const isolation = new ConversationIsolation(host as never)
  const apply = (selection: ConversationSelection): void => isolation.apply(agent, selection)
  return { apply, agentRestrictions }
}

describe('ConversationIsolation', () => {
  it('does not leak a restrict layer when toggling a server on and off', () => {
    const { apply, agentRestrictions } = createHarness([
      { name: 'bash' },
      { name: 'mcp__chrome-devtools__navigate_page' },
      { name: 'mcp__chrome-devtools__take_screenshot' },
      { name: 'mcp__mysql__query' },
    ])

    apply({ mcp: ['chrome-devtools'] })
    expect(agentRestrictions).toHaveLength(1)
    expect(agentRestrictions[0]?.deny).toEqual([
      'mcp__chrome-devtools__navigate_page',
      'mcp__chrome-devtools__take_screenshot',
    ])

    apply({ mcp: [] })
    expect(agentRestrictions).toEqual([])

    apply({ mcp: ['chrome-devtools'] })
    apply({ mcp: [] })
    expect(agentRestrictions).toEqual([])
  })

  it('keeps only the current blacklist after swapping servers', () => {
    const { apply, agentRestrictions } = createHarness([
      { name: 'mcp__chrome-devtools__navigate_page' },
      { name: 'mcp__mysql__query' },
    ])

    apply({ mcp: ['chrome-devtools'] })
    apply({ mcp: ['mysql'] })
    expect(agentRestrictions).toHaveLength(1)
    expect(agentRestrictions[0]?.deny).toEqual(['mcp__mysql__query'])

    apply({ mcp: [] })
    expect(agentRestrictions).toEqual([])
  })
})
