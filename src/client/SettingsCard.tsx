/**
 * The skills-mcp-manager settings section: a first-class settings page (a
 * `settings.section` entry, a sibling of the Plugins page) that renders the
 * skills/MCP management UI directly. The plugin does NOT read its own settings
 * namespace (third-party namespaces are not exposed to the browser settings
 * surface), so there is no master-switch here; the manager is always shown.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { SkillsMcpManager } from './manager.tsx'
import css from './settings-card.module.css'

/** Props the renderer binds for the section. */
export type SkillsMcpSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skills-mcp-manager'>
  & InjectFace<{ pickDirectory: () => Promise<string | null> }>

/**
 * Render the settings section content.
 * @param props - locale copy, the shell's close action, and the picker helper.
 * @returns the section page.
 */
export function SkillsMcpSection(props: SkillsMcpSectionProps) {
  const { t } = props

  // Preserve the runtime's registry order; settings defaults apply per workspace.
  const workspaces = props.useWorkspaces((snapshot: WorkspaceListState) => snapshot)

  return (
    <div className={css.sectionPage}>
      <h2 className={css.pageHeading}>{t('title')}</h2>
      <p className={css.pageIntro}>{t('description')}</p>
      <SkillsMcpManager workspaces={workspaces} enabled={true} pickDirectory={props.pickDirectory} />
    </div>
  )
}
