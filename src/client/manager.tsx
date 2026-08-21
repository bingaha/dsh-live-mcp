/**
 * The skills + MCP management UI rendered inside the settings card. Pure
 * React (no framework services): every data access goes through SkillsMcpApi,
 * which fetches the /api/dsh-skills-mcp routes. Inline Chinese copy mirrors
 * the original dynamic plugin; the card chrome above stays bilingual.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { SkillsMcpApi } from './api.ts'
import { notifyCapabilityChange } from './notify.ts'
import type { McpServerConfig, McpServerSummary, ScannedSkill, SkillSummary } from '../protocol.ts'
import css from './settings-card.module.css'

/** Stateless fetch client (created once per module). */
const api = new SkillsMcpApi()

function sourceLabel(source: string): string {
  if (source === 'project-dsh') return '.dsh/skills'
  if (source === 'project-agents') return '.agents/skills'
  if (source === 'user-dsh') return '~/.dsh/skills'
  if (source === 'user-agents') return '~/.agents/skills'
  return source
}

function parseKv(text: string): Record<string, string> {
  const obj: Record<string, string> = {}
  if (!text) return obj
  text.split(/\n/).forEach((line) => {
    const t = line.trim()
    if (!t) return
    const i = t.indexOf('=')
    if (i < 0) return
    obj[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  })
  return obj
}

function kvText(obj: Record<string, string> | undefined): string {
  return Object.keys(obj || {}).map((k) => k + '=' + (obj || {})[k]).join('\n')
}

/** Status-bar color matrix: green / yellow / orange / red from author policy. */
function skillDotClass(skill: SkillSummary): string {
  if (skill.modelInvocable && skill.userInvocable) return css.dotOn
  if (!skill.modelInvocable && skill.userInvocable) return css.dotYellow
  if (skill.modelInvocable && !skill.userInvocable) return css.dotOrange
  return css.dotOff
}

function skillDotTitle(skill: SkillSummary): string {
  if (skill.modelInvocable && skill.userInvocable) return '可用'
  if (!skill.modelInvocable && skill.userInvocable) return '模型不可用'
  if (skill.modelInvocable && !skill.userInvocable) return '用户不可用'
  return '模型不可用，用户不可用'
}

interface McpForm {
  name: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  mode: 'form' | 'json'
  json: string
}

const EMPTY_FORM: McpForm = {
  name: '', transport: 'stdio', command: '', args: '', env: '', cwd: '', url: '', headers: '', mode: 'form', json: '',
}

/** Top-level manager with the Skills / MCP tabs. */
export function SkillsMcpManager(props: { cwd: string; enabled: boolean; pickDirectory: () => Promise<string | null> }) {
  const [tab, setTab] = useState<'skills' | 'mcp'>('skills')
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = () => { setRefreshKey((k) => k + 1) }

  return (
    <div className={css.manager}>
      <div className={css.tabs}>
        <button type="button" className={tab === 'skills' ? css.tabActive : css.tab} onClick={() => { setTab('skills') }}>Skills 技能</button>
        <button type="button" className={tab === 'mcp' ? css.tabActive : css.tab} onClick={() => { setTab('mcp') }}>MCP 服务</button>
      </div>
      {props.enabled
        ? null
        : <p className={css.disabledBanner} role="status">插件已禁用：路由与 MCP 连接均已停止，重新启用后刷新即可恢复。</p>}
      {tab === 'skills'
        ? <SkillsPanel cwd={props.cwd} refreshKey={refreshKey} onChanged={bump} pickDirectory={props.pickDirectory} />
        : <McpPanel refreshKey={refreshKey} onChanged={bump} />}
    </div>
  )
}

function SkillsPanel(props: { cwd: string; refreshKey: number; onChanged: () => void; pickDirectory: () => Promise<string | null> }) {
  const [list, setList] = useState<{ loading: boolean; items: SkillSummary[]; error: string }>({ loading: true, items: [], error: '' })
  const [detailName, setDetailName] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ path: string; data: any } | null>(null)
  const [scan, setScan] = useState<{ dir: string; busy: boolean; items: ScannedSkill[]; selected: Record<string, boolean>; mode: 'copy' | 'link'; error: string; note: string }>({ dir: '', busy: false, items: [], selected: {}, mode: 'copy', error: '', note: '' })
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [policyFilter, setPolicyFilter] = useState<'all' | 'model-off' | 'user-off'>('all')

  const load = () => {
    setList({ loading: true, items: [], error: '' })
    api.listSkills(props.cwd).then((items) => {
      setList({ loading: false, items, error: '' })
    }).catch((e) => {
      setList({ loading: false, items: [], error: String((e as Error)?.message || e) })
    })
  }

  useEffect(() => { load() }, [props.cwd, props.refreshKey])

  const remove = (skill: SkillSummary) => {
    if (confirmDel !== skill.path) { setConfirmDel(skill.path); return }
    setConfirmDel(null)
    setBusy(skill.path)
    setMsg('')
    api.deleteSkill(skill.path, skill.kind).then(() => {
      setBusy('')
      if (detailName === skill.path) { setDetailName(null); setDetail(null) }
      load()
      notifyCapabilityChange()
    }).catch((e) => { setBusy(''); setMsg(String((e as Error)?.message || e)) })
  }

  const view = (skill: SkillSummary) => {
    if (detailName === skill.path) { setDetailName(null); setDetail(null); return }
    setDetailName(skill.path)
    setDetail(null)
    api.readSkill(skill.path).then((data) => {
      setDetail({ path: skill.path, data })
    }).catch((e) => {
      setDetail({ path: skill.path, data: { error: String((e as Error)?.message || e) } })
    })
  }

  const chooseDir = () => {
    props.pickDirectory().then((path) => {
      if (path) setScan((prev) => ({ ...prev, dir: path, error: '' }))
    }).catch((e) => {
      setScan((prev) => ({ ...prev, error: String((e as Error)?.message || e) }))
    })
  }

  const doScan = () => {
    const dir = scan.dir.trim()
    if (!dir) { setScan((prev) => ({ ...prev, error: '请输入目录路径' })); return }
    setScan((prev) => ({ ...prev, busy: true, items: [], error: '', note: '' }))
    api.scanSkills(dir).then((items) => {
      setScan((prev) => ({ ...prev, busy: false, items, selected: {}, note: items.length === 0 ? '未发现可导入的技能' : '' }))
    }).catch((e) => {
      setScan((prev) => ({ ...prev, busy: false, items: [], error: String((e as Error)?.message || e) }))
    })
  }

  const toggleSelect = (sourcePath: string) => {
    setScan((prev) => {
      const selected = { ...prev.selected }
      if (selected[sourcePath]) delete selected[sourcePath]
      else selected[sourcePath] = true
      return { ...prev, selected }
    })
  }

  const doImport = () => {
    const chosen = scan.items.filter((it) => scan.selected[it.sourcePath])
    if (chosen.length === 0) { setScan((prev) => ({ ...prev, error: '请先勾选要导入的技能' })); return }
    setScan((prev) => ({ ...prev, busy: true, error: '' }))
    api.importSkills(chosen.map((it) => ({ sourcePath: it.sourcePath, kind: it.kind, mode: scan.mode }))).then((results) => {
      const imported = results.filter((x) => x.ok).length
      const skipped = results.filter((x) => !x.ok)
      let note = '导入完成：' + imported + ' 个成功，' + skipped.length + ' 个跳过'
      if (skipped.length > 0) {
        const why = skipped.map((x) => (x.reason === 'already exists' ? '已存在' : (x.reason || '失败'))).join('、')
        note += '（' + why + '）'
      }
      setScan((prev) => ({ ...prev, busy: false, selected: {}, note }))
      load()
      notifyCapabilityChange()
    }).catch((e) => {
      setScan((prev) => ({ ...prev, busy: false, error: String((e as Error)?.message || e) }))
    })
  }

  const q = query.trim().toLowerCase()
  const filtered = list.items.filter((it) => {
    if (q !== '' && !it.name.toLowerCase().includes(q)) return false
    if (policyFilter === 'model-off' && it.modelInvocable) return false
    if (policyFilter === 'user-off' && it.userInvocable) return false
    return true
  })
  const byLevel: Record<string, SkillSummary[]> = {}
  filtered.forEach((it) => { (byLevel[it.level] = byLevel[it.level] || []).push(it) })

  const rows: ReactNode[] = []
  ;[['project', '项目级'], ['user', '用户级']].forEach(([level, label]) => {
    const gs = byLevel[level as string] || []
    if (gs.length === 0) return
    rows.push(<div key={'g-' + level} className={css.groupH}>{label} ({gs.length})</div>)
    gs.forEach((skill) => {
      const isBusy = busy === skill.path
      const open = detailName === skill.path
      const entry = detail
      const d = (open && entry && entry.path === skill.path) ? entry.data : null
      rows.push(
        <div key={skill.path} className={css.row + (open ? ' ' + css.rowOpen : '')}>
          <div className={css.rowHead}>
            <div className={css.main} style={{ cursor: 'pointer' }} onClick={() => { view(skill) }}>
              <div className={css.nameLine}>
                <span className={css.statusDot + ' ' + skillDotClass(skill)} title={skillDotTitle(skill)} />
                <span className={css.name}>{skill.name}</span>
                {skill.linked ? <span className={css.badge}>软链</span> : null}
                {!skill.modelInvocable ? <span className={css.policyTag}>模型不可用</span> : null}
                {!skill.userInvocable ? <span className={css.policyTag}>用户不可用</span> : null}
              </div>
              {skill.description ? <div className={css.desc}>{skill.description}</div> : null}
            </div>
            <span className={css.badge}>{sourceLabel(skill.source)}</span>
            <button type="button" className={css.btn} onClick={(e) => { e.stopPropagation(); view(skill) }}>{open ? '收起' : '详情'}</button>
            <button type="button" className={css.btn + ' ' + css.btnDanger} disabled={isBusy} onClick={(e) => { e.stopPropagation(); remove(skill) }}>{confirmDel === skill.path ? '确认删除?' : '删除'}</button>
          </div>
          {open
            ? <div className={css.preview}>
                {d === null
                  ? <div>加载中…</div>
                  : d && d.error
                    ? <div>{d.error}</div>
                    : <div>
                        <div className={css.descWrap}>{d.description || skill.description}</div>
                        {d.whenToUse ? <div className={css.descWrap}>When to use: {d.whenToUse}</div> : null}
                        <pre className={css.pre}>{d.content || ''}</pre>
                      </div>}
              </div>
            : null}
        </div>,
      )
    })
  })

  return (
    <div className={css.panel}>
      <div className={css.section}>
        <div className={css.h}>导入技能</div>
        <div className={css.inline}>
          <input className={css.inputGrow} placeholder="目录路径（含 SKILL.md 的技能目录或平铺 .md）" value={scan.dir} onChange={(e) => { setScan((prev) => ({ ...prev, dir: e.target.value })) }} />
          <button type="button" className={css.btn} onClick={chooseDir}>选择文件夹</button>
          <button type="button" className={css.btn} disabled={scan.busy} onClick={doScan}>{scan.busy ? '扫描中…' : '扫描目录'}</button>
        </div>
        {scan.error ? <div className={css.error}>{scan.error}</div> : null}
        <div className={css.inline}>
          <span className={css.desc}>导入方式：</span>
          <label className={css.switch}>
            <input type="radio" name="import-mode" checked={scan.mode === 'link'} onChange={() => { setScan((prev) => ({ ...prev, mode: 'link' })) }} />
            <span>软链接（不复制，删除只删链接）</span>
          </label>
          <label className={css.switch}>
            <input type="radio" name="import-mode" checked={scan.mode === 'copy'} onChange={() => { setScan((prev) => ({ ...prev, mode: 'copy' })) }} />
            <span>拷贝导入（实体副本）</span>
          </label>
        </div>
        {scan.items.length > 0
          ? <div className={css.scanList}>
              {scan.items.map((it) => (
                <label key={it.sourcePath} className={css.row}>
                  <input type="checkbox" checked={!!scan.selected[it.sourcePath]} onChange={() => { toggleSelect(it.sourcePath) }} />
                  <div className={css.main}>
                    <div className={css.name}>{it.name}{it.kind === 'bundle' ? ' (目录)' : ' (文件)'}</div>
                    {it.description ? <div className={css.desc}>{it.description}</div> : null}
                  </div>
                </label>
              ))}
              <button type="button" className={css.btn} disabled={scan.busy} onClick={doImport}>导入选中 ({Object.keys(scan.selected).length})</button>
            </div>
          : null}
        {scan.note ? <div className={css.note}>{scan.note}</div> : null}
      </div>
      <div className={css.section}>
        <div className={css.inline}>
          <div className={css.hGrow}>技能列表</div>
          <button type="button" className={css.btn} onClick={load}>刷新</button>
        </div>
        <div className={css.inline}>
          <input className={css.inputGrow} placeholder="搜索技能名称…" value={query} onChange={(e) => { setQuery(e.target.value) }} />
          <select className={css.filterSelect} value={policyFilter} onChange={(e) => { setPolicyFilter(e.target.value as 'all' | 'model-off' | 'user-off') }}>
            <option value="all">全部</option>
            <option value="model-off">模型不可用</option>
            <option value="user-off">用户不可用</option>
          </select>
        </div>
        {msg ? <div className={css.error}>{msg}</div> : null}
        {list.error ? <div className={css.error}>{list.error}</div> : null}
        {list.loading
          ? <div>加载中…</div>
          : (filtered.length === 0 ? <div>{list.items.length === 0 ? '没有发现技能' : '没有匹配的技能'}</div> : rows)}
      </div>
    </div>
  )
}

