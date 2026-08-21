/**
 * Conversation status bar — registered in `conversation.input.dock`, the
 * full-width row above the composer card. Shows this conversation's MCP
 * servers and skills as grouped chips.
 *
 * **Skills** are read-only author policy (model-invocable / user-invocable).
 * Chips are not clickable and are never grayed from a session skill
 * deny-list. Colors: green (both invocable), yellow (model off), orange
 * (user off), red (both off).
 *
 * **MCP** is still a per-conversation deny-list: empty selection = every
 * globally-enabled server is available. Clicking a chip toggles that
 * server's name in the session file. Gray (blocked) overrides connection
 * status; a failed (red) server can still be clicked to gray.
 *
 * Editing MCP is ALWAYS available (the host applies it live from the next
 * model request). Only globally-enabled MCP servers and scanned skills are
 * shown — leftover names in the session file do not occupy the bar.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { ConversationMcpOption, ConversationSelection, ConversationSkillOption } from '../protocol.ts'
import { SkillsMcpApi, type ConversationView } from './api.ts'
import { subscribeCapabilityChange } from './notify.ts'

interface DockProps {
  /** Session-scope owner share: point-in-time snapshots re-rendered for us. */
  session: { sessionId: string; blank: boolean }
  input: unknown
}

const api = new SkillsMcpApi()

// The dock rides inside `.composerStack`; hero (blank) and active phases size
// it differently, so pin both to the composer card width and center it — the
// status bar then sits centered above the card in new AND old conversations.
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 8,
  flexWrap: 'wrap',
  padding: '4px 12px',
  fontSize: 12,
  color: 'rgba(128,128,128,0.95)',
  width: '100%',
  maxWidth: 'var(--dsh-composer-card-max-width)',
  alignSelf: 'center',
}
const groupStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const labelStyle: CSSProperties = { fontWeight: 600, opacity: 0.85 }
const chipBase: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap',
}
const chipOn: CSSProperties = {
  ...chipBase, background: 'rgba(47,180,90,0.2)', color: '#2fb45a', cursor: 'pointer',
}
const chipOff: CSSProperties = {
  ...chipBase, background: 'rgba(128,128,128,0.15)', color: 'rgba(128,128,128,0.9)', cursor: 'pointer',
}
const chipRed: CSSProperties = {
  ...chipBase, background: 'rgba(229,83,75,0.16)', color: '#e5534b', cursor: 'pointer',
}
const chipAmber: CSSProperties = {
  ...chipBase, background: 'rgba(210,153,34,0.16)', color: '#d29922', cursor: 'pointer',
}
const chipSkillGreen: CSSProperties = {
  ...chipBase, background: 'rgba(47,180,90,0.2)', color: '#2fb45a', cursor: 'default',
}
const chipSkillYellow: CSSProperties = {
  ...chipBase, background: 'rgba(201,162,39,0.2)', color: '#c9a227', cursor: 'default',
}
const chipSkillOrange: CSSProperties = {
  ...chipBase, background: 'rgba(224,138,44,0.2)', color: '#e08a2c', cursor: 'default',
}
const chipSkillRed: CSSProperties = {
  ...chipBase, background: 'rgba(229,83,75,0.16)', color: '#e5534b', cursor: 'default',
}
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

export function ConversationDock(props: DockProps) {
  const { session } = props
  const [view, setView] = useState<ConversationView | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    api.getConversation(session.sessionId).then(setView).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }
  useEffect(() => {
    load()
    const unsub = subscribeCapabilityChange(() => load())
    return unsub
  }, [session.sessionId])

  if (view === null) {
    return <div style={{ ...rowStyle, opacity: 0.6 }}>会话能力…{error ? '（加载失败：' + error + '）' : ''}</div>
  }

  const { selection, available } = view
  const blockedMcp = new Set(selection.mcp ?? [])

  const save = (next: ConversationSelection) => {
    api.setConversation(session.sessionId, next).then((v) => setView(v)).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }

  const toggleMcp = (cur: ConversationSelection, name: string) => {
    // The selectable pool is every globally-ENABLED MCP server. A failed
    // (red) server is still enabled, so it can be blocked by name — even
    // though its tools aren't currently registered, blocking it keeps it
    // out should it come back up later. Skills are not written here.
    const all = available.mcp.map((o) => o.name)
    if (!all.includes(name)) return
    const set = new Set(cur.mcp ?? [])
    if (set.has(name)) set.delete(name); else set.add(name)
    save({ ...cur, mcp: [...set] })
  }

  const mcpChip = (opt: ConversationMcpOption) => {
    const blocked = blockedMcp.has(opt.name)
    // Render priority: session block OVERRIDES the raw connection display —
    // blocked → gray regardless of status. Red is ONLY the real load status
    // (failed) shown when you have NOT blocked it. Config (`enabled`) decides
    // which servers appear at all, never their color.
    let style: CSSProperties
    if (blocked) {
      style = chipOff
    } else if (opt.status === 'failed') {
      style = chipRed
    } else if (opt.status === 'connecting') {
      style = chipAmber
    } else {
      style = chipOn
    }
    return (
      <span
        key={'mcp:' + opt.name}
        style={style}
        title={mcpChipTitle(blocked, opt.status)}
        onClick={() => toggleMcp(selection, opt.name)}
      >{opt.name}</span>
    )
  }

  const skillChip = (opt: ConversationSkillOption) => {
    return (
      <span
        key={'skills:' + opt.name}
        style={skillChipStyle(opt)}
        title={skillChipTitle(opt)}
      >{opt.name}</span>
    )
  }

  return (
    <div style={rowStyle}>
      <div style={groupStyle}>
        <span style={labelStyle}>MCP</span>
        {available.mcp.length === 0
          ? <span style={hintStyle}>无</span>
          : available.mcp.map((o) => mcpChip(o))}
      </div>

      <div style={groupStyle}>
        <span style={labelStyle}>技能</span>
        {available.skills.length === 0
          ? <span style={hintStyle}>无</span>
          : available.skills.map((s) => skillChip(s))}
      </div>

      {error ? <span style={{ color: '#e5534b' }}>{error}</span> : null}
    </div>
  )
}
