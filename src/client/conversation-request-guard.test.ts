import { describe, expect, it } from 'vitest'
import { ConversationRequestGuard } from './conversation-request-guard.ts'

describe('ConversationRequestGuard', () => {
  it('rejects responses from an older operation', () => {
    const guard = new ConversationRequestGuard()
    const first = guard.begin('session-a\u0000/workspace-a')
    const second = guard.begin('session-a\u0000/workspace-a')

    expect(guard.isCurrent('session-a\u0000/workspace-a', first)).toBe(false)
    expect(guard.isCurrent('session-a\u0000/workspace-a', second)).toBe(true)
  })

  it('rejects responses after session or cwd changes', () => {
    const guard = new ConversationRequestGuard()
    const token = guard.begin('session-a\u0000/workspace-a')
    guard.begin('session-b\u0000/workspace-b')

    expect(guard.isCurrent('session-a\u0000/workspace-a', token)).toBe(false)
    expect(guard.isCurrent('session-b\u0000/workspace-b', token)).toBe(false)
  })

  it('allows only the latest operation in a rapid sequence', () => {
    const guard = new ConversationRequestGuard()
    const tokens = [1, 2, 3].map(() => guard.begin('session-a\u0000/workspace-a'))

    expect(tokens.map(token => guard.isCurrent('session-a\u0000/workspace-a', token))).toEqual([false, false, true])
  })
})
