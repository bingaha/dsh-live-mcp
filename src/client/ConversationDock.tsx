/**
 * Conversation status bar — registered in `conversation.input.dock`, the
 * full-width row above the composer card. Shows this conversation's MCP
 * servers and skills as grouped chips.
 *
 * MCP is a per-conversation deny-list: an empty selection allows every
 * globally-enabled server. A blocked server stays gray even when its
 * connection status changes. Skills are read-only author policy.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationMcpOption, ConversationSelection, ConversationSkillOption } from '../protocol.ts'
import { SkillsMcpApi, type ConversationView } from './api.ts'
import { ConversationRequestGuard } from './conversation-request-guard.ts'
import { subscribeCapabilityChange } from './notify.ts'

interface WorkspaceSnapshot {
  items: ReadonlyArray<{ path: string; sessionIds: readonly string[] }>
}

type DockProps = PropsRuntime<'conversation.input.dock'> & {
  session: { sessionId: string; blank: boolean }
  input: unknown
}

const api = new SkillsMcpApi()

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8,
  flexWrap: 'wrap', padding: '4px 12px', fontSize: 12,
  color: 'rgba(128,128,128,0.95)', width: '100%',
  maxWidth: 'var(--dsh-composer-card-max-width)', alignSelf: 'center',
}
const groupStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const labelStyle: CSSProperties = { fontWeight: 600, opacity: 0.85 }
const chipBase: CSSProperties = { padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap' }
const chipOn: CSSProperties = { ...chipBase, background: 'rgba(47,180,90,0.2)', color: '#2fb45a', cursor: 'pointer' }
const chipOff: CSSProperties = { ...chipBase, background: 'rgba(128,128,128,0.15)', color: 'rgba(128,128,128,0.9)', cursor: 'pointer' }
const chipRed: CSSProperties = { ...chipBase, background: 'rgba(229,83,75,0.16)', color: '#e5534b', cursor: 'pointer' }
const chipAmber: CSSProperties = { ...chipBase, background: 'rgba(210,153,34,0.16)', color: '#d29922', cursor: 'pointer' }
const chipSkillGreen: CSSProperties = { ...chipBase, background: 'rgba(47,180,90,0.2)', color: '#2fb45a', cursor: 'default' }
const chipSkillYellow: CSSProperties = { ...chipBase, background: 'rgba(201,162,39,0.2)', color: '#c9a227', cursor: 'default' }
const chipSkillOrange: CSSProperties = { ...chipBase, background: 'rgba(224,138,44,0.2)', color: '#e08a2c', cursor: 'default' }
const chipSkillRed: CSSProperties = { ...chipBase, background: 'rgba(229,83,75,0.16)', color: '#e5534b', cursor: 'default' }
const hintStyle: CSSProperties = { opacity: 0.7 }

function skillChipStyle(opt: ConversationSkillOption): CSSProperties {
  if (!opt.modelInvocable && !opt.userInvocable) return chipSkillRed
  if (!opt.modelInvocable) return chipSkillYellow
  if (!opt.userInvocable) return chipSkillOrange
  return chipSkillGreen
}

function skillChipTitle(opt: ConversationSkillOption): string {
  if (!opt.modelInvocable && !opt.userInvocable) return '模型不可用，用户不可用'
  if (!opt.modelInvocable) return '模型不可用'
  if (!opt.userInvocable) return '用户不可用'
  return '可用'
}

function mcpChipTitle(blocked: boolean, status: ConversationMcpOption['status']): string {
  if (blocked) return '已屏蔽'
  if (status === 'failed') return '连接失败'
  if (status === 'connecting') return '连接中'
  return '可用'
}

function workspaceCwd(snapshot: WorkspaceSnapshot, sessionId: string): string {
  return snapshot.items.find(workspace => workspace.sessionIds.includes(sessionId))?.path ?? ''
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
}

export function ConversationDock(props: DockProps) {
  const { session, useWorkspaces } = props
  const cwd = useWorkspaces(snapshot => workspaceCwd(snapshot, session.sessionId))
  const identity = session.sessionId + '\u0000' + cwd
  const [view, setView] = useState<ConversationView | null>(null)
  const [error, setError] = useState('')
  const viewRef = useRef<ConversationView | null>(null)
  const guardRef = useRef(new ConversationRequestGuard())
  const saveTailRef = useRef<Promise<void>>(Promise.resolve())

  // A new session or workspace must never paint the previous session's chips
  // while the next capability request is pending.
  useLayoutEffect(() => {
    guardRef.current.begin(identity)
    viewRef.current = null
    setView(null)
    setError('')
  }, [identity])

  const install = (next: ConversationView) => {
    viewRef.current = next
    setView(next)
  }

  const load = (preserveSelection: boolean) => {
    const version = guardRef.current.begin(identity)
    const request = session.blank
      ? api.initializeConversation(session.sessionId, cwd)
      : api.getConversation(session.sessionId, cwd)
    request.then((response) => {
      if (!guardRef.current.isCurrent(identity, version)) return
      // A capability notification changes only candidates and connection
      // status. Keep the locally selected deny-list until its write settles.
      const current = viewRef.current
      install(preserveSelection && current !== null
        ? { ...response, selection: current.selection }
        : response)
      setError('')
    }).catch((cause) => {
      if (guardRef.current.isCurrent(identity, version)) setError(errorMessage(cause))
    })
  }

  useEffect(() => {
    load(false)
    const unsub = subscribeCapabilityChange(() => load(true))
    return unsub
  }, [identity, session.blank])

  const save = (next: ConversationSelection) => {
    const version = guardRef.current.begin(identity)
    // User intent is visible immediately and invalidates an in-flight blank
    // initializer before it can overwrite the chip state.
    if (viewRef.current !== null) install({ ...viewRef.current, selection: next })
    setError('')
    saveTailRef.current = saveTailRef.current.catch(() => undefined).then(async () => {
      const response = await api.setConversation(session.sessionId, cwd, next)
      if (guardRef.current.isCurrent(identity, version)) {
        install(response)
        setError('')
      }
    }).catch((cause) => {
      if (guardRef.current.isCurrent(identity, version)) setError(errorMessage(cause))
    })
  }

  const toggleMcp = (name: string) => {
    const current = viewRef.current
    if (current === null || !current.available.mcp.some(option => option.name === name)) return
    const blocked = new Set(current.selection.mcp ?? [])
    if (blocked.has(name)) blocked.delete(name); else blocked.add(name)
    save({ ...current.selection, mcp: [...blocked] })
  }

  if (view === null) {
    return <div style={{ ...rowStyle, opacity: 0.6 }}>会话能力…{error ? '（加载失败：' + error + '）' : ''}</div>
  }

  const blockedMcp = new Set(view.selection.mcp ?? [])
  const mcpChip = (opt: ConversationMcpOption) => {
    const blocked = blockedMcp.has(opt.name)
    const style = blocked ? chipOff
      : opt.status === 'failed' ? chipRed
        : opt.status === 'connecting' ? chipAmber
          : chipOn
    return <span key={'mcp:' + opt.name} style={style} title={mcpChipTitle(blocked, opt.status)} onClick={() => toggleMcp(opt.name)}>{opt.name}</span>
  }
  const skillChip = (opt: ConversationSkillOption) =>
    <span key={'skills:' + opt.name} style={skillChipStyle(opt)} title={skillChipTitle(opt)}>{opt.name}</span>

  return (
    <div style={rowStyle}>
      <div style={groupStyle}>
        <span style={labelStyle}>MCP</span>
        {view.available.mcp.length === 0 ? <span style={hintStyle}>无</span> : view.available.mcp.map(mcpChip)}
      </div>
      <div style={groupStyle}>
        <span style={labelStyle}>技能</span>
        {view.available.skills.length === 0 ? <span style={hintStyle}>无</span> : view.available.skills.map(skillChip)}
      </div>
      {error ? <span style={{ color: '#e5534b' }}>{error}</span> : null}
    </div>
  )
}