function McpPanel(props: { refreshKey: number; onChanged: () => void }) {
  const [list, setList] = useState<{ loading: boolean; servers: McpServerSummary[]; error: string }>({ loading: true, servers: [], error: '' })
  const [form, setForm] = useState<McpForm>(EMPTY_FORM)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = () => {
    setList({ loading: true, servers: [], error: '' })
    api.listMcp().then((servers) => {
      setList({ loading: false, servers, error: '' })
    }).catch((e) => {
      setList({ loading: false, servers: [], error: String((e as Error)?.message || e) })
    })
  }

  // Quiet refresh: no loading flash, keeps current state on failure. Used by
  // live polling and after async actions so status transitions surface. Also
  // stops a retry spinner once the retried server reaches a terminal state.
  const refresh = () => {
    api.listMcp().then((servers) => {
      setList((prev) => ({ ...prev, loading: false, servers, error: '' }))
      setBusy((b) => {
        if (typeof b !== 'string' || !b.startsWith('retry:')) return b
        const nm = b.slice('retry:'.length)
        const sv = servers.find((x) => x.name === nm)
        if (sv && (sv.status === 'running' || sv.status === 'failed')) return ''
        return b
      })
    }).catch(() => { /* keep showing last state */ })
  }

  const retry = (s: McpServerSummary) => {
    setMsg('')
    setBusy('retry:' + s.name)
    api.retryMcp(s.name).then(() => {
      notifyCapabilityChange()
      refresh()
      setTimeout(refresh, 1500)
      setTimeout(refresh, 4000)
    }).catch((e) => { setBusy(''); setMsg(String((e as Error)?.message || e)) })
  }

  useEffect(() => { load() }, [props.refreshKey])

  // Live status polling: surfaces async connecting→running/failed transitions.
  useEffect(() => {
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [])

  const patch = (p: Partial<McpForm>) => { setForm((prev) => ({ ...prev, ...p })) }

  const buildServer = (): McpServerConfig | null => {
    if (form.mode === 'json') {
      try { return JSON.parse(form.json) as McpServerConfig }
      catch (e) { setMsg('JSON 解析失败：' + String((e as Error)?.message || e)); return null }
    }
    const server: McpServerConfig = { name: form.name.trim(), transport: form.transport, enabled: true }
    if (form.transport === 'stdio') {
      server.command = form.command.trim()
      server.args = form.args.split(/\n/).map((l) => l.trim()).filter((l) => l !== '')
      server.cwd = form.cwd.trim()
      server.env = parseKv(form.env)
    } else {
      server.url = form.url.trim()
      server.headers = parseKv(form.headers)
    }
    return server
  }

  const save = (server: McpServerConfig | null) => {
    if (!server) return
    setBusy('save')
    setMsg('')
    api.saveMcp(server).then(() => {
      setBusy('')
      setMsg('已保存 ' + server.name)
      setForm(EMPTY_FORM)
      load()
      notifyCapabilityChange()
    }).catch((e) => { setBusy(''); setMsg(String((e as Error)?.message || e)) })
  }

  const toggle = (s: McpServerSummary) => {
    setMsg('')
    api.setMcpEnabled(s.name, !s.enabled).then(() => { load(); notifyCapabilityChange() }).catch((e) => { setMsg(String((e as Error)?.message || e)) })
  }

  const remove = (s: McpServerSummary) => {
    if (confirmDel !== s.name) { setConfirmDel(s.name); return }
    setConfirmDel(null)
    setMsg('')
    api.deleteMcp(s.name).then(() => { load(); notifyCapabilityChange() }).catch((e) => { setMsg(String((e as Error)?.message || e)) })
  }

  const edit = (s: McpServerSummary) => {
    setForm({
      name: s.name, transport: s.transport || 'stdio', command: s.command || '',
      args: (s.args || []).join('\n'), env: kvText(s.env), cwd: s.cwd || '',
      url: s.url || '', headers: kvText(s.headers), mode: 'form', json: JSON.stringify(s, null, 2),
    })
    setConfirmDel(null)
  }

  const test = (server: McpServerConfig | null) => {
    if (!server) return
    setBusy('test')
    setMsg('')
    api.testMcp(server).then((r) => {
      setBusy('')
      setMsg(r.ok ? '连接成功' : '连接失败：' + (r.error || 'unknown error'))
    }).catch((e) => { setBusy(''); setMsg(String((e as Error)?.message || e)) })
  }

  const statusLabel: Record<string, string> = {
    connecting: '连接中', running: '运行中', failed: '失败', stopped: '已停止',
  }

  const statusClass = (st: string): string => {
    if (st === 'running') return css.statusRunning
    if (st === 'stopped') return css.statusStopped
    if (st === 'failed') return css.statusFailed
    if (st === 'connecting') return css.statusConnecting
    return ''
  }

  const mq = query.trim().toLowerCase()
  const filteredServers = list.servers.filter((s) => mq === '' || s.name.toLowerCase().includes(mq))

  return (
    <div className={css.panel}>
      <div className={css.section}>
        <div className={css.inline}>
          <div className={css.hGrow}>MCP 服务器</div>
          <input className={css.inputGrow} placeholder="搜索服务器名称…" value={query} onChange={(e) => { setQuery(e.target.value) }} />
        </div>
        {msg ? <div className={css.error}>{msg}</div> : null}
        {list.error ? <div className={css.error}>{list.error}</div> : null}
        {list.loading
          ? <div>加载中…</div>
          : (filteredServers.length === 0
            ? <div>{list.servers.length === 0 ? '尚未配置任何 MCP 服务器' : '没有匹配的服务器'}</div>
            : filteredServers.map((s) => (
                <div key={s.name} className={css.row}>
                  <div className={css.main}>
                    <div className={css.nameLine}>
                      <span className={css.statusDot + ' ' + (s.enabled ? css.dotOn : css.dotOff)} title={s.enabled ? '已启用' : '已禁用'} />
                      <span className={css.name}>{s.name}</span>
                      <span className={css.status + ' ' + statusClass(s.status)}>{statusLabel[s.status] || s.status}</span>
                    </div>
                    <div className={css.desc}>{s.transport}{s.transport === 'stdio' ? ' · ' + (s.command || '') : ' · ' + (s.url || '')}</div>
                    {s.error ? <div className={css.error}>{s.error}</div> : null}
                  </div>
                  <label className={css.switch}>
                    <input type="checkbox" checked={s.enabled} onChange={() => { toggle(s) }} />
                    <span>{s.enabled ? '启用' : '禁用'}</span>
                  </label>
                  <button type="button" className={css.iconBtn + (busy === ('retry:' + s.name) ? ' ' + css.spin : '')} disabled={busy === ('retry:' + s.name)} title="重试" aria-label="重试" onClick={() => { retry(s) }}>↻</button>
                  <button type="button" className={css.btn} onClick={() => { edit(s) }}>编辑</button>
                  <button type="button" className={css.btn + ' ' + css.btnDanger} onClick={() => { remove(s) }}>{confirmDel === s.name ? '确认删除?' : '删除'}</button>
                </div>
              )))}
      </div>
      <div className={css.section}>
        <div className={css.h}>新建 / 编辑服务器</div>
        <div className={css.inline}>
          <button type="button" className={form.mode === 'form' ? css.btn + ' ' + css.btnActive : css.btn} onClick={() => { patch({ mode: 'form' }) }}>表单</button>
          <button type="button" className={form.mode === 'json' ? css.btn + ' ' + css.btnActive : css.btn} onClick={() => { patch({ mode: 'json' }) }}>JSON</button>
        </div>
        {form.mode === 'form'
          ? <div className={css.form}>
              <Field label="名称 name"><input className={css.input} value={form.name} placeholder="例如 github" onChange={(e) => { patch({ name: e.target.value }) }} /></Field>
              <Field label="传输 transport">
                <select className={css.input} value={form.transport} onChange={(e) => { patch({ transport: e.target.value as 'stdio' | 'streamable-http' }) }}>
                  <option value="stdio">stdio</option>
                  <option value="streamable-http">streamable-http</option>
                </select>
              </Field>
              {form.transport === 'stdio'
                ? <div>
                    <Field label="命令 command"><input className={css.input} value={form.command} placeholder="npx" onChange={(e) => { patch({ command: e.target.value }) }} /></Field>
                    <Field label="参数 args（每行一个）"><textarea className={css.input} rows={2} value={form.args} placeholder={'-y\n@modelcontextprotocol/server-github'} onChange={(e) => { patch({ args: e.target.value }) }} /></Field>
                    <Field label="环境变量 env（KEY=VALUE 每行一个）"><textarea className={css.input} rows={2} value={form.env} onChange={(e) => { patch({ env: e.target.value }) }} /></Field>
                    <Field label="工作目录 cwd"><input className={css.input} value={form.cwd} onChange={(e) => { patch({ cwd: e.target.value }) }} /></Field>
                  </div>
                : <div>
                    <Field label="URL"><input className={css.input} value={form.url} placeholder="http://localhost:3000/mcp" onChange={(e) => { patch({ url: e.target.value }) }} /></Field>
                    <Field label="请求头 headers（KEY=VALUE 每行一个）"><textarea className={css.input} rows={2} value={form.headers} onChange={(e) => { patch({ headers: e.target.value }) }} /></Field>
                  </div>}
              <div className={css.inline}>
                <button type="button" className={css.btnPrimary} disabled={busy === 'save'} onClick={() => { save(buildServer()) }}>{busy === 'save' ? '保存中…' : '保存'}</button>
                <button type="button" className={css.btn} disabled={busy === 'test'} onClick={() => { test(buildServer()) }}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
              </div>
            </div>
          : <div className={css.form}>
              <textarea className={css.inputMono} rows={12} value={form.json} placeholder={'{\n  "name": "github",\n  "transport": "stdio",\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "enabled": true\n}'} onChange={(e) => { patch({ json: e.target.value }) }} />
              <button type="button" className={css.btnPrimary} disabled={busy === 'save'} onClick={() => { save(buildServer()) }}>{busy === 'save' ? '保存中…' : '保存'}</button>
            </div>}
        <div className={css.desc}>配置持久化到 ~/.dsh/mcp.json；启用的服务器经 @deepseek-ai/dsh-mcp-client 真实连接并把工具注册为 mcp__&lt;server&gt;__&lt;tool&gt;。</div>
      </div>
    </div>
  )
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className={css.fieldLabel}>
      <span className={css.fieldName}>{props.label}</span>
      {props.children}
    </label>
  )
}
