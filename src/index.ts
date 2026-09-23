/**
 * dsh-live-mcp — host half. Mounts the skills filesystem engine,
 * the MCP connection manager (real @deepseek-ai/dsh-mcp-client instances per
 * enabled server), the /api/dsh-skills-mcp route family, and a system-prompt
 * announcement. The browser half (./client) renders the settings card.
 * Everything rides official NPM SDK packages — no dsh source changes.
 * @module
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: declares the Loader's `loader/volatile-update` merge event, the
// live-config update path this plugin subscribes to.
import type {} from '@deepseek-ai/cordis-plugin-loader'
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

/** Services required before the surfaces can mount. Configuration now rides the
 * Cordis Config seam (a profile-backed settings form), so the `settings`
 * service is no longer injected here. */
export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

/** Plugin config, validated by the same-named schemastery schema. Both fields
 * are `.volatile()`: the profile-backed settings form edits them live without
 * remounting this plugin, and the Loader merges each new value into `config`. */
export interface Config {
  /** Master switch (routes, MCP connections, prompt section). */
  enabled: Volatile<boolean>
  /** Announce the plugin to every agent's system prompt. */
  announceToAgent: Volatile<boolean>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  announceToAgent: z.boolean().default(true).volatile(),
})

const DEFAULT_ENABLED = true
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SKILLS_MCP_GUIDANCE = '本机已安装 dsh-live-mcp 插件（技能与 MCP 管理器）：设置页「Web UI 插件 → 技能与 MCP」。能力：浏览/删除/导入技能（项目级 .dsh/skills、.agents/skills 与用户级 ~/.dsh/skills、~/.agents/skills）；管理 MCP 服务器（stdio 与 streamable-http）。MCP 是真实连接：启用的服务器经 @deepseek-ai/dsh-mcp-client 真正连接并把工具注册为 mcp__<server>__<tool>，启用/禁用会实际连接/断开。限制：MCP 服务器配置存 ~/.dsh/mcp.json（密码/env 明文、权限 0600 由用户自行保证）；本轮不提供技能启用/禁用开关，调用策略以 SKILL.md 的 disable-model-invocation / user-invocable 为准，插件不改该文件；删除为物理删除，不可恢复。用户提到「技能管理 / 技能导入 / MCP 服务器 / MCP 连接」时即指本插件，请据此协作。'

/**
 * Mount the skills engine, MCP manager, routes, and announcement.
 * @param ctx - host plugin context carrying settings/webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  // `config` fields are Volatile references: sample them at call time so a live
  // settings edit is picked up by the next `sync()`.
  const resolve = (): { enabled: boolean; announceToAgent: boolean } => ({
    enabled: config?.enabled?.get() ?? DEFAULT_ENABLED,
    announceToAgent: config?.announceToAgent?.get() ?? DEFAULT_ANNOUNCE,
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

  // Live config edits from the profile-backed settings form arrive as a Loader
  // volatile merge (no remount); re-derive every surface to match the new
  // values. `ctx.on` is fiber-scoped, so the subscription unwinds with the
  // plugin.
  ctx.on('loader/volatile-update', () => { sync() })

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
