/**
 * Right-sidebar tab registration for the skill map.
 *
 * The map is a page inside the right sidebar, not a left-hand panel row and not
 * a center-column takeover: it registers one tab through the public
 * `ctx.betterSidebar` service that the right sidebar exposes to other plugins
 * (its own built-in tabs register through the same call). The sidebar shell
 * then owns the tab strip entry, the pane chrome, the resize behaviour and the
 * per-session scope.
 *
 * The service is reached through a scoped `ctx.inject`, so a profile without
 * the right sidebar simply never runs this and the plugin stays absent instead
 * of failing boot.
 *
 * @module @kissfire/dsh-skill-map/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from './api.ts'
import { SkillMapPanel } from './SkillMapPanel.tsx'
import { tt } from './panel-helpers.ts'

/** Tab id: the sidebar uses it as the pane's identity within a session. */
export const SKILL_MAP_TAB_ID = 'skill-map'

/** Row order among the right sidebar's tabs. */
const TAB_ORDER = 50

/** The tab descriptor the right sidebar accepts. */
export interface BetterSidebarTabDescriptor {
  id: string
  title: () => string
  description?: () => string
  icon?: (size: number) => unknown
  order?: number
  single?: boolean
  component: () => unknown
}

/** Structural face of the right sidebar's public service (no package dependency). */
export interface BetterSidebarFace {
  registerTab(descriptor: BetterSidebarTabDescriptor): () => void
}

/**
 * The tab glyph. The sidebar asks for it at its own size, but an older or newer
 * sidebar may pass a props object, so both shapes are accepted.
 * @param sizeOrProps - square edge, or a props bag carrying `size`.
 * @returns the decorative skill-map glyph.
 */
export function skillMapTabIcon(sizeOrProps: number | { size?: number }): React.ReactElement {
  const size = typeof sizeOrProps === 'number' ? sizeOrProps : sizeOrProps?.size ?? 16
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 2.5v11" />
      <path d="M3 5h4.5M3 8h6.5M3 11h4.5" />
      <circle cx="10.5" cy="5" r="1.4" />
      <circle cx="12.5" cy="8" r="1.4" />
      <circle cx="10.5" cy="11" r="1.4" />
    </svg>
  )
}

/** Read the right sidebar service from a context, if it exposes one. */
function readFace(ctx: unknown): BetterSidebarFace | undefined {
  const get = (ctx as { get?: (name: string) => unknown } | undefined)?.get
  if (typeof get !== 'function') return undefined
  const service = get.call(ctx, 'betterSidebar') as BetterSidebarFace | undefined
  if (service === undefined || typeof service.registerTab !== 'function') return undefined
  return service
}

/**
 * Register the skill map tab with the right sidebar.
 * @param ctx - client root context (services: betterSidebar, optional).
 * @param api - the skill map API client the page operates through.
 * @returns disposer releasing the registration (and the pending inject).
 */
export function registerSkillMapTab(ctx: ClientContext, api: SkillMapApi): () => void {
  let tabDisposer: (() => void) | undefined
  const handle = ctx.inject(['betterSidebar'], (inner) => {
    const service = readFace(inner)
    if (service === undefined) return
    tabDisposer = service.registerTab({
      id: SKILL_MAP_TAB_ID,
      title: () => tt('entry.label'),
      description: () => tt('entry.description'),
      icon: skillMapTabIcon,
      order: TAB_ORDER,
      single: true,
      component: (): React.ReactElement => <SkillMapPanel api={api} />,
    })
    return () => {
      tabDisposer?.()
      tabDisposer = undefined
    }
  })
  return () => {
    tabDisposer?.()
    tabDisposer = undefined
    void (handle as { dispose?: () => void } | undefined)?.dispose?.()
  }
}
