/**
 * Conversation status bar — registered in `conversation.input.dock`, the
 * full-width row above the composer card. Shows the current conversation's
 * capability selection (MCP servers + skills) and lets the user manage it.
 *
 * Editing is gated on the session still being blank (no produced output), the
 * only window in which DSH permits changing a conversation's isolated tool
 * scope. Once a conversation has produced output it renders read-only.
 *
 * Every globally-enabled capability is always listed as a chip; a chip is
 * lit (green) when it is active in THIS conversation, gray otherwise. In an
 * isolated conversation only the active chips enter context; clicking a chip
 * toggles its membership. Only globally-enabled capabilities are ever shown.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { ConversationSelection } from '../protocol.ts'
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
const chipLocked: CSSProperties = { ...chipOn, cursor: 'default' }
const toggleBase: CSSProperties = {
  font: 'inherit', fontSize: 12, padding: '2px 10px', borderRadius: 999, border: '1px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap',
}
const toggleOn: CSSProperties = { ...toggleBase, background: 'rgba(47,180,90,0.25)', color: '#2fb45a' }
const toggleOff: CSSProperties = { ...toggleBase, background: 'rgba(128,128,128,0.15)', color: 'rgba(128,128,128,0.9)' }

export function ConversationDock(props: DockProps) {
  const { session } = props
  const editable = session.blank === true
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
  const isolated = selection.isolated === true
  // What actually enters context: non-isolated → every enabled candidate;
  // isolated → only the selected (intersected with what is still enabled).
  const activeMcp: string[] = isolated ? (selection.mcp ?? []).filter((n) => available.mcp.includes(n)) : available.mcp
  const activeSkills: string[] = isolated ? (selection.skills ?? []).filter((n) => available.skills.includes(n)) : available.skills
  const activeMcpSet = new Set(activeMcp)
  const activeSkillsSet = new Set(activeSkills)

  const save = (next: ConversationSelection) => {
    api.setConversation(session.sessionId, next).then((v) => setView(v)).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }

  const toggleIsolated = () => {
    if (isolated) {
      // Turning isolation OFF means "use everything enabled".
      save({ isolated: false, skills: available.skills, mcp: available.mcp })
    } else {
      // Turning isolation ON with no selection yet → start from "everything
      // selected", so the user removes what they don't want.
      save({ isolated: true, skills: available.skills, mcp: available.mcp })
    }
  }

  const toggleOne = (cur: ConversationSelection, kind: CapKind, name: string) => {
    const all = kind === 'mcp' ? available.mcp : available.skills
    if (!all.includes(name)) return // only globally-enabled capabilities are selectable
    const set = new Set(cur[kind] ?? [])
    if (set.has(name)) set.delete(name); else set.add(name)
    save({ ...cur, [kind]: [...set] })
  }

  const clickChip = (kind: CapKind, name: string) => {
    if (!isolated) {
      // Picking a specific capability implicitly isolates the conversation:
      // enable isolation starting from "all selected", then toggle this one.
      toggleOne({ isolated: true, skills: available.skills, mcp: available.mcp }, kind, name)
    } else {
      toggleOne(selection, kind, name)
    }
  }

  const chip = (name: string, kind: CapKind, on: boolean) => {
    const style = !editable ? chipLocked : on ? chipOn : chipOff
    return (
      <span
        key={kind + ':' + name}
        style={style}
        title={editable ? (on ? '在上下文中，点击移除' : '不在上下文中，点击加入') : '已锁定'}
        onClick={editable ? () => clickChip(kind, name) : undefined}
      >{name}</span>
    )
  }

  const missing = [...(selection.mcp ?? []), ...(selection.skills ?? [])]
    .filter((n) => !available.mcp.includes(n) && !available.skills.includes(n))

  return (
    <div style={rowStyle}>
      <button
        type="button"
        style={isolated ? toggleOn : toggleOff}
        onClick={editable ? toggleIsolated : undefined}
        title={editable ? (isolated ? '本会话仅使用所选能力' : '本会话使用全部全局启用能力') : '会话已产出，锁定'}
      >
        {isolated ? '已隔离' : '未隔离'}
      </button>

      <div style={groupStyle}>
        <span style={labelStyle}>MCP</span>
        {available.mcp.length === 0
          ? <span style={{ opacity: 0.6 }}>无</span>
          : available.mcp.map((n) => chip(n, 'mcp', activeMcpSet.has(n)))}
      </div>

      <div style={groupStyle}>
        <span style={labelStyle}>技能</span>
        {available.skills.length === 0
          ? <span style={{ opacity: 0.6 }}>无</span>
          : available.skills.map((n) => chip(n, 'skills', activeSkillsSet.has(n)))}
      </div>

      {missing.length > 0 && (
        <span style={{ opacity: 0.7 }} title="这些已不在全局启用中">移出：{missing.join('、')}</span>
      )}
      {!editable && <span style={{ opacity: 0.6 }}>（已产出，只读）</span>}
      {error ? <span style={{ color: '#e5534b' }}>{error}</span> : null}
    </div>
  )
}
