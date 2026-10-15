/**
 * Browser-half entry for the skill-map plugin — runs inside the DSH Web GUI.
 *
 * Registers the skill-map locale dictionaries and one right-sidebar tab through
 * the right sidebar's public service. Failure policy: registration problems are
 * logged, never thrown — the Web shell fails the whole boot when a plugin apply
 * throws, and an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SkillMapApi } from './api.ts'
import { setRuntimeTranslate } from './panel-helpers.ts'
import { en, zh, type SkillMapKey } from './locales.ts'
import { registerSkillMapTab } from './side-tab.tsx'
import { reportDailyHeartbeat } from './telemetry.ts'

/**
 * Locale namespace this plugin owns. This is an i18n identifier, not the npm
 * package name: it stays short and free of scope characters.
 */
const NS = 'dsh-skill-map'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** skill-map surface copy. */
    'dsh-skill-map': SkillMapKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { SkillMapPanelProps } from './SkillMapPanel.tsx'
export type { SkillMapKey } from './locales.ts'
export type { SkillMapApi } from './api.ts'

/**
 * Mount the skill map surfaces.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: 'dsh-skill-map' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'skill-map: dictionaries')

  // Wire the SDK translate seat into the module-level tt (the tab label the
  // sidebar resolves on every locale change): reads the active locale at call
  // time, so it follows the Language setting without a reload.
  try { setRuntimeTranslate(ctx.locale.bind(NS)) } catch { /* locale missing: document-language fallback stays */ }

  const api = new SkillMapApi()
  const disposers: Array<() => void> = []
  try {
    disposers.push(registerSkillMapTab(ctx, api))
  } catch (error) {
    // Registration failures degrade the panel, never the GUI.
    console.warn('[skill-map] tab registration failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'skill-map: ui mounts')
}
