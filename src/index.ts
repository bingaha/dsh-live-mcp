/**
 * dsh-skills-mcp-manager — host half. Mounts the skills filesystem engine,
 * the MCP connection manager (real @deepseek-ai/dsh-mcp-client instances per
 * enabled server), the /api/dsh-skills-mcp route family, and a system-prompt
 * announcement. The browser half (./client) renders the settings card.
 * Everything rides official NPM SDK packages — no dsh source changes.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { McpManager, readMcpConfig } from './mcp.ts'
import { makeRoutes } from './routes.ts'
import { readSelection } from './session-select.ts'
import { SkillsManager } from './skills.ts'
import { ConversationIsolation } from './isolation.ts'

/** Stable cordis plugin name. */
export const name = 'skills-mcp-manager'

/** Services required before the surfaces can mount. `settings` is
 * deliberately absent: installSettingsSection registers it on an inner scoped
 * fiber, so a deployment without the settings surface still gets routes + MCP. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

/**
 * Settings namespace this plugin's config lives under. Spelled here rather
 * than imported: the browser half spells the same value and must not depend
 * on a Host package.
 */
export const SKILLS_MCP_NAMESPACE = settingsNamespace('skills-mcp-manager')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch (routes, MCP connections, prompt section). */
  enabled?: boolean
  /** Announce the plugin to every agent's system prompt. */
  announceToAgent?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
})

const DEFAULT_ENABLED = true
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SKILLS_MCP_GUIDANCE = '本机已安装 dsh-skills-mcp-manager 插件（技能与 MCP 管理器）：设置页「Web UI 插件 → 技能与 MCP」。能力：浏览/启用/禁用/删除/导入技能（项目级 .dsh/skills、.agents/skills 与用户级 ~/.dsh/skills、~/.agents/skills）；管理 MCP 服务器（stdio 与 streamable-http）。MCP 是真实连接：启用的服务器经 @deepseek-ai/dsh-mcp-client 真正连接并把工具注册为 mcp__<server>__<tool>，启用/禁用会实际连接/断开。限制：MCP 服务器配置存 ~/.dsh/mcp.json（密码/env 明文、权限 0600 由用户自行保证）；技能启用/禁用走插件自有开关集合（存 ~/.dsh/skills-mcp-manager/state.json），不修改 SKILL.md 文件；删除为物理删除，不可恢复。用户提到「技能管理 / 技能导入 / MCP 服务器 / MCP 连接」时即指本插件，请据此协作。'

/**
 * Mount the skills engine, MCP manager, routes, and announcement.
 * @param ctx - host plugin context carrying settings/webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => ({
    enabled: current().enabled ?? DEFAULT_ENABLED,
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
  })

  const skills = new SkillsManager()
  const mcp = new McpManager(ctx)
  // Per-conversation MCP isolation engine. Runtime state is WeakMap-keyed by
  // the live Agent and its effects are scoped to agent.ctx, so it unwinds
  // automatically with the agent — there is no sessionId table to clean when a
  // conversation is archived or deleted. The durable blacklist lives in the
  // official session directory (session-select.ts) and dies with it.
  const isolation = new ConversationIsolation(ctx)
  const { routes } = makeRoutes({
    skills,
    mcp,
    resolveCwd: (sessionId) => ctx.agents.get(sessionId as never)?.session?.header.cwd,
    applyLive: (sessionId, selection) => {
      const agent = ctx.agents.get(sessionId as never)
      if (agent !== undefined) isolation.apply(agent, selection)
    },
  })

  let disposeSection: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let reloadTimer: NodeJS.Immediate | undefined

  const scheduleMcpReload = (): void => {
    if (reloadTimer !== undefined) clearImmediate(reloadTimer)
    reloadTimer = setImmediate(() => {
      reloadTimer = undefined
      void mcp.reload()
    })
  }

  // Register (or drop) every surface to match the current source.
  const sync = (): void => {
    const value = resolve()
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (!value.enabled) {
      void mcp.dispose()
      return
    }
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:skills-mcp-manager',
        order: SECTION_ORDER,
        text: SKILLS_MCP_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'skills-mcp-manager: routes',
    )
    // Connect only after this plugin's activation turn completes. Dynamic
    // child plugins mounted while this fiber is still pending see injected
    // services as inactive in Cordis.
    scheduleMcpReload()
  }

  installSettingsSection(ctx, SKILLS_MCP_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  // Teardown must be returned so Cordis waits for MCP transports to release
  // their tool namespaces before an injected replacement starts.
  ctx.effect(() => () => {
    if (reloadTimer !== undefined) {
      clearImmediate(reloadTimer)
      reloadTimer = undefined
    }
    return mcp.dispose()
  }, 'skills-mcp-manager: mcp')

  // Per-conversation MCP isolation: apply the conversation's persisted
  // selection on agent creation. The engine is reactive to asynchronous MCP
  // connection (it only denies *currently-registered* names and re-syncs on
  // every tools/change, so a late-registering server is never lost and a
  // still-connecting one never throws). Selection changes made later through
  // the status bar re-apply live via applyLive; the agent-scoped effects here
  // unwind automatically when the agent is disposed.
  ctx.on('agent/created', ({ agent }) => {
    try {
      const cwd = agent.session?.header.cwd
      if (!cwd) return
      const selection = readSelection(agent.id, cwd)
      // Blacklist model: only a non-empty block list needs enforcement; an
      // empty selection is "all globally-enabled available" (no isolator).
      if ((selection.mcp ?? []).length === 0) return
      isolation.apply(agent, selection)
    } catch (e) {
      ctx.logger?.warn?.('[skills-mcp-manager] agent/created isolation: ' + String((e as Error)?.message ?? e))
    }
  })

  sync()
}
