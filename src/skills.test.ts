import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConversation } from './routes.ts'
import { SkillsManager } from './skills.ts'
import type { McpConnectionStatus, McpServerConfig, McpServerSummary } from './protocol.ts'

function writeSkill(root: string, name: string, extraFrontmatter: string): string {
  const dir = path.join(root, '.dsh', 'skills', name)
  fs.mkdirSync(dir, { recursive: true })
  const extra = extraFrontmatter.trim()
  const file = path.join(dir, 'SKILL.md')
  fs.writeFileSync(file, [
    '---',
    `name: ${name}`,
    `description: ${name} description`,
    extra,
    '---',
    '',
    `${name} body`,
    '',
  ].filter((line) => line !== '').join('\n') + '\n', 'utf8')
  return file
}

describe('skill invocation policy', () => {
  let home: string
  let project: string
  let prevHome: string | undefined
  let prevAgents: string | undefined
  const skills = new SkillsManager()

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skills-mcp-home-'))
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skills-mcp-proj-'))
    fs.mkdirSync(path.join(project, '.git'))
    prevHome = process.env.DSH_HOME
    prevAgents = process.env.DSH_AGENTS_HOME
    process.env.DSH_HOME = home
    process.env.DSH_AGENTS_HOME = path.join(home, 'agents')
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = prevAgents
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  })

  it('defaults omitted invocation fields to both true', () => {
    writeSkill(project, 'plain', '')
    const listed = skills.listSkills(project)
    const item = listed.find((s) => s.name === 'plain')
    expect(item).toMatchObject({ modelInvocable: true, userInvocable: true })
    const detail = skills.readSkill(item!.path)
    expect(detail).toMatchObject({ modelInvocable: true, userInvocable: true, name: 'plain' })
  })

  it('treats disable-model-invocation: true as model-off only and keeps the skill listed', () => {
    writeSkill(project, 'user-only', 'disable-model-invocation: true')
    const item = skills.listSkills(project).find((s) => s.name === 'user-only')
    expect(item).toMatchObject({ modelInvocable: false, userInvocable: true })
    expect(skills.readSkill(item!.path)).toMatchObject({ modelInvocable: false, userInvocable: true })
  })

  it('treats user-invocable: false as user-off only', () => {
    writeSkill(project, 'model-only', 'user-invocable: false')
    const item = skills.listSkills(project).find((s) => s.name === 'model-only')
    expect(item).toMatchObject({ modelInvocable: true, userInvocable: false })
  })

  it('keeps both-axes-off skills in the list', () => {
    writeSkill(project, 'closed', 'disable-model-invocation: true\nuser-invocable: false')
    const item = skills.listSkills(project).find((s) => s.name === 'closed')
    expect(item).toMatchObject({ modelInvocable: false, userInvocable: false })
  })

  it('resolveConversation lists every skill with flags and does not filter by switches', () => {
    writeSkill(project, 'plain', '')
    writeSkill(project, 'user-only', 'disable-model-invocation: true')
    writeSkill(project, 'model-only', 'user-invocable: false')
    writeSkill(project, 'closed', 'disable-model-invocation: true\nuser-invocable: false')

    const mcp = {
      summarize(servers: McpServerConfig[]): McpServerSummary[] {
        return servers.map((s) => ({
          ...s,
          enabled: s.enabled !== false,
          status: 'running' as McpConnectionStatus,
        }))
      },
    }

    const view = resolveConversation(skills, mcp, { mcp: ['gone'] }, project)
    const byName = Object.fromEntries(view.available.skills.map((s) => [s.name, s]))
    expect(byName.plain).toEqual({ name: 'plain', modelInvocable: true, userInvocable: true })
    expect(byName['user-only']).toEqual({ name: 'user-only', modelInvocable: false, userInvocable: true })
    expect(byName['model-only']).toEqual({ name: 'model-only', modelInvocable: true, userInvocable: false })
    expect(byName.closed).toEqual({ name: 'closed', modelInvocable: false, userInvocable: false })
    expect(view.available.mcp).toEqual([])
    expect(view.selection).toEqual({ mcp: ['gone'] })
  })
})
