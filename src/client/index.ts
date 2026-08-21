/**
 * Browser-half entry for the dsh-live-mcp plugin — runs inside the
 * dsh web GUI. Registers the locale dictionary and contributes a first-class
 * settings PAGE (a settings.section entry, a sibling of the Plugins page),
 * not a card inside any group. The page hosts the skills/MCP management UI,
 * which talks to the Host over /api/dsh-skills-mcp.
 *
 * Deliberately does NOT bind the settingsScope: third-party settings
 * namespaces are not exposed to the browser configuration surface, so a
 * settings-scope-backed section would render an empty shell. The manager is
 * shown directly instead.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin must
 * not take the GUI down.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the slots merge tables (SlotMap / LocaleNamespaceMap).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the official settings.section slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the conversation SlotMap (conversation.input.dock, etc.).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type SkillsMcpKey } from './locales.ts'
import { SkillsMcpSection } from './SettingsCard.tsx'
import { ConversationDock } from './ConversationDock.tsx'

/** Locale namespace this plugin owns. */
const NS = 'skills-mcp-manager'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-live-mcp surface copy. */
    'skills-mcp-manager': SkillsMcpKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Mount the settings page.
 * @param ctx - client root context (slots, workspaces, locale).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skills-mcp-manager: dictionaries')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills-mcp',
    order: 20,
    label: () => ctx.locale.bind(NS)('title'),
    locale: NS,
    inject: () => ({ pickDirectory: () => ctx.workspaces.pickDirectory() }),
  }, SkillsMcpSection))

  // Conversation status bar: the full-width row above the composer card. The
  // dock slot passes the session snapshot + input state; the component reads
  // its `blank` flag to decide whether its selection is still editable.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'skills-mcp-dock',
    order: 50,
  }, ConversationDock))
}
