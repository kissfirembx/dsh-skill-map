/**
 * The plugin's fallback seat: the official main panel.
 *
 * The preferred home is a right-sidebar tab, and that seat only exists when the
 * profile installs `dsh-better-sidebar`. Without it the plugin used to contribute
 * no surface at all — which for a UI plugin is the same as not being installed.
 * This module is the substitute: a central panel registered in the layout's keyed
 * `main` slot, plus the icon the sidebar's own panel list renders for it.
 *
 * Both registrations go through the framework's slot service (`ctx.slots`), so
 * the fallback needs no third-party package and no copied code.
 *
 * Two waits are required and both are load-order facts, not paranoia:
 *
 *   1. `ctx.inject(['slots'])` — the registry arrives with the renderer, which
 *      may boot after this plugin's apply.
 *   2. `slots.inject(slot, …)` — registering into a slot nobody has declared yet
 *      throws, and `main` / `sidebar.panellist` are declared by the layout and
 *      sidebar plugins, which may also still be booting.
 *
 * Skipping either wait leaves the plugin with no surface at all, which is exactly
 * how the first version of this file failed in the field.
 *
 * @module @kissfire/dsh-skill-map/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from './api.ts'
import { SkillMapPanel } from './SkillMapPanel.tsx'
import { SKILL_MAP_TAB_ID, TAB_ORDER, skillMapTabIcon } from './side-tab.tsx'
import { tt } from './panel-helpers.ts'

/**
 * Structural face of the framework slot registry (`ctx.slots`, declared by
 * `@deepseek-ai/dsh-client-ui-renderer`). Spelled structurally for the same
 * reason the sidebar face is: this package must not need the registry's full
 * generic surface to contribute one panel.
 */
interface SlotFace {
  register(options: Record<string, unknown>, component: unknown): () => void
  /** Run the callback once that slot has an owner that declared it. */
  inject(slot: string, callback: () => unknown): () => void
}

/** Key the panel claims in the layout's keyed `main` slot. */
export const MAIN_PANEL_ID = SKILL_MAP_TAB_ID

/** The central panel, taking the API client through the slot's inject face. */
function MainPanelPage({ api }: { api: SkillMapApi }): React.ReactElement {
  return <SkillMapPanel api={api} />
}

/** Read the slot registry off a context, when the renderer is up. */
function readSlots(ctx: unknown): SlotFace | undefined {
  const slots = (ctx as { slots?: unknown } | undefined)?.slots
  if (slots === undefined || typeof slots !== 'object') return undefined
  const face = slots as SlotFace
  if (typeof face.register !== 'function' || typeof face.inject !== 'function') return undefined
  return face
}

/**
 * Contribute the map as a central panel plus its sidebar icon.
 * @param ctx - client root context carrying the slot registry.
 * @param api - the skill map API client the panel operates through.
 * @returns disposer releasing both registrations and the pending injects.
 */
export function registerMainPanel(ctx: ClientContext, api: SkillMapApi): () => void {
  const handle = ctx.inject(['slots'], (inner) => {
    const slots = readSlots(inner)
    if (slots === undefined) {
      console.warn('[skill-map] the slot registry is unavailable; the panel has no seat')
      return
    }
    // Registrations belong to this fiber: cordis runs the returned cleanup when
    // the inject handle is disposed, so exactly one place releases them.
    const disposers: Array<() => void> = []
    try {
      // The sidebar resolves the row label per read, so a language switch needs
      // no re-registration.
      disposers.push(slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: MAIN_PANEL_ID,
        order: TAB_ORDER,
        label: () => tt('entry.label'),
      }, skillMapTabIcon)))
    } catch (error) {
      console.warn('[skill-map] panel icon registration failed:', error)
    }
    try {
      disposers.push(slots.inject('main', () => slots.register({
        name: 'main',
        key: MAIN_PANEL_ID,
        inject: () => ({ api }),
      }, MainPanelPage)))
    } catch (error) {
      console.warn('[skill-map] main panel registration failed:', error)
    }
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  })

  return () => {
    void (handle as { dispose?: () => void } | undefined)?.dispose?.()
  }
}
