/**
 * Conversation status bar — registered in `conversation.input.dock`, the
 * full-width row above the composer card. Shows the current conversation's
 * capability selection (MCP servers + skills) and lets the user manage it.
 *
 * **Blacklist (deny-list) semantics** — the default is "everything globally
 * enabled is available" (an empty selection is a no-op). A conversation only
 * lists what to KEEP OUT: blacklisting a server excludes its tools from this
 * conversation; removing the block restores everything. An empty selection =
 * no config at all.
 *
 * Editing is ALWAYS available (anytime at any point in a conversation; the
 * host applies it live from the next model request).
 *
 * Every globally-enabled capability is listed as a chip:
 * - green = available in THIS conversation (not blacklisted / running)
 * - gray  = blacklisted here (kept out)
 * - red   = enabled but FAILED to connect (never injecting — even though you
 *   didn't blacklist it). Blacklist is per-SERVER, so a red server can still
 *   be toggled into/out of the blacklist by name.
 * Only globally-enabled capabilities are ever shown.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { ConversationMcpOption, ConversationSelection } from '../protocol.ts'
import { SkillsMcpApi, type ConversationView } from './api.ts'

interface DockProps {
  /** Session-scope owner share: point-in-time snapshots re-rendered for us. */
  session: { sessionId: string; blank: boolean }
  input: unknown
}

type CapKind = 'mcp' | 'skills'

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
const chipOn: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, background: 'rgba(47,180,90,0.2)', color: '#2fb45a', cursor: 'pointer', whiteSpace: 'nowrap',
}
const chipOff: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, background: 'rgba(128,128,128,0.15)', color: 'rgba(128,128,128,0.9)', cursor: 'pointer', whiteSpace: 'nowrap',
}
const chipRed: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, background: 'rgba(229,83,75,0.16)', color: '#e5534b', cursor: 'pointer', whiteSpace: 'nowrap',
}
const chipAmber: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, background: 'rgba(210,153,34,0.16)', color: '#d29922', cursor: 'pointer', whiteSpace: 'nowrap',
}
const hintStyle: CSSProperties = { opacity: 0.7 }

export function ConversationDock(props: DockProps) {
  const { session } = props
  const [view, setView] = useState<ConversationView | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    api.getConversation(session.sessionId).then(setView).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }
  useEffect(() => { load() }, [session.sessionId])

  if (view === null) {
    return <div style={{ ...rowStyle, opacity: 0.6 }}>会话能力…{error ? '（加载失败：' + error + '）' : ''}</div>
  }

  const { selection, available } = view
  const blockedMcp = new Set(selection.mcp ?? [])
  const blockedSkills = new Set(selection.skills ?? [])

  // Blacklist model: a server is ACTIVE in this conversation unless blacklisted.
  const save = (next: ConversationSelection) => {
    api.setConversation(session.sessionId, next).then((v) => setView(v)).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }

  const toggleOne = (cur: ConversationSelection, kind: CapKind, name: string) => {
    // The selectable pool is every globally-ENABLED capability. A failed
    // (red) server is still enabled, so it can be blacklisted by name — even
    // though its tools aren't currently registered, blacklisting it keeps it
    // out should it come back up later.
    const all = kind === 'mcp'
      ? available.mcp.map((o) => o.name)
      : available.skills
    if (!all.includes(name)) return
    const set = new Set(cur[kind] ?? [])
    if (set.has(name)) set.delete(name); else set.add(name)
    save({ ...cur, [kind]: [...set] })
  }

  const mcpChip = (opt: ConversationMcpOption) => {
    const blocked = blockedMcp.has(opt.name)
    // Render priority: blacklist (your choice) OVERRIDES the raw connection
    // display — blacklisted → gray regardless of status. Red is ONLY the real
    // load status (failed) shown when you have NOT blacklisted it. Config
    // (`enabled`) decides which servers appear at all, never their color.
    let style: CSSProperties
    let title: string
    if (blocked) {
      style = chipOff
      title = opt.status === 'failed'
        ? '已加入黑名单（连接失败）：点击恢复可用'
        : '已加入黑名单，本会话不注入：点击恢复可用'
    } else if (opt.status === 'failed') {
      style = chipRed
      title = '已启用但连接失败，未注入工具：点击加入黑名单'
    } else if (opt.status === 'connecting') {
      style = chipAmber
      title = '连接中，当前可用：点击加入黑名单'
    } else {
      style = chipOn
      title = '可用：点击加入黑名单'
    }
    return (
      <span
        key={'mcp:' + opt.name}
        style={style}
        title={title}
        onClick={() => toggleOne(selection, 'mcp', opt.name)}
      >{opt.name}</span>
    )
  }

  const skillChip = (name: string) => {
    const blocked = blockedSkills.has(name)
    const style = blocked ? chipOff : chipOn
    const title = blocked ? '已加入黑名单，点击恢复' : '可用，点击加入黑名单'
    return (
      <span
        key={'skills:' + name}
        style={style}
        title={title}
        onClick={() => toggleOne(selection, 'skills', name)}
      >{name}</span>
    )
  }

  const missing = [...(selection.mcp ?? []), ...(selection.skills ?? [])]
    .filter((n) => !available.mcp.some((o) => o.name === n) && !available.skills.includes(n))

  const blockedCount = blockedMcp.size + blockedSkills.size

  return (
    <div style={rowStyle}>
      <span style={labelStyle}>
        {blockedCount === 0 ? '全部可用' : '黑名单'}
      </span>

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
          : available.skills.map((n) => skillChip(n))}
      </div>

      {missing.length > 0 && (
        <span style={hintStyle} title="这些已不在全局启用中">移出：{missing.join('、')}</span>
      )}
      {error ? <span style={{ color: '#e5534b' }}>{error}</span> : null}
    </div>
  )
}
