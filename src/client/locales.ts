/**
 * Client locale dictionaries for the dsh-live-mcp settings card.
 * The card chrome is bilingual; the deeper management UI keeps the original
 * Chinese copy inline (see manager.tsx).
 */

/** Locale keys this plugin's card chrome uses. */
export type SkillsMcpKey =
  | 'title'
  | 'description'
  | 'expand'
  | 'collapse'
  | 'notExposed'
  | 'readOnly'
  | 'unsaved'
  | 'discard'
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'inherit'
  | 'overridden'
  | 'reset'
  | 'invalid'
  | 'enabled'
  | 'enabledHint'
  | 'announce'
  | 'announceHint'
  | 'on'
  | 'off'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<SkillsMcpKey, string> = {
  title: '技能与 MCP',
  description: '管理技能与 MCP 服务器（MCP 为真实连接）。',
  expand: '展开',
  collapse: '收起',
  notExposed: '当前部署未向此客户端提供该插件的设置命名空间。',
  readOnly: '设置文档为只读，无法保存更改。',
  unsaved: '未保存',
  discard: '放弃更改',
  save: '保存',
  saving: '保存中…',
  saveFailed: '保存未成功，请重试。',
  inherit: '继承',
  overridden: '已覆盖',
  reset: '重置',
  invalid: '输入无效',
  enabled: '启用插件',
  enabledHint: '关闭后，路由与 MCP 连接会全部停止。',
  announce: '向 Agent 公告',
  announceHint: '在系统提示中向每个 Agent 说明本插件的存在与能力。',
  on: '开',
  off: '关',
}

/** English dictionary, checked complete against the zh key set. */
export const en: Record<SkillsMcpKey, string> = {
  title: 'Skills & MCP',
  description: 'Manage skills and MCP servers (MCP connects for real).',
  expand: 'Show',
  collapse: 'Hide',
  notExposed: 'This deployment does not expose the plugin settings namespace to this client.',
  readOnly: 'The settings document is read-only; changes cannot be saved.',
  unsaved: 'Unsaved',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The save did not land; please retry.',
  inherit: 'Inherit',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Invalid',
  enabled: 'Enable plugin',
  enabledHint: 'When off, routes and MCP connections all stop.',
  announce: 'Announce to agent',
  announceHint: 'Describe this plugin and its capabilities in every agent system prompt.',
  on: 'On',
  off: 'Off',
}
