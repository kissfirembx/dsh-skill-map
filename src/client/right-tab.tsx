/**
 * The official right Sidebar's tab seat — the map beside the conversation,
 * without needing `dsh-better-sidebar` installed.
 *
 * The official right Sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`) opens
 * its tab system to outside plugins through a documented two-stage path:
 *
 *   1. `ctx.sidebarRightTabs.register({ id, kind, title, guide })` declares a tab
 *      type. An outside plugin is the `extension` band by default, which may even
 *      take over a `builtin` kind, so declaring one's own `kind` never conflicts.
 *   2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)`
 *      supplies that type's body, keyed by the definition's `id`.
 *
 * Why this is safe where `rightbar` was not: `sidebar.right.pane.tab` is a
 * **keyed** slot, so each plugin owns its own key and nothing is displaced.
 * `rightbar` is a **single** slot owned by the official right Sidebar itself;
 * taking it fails that plugin, which starves the eleven official plugins waiting
 * on its `sidebarRight` service and fails the whole web boot. Both crash logs read
 * exactly that way — see surface.ts.
 *
 * The central panel still goes up first and is retired only once this seat is
 * actually taken. Not a formality: `sidebarRightTabs` is absent in a profile
 * where the official right Sidebar is not running (a `dsh-better-sidebar` profile,
 * for one), and an inject on a service that never arrives never fires — a fallback
 * placed inside that callback would simply never happen.
 *
 * @module @kissfire/dsh-skill-map/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from './api.ts'
import { SkillMapPanel } from './SkillMapPanel.tsx'
import { registerMainPanel } from './main-panel.tsx'
import { tt } from './panel-helpers.ts'

/** The implementation's identity in the tab system; also the slot key of its body. */
const TAB_ID = '@kissfire/dsh-skill-map'

/**
 * The type discriminator tabs of this plugin are opened by. Deliberately not the
 * bare `skill-map`: `dsh-better-sidebar` registers its own native tab into the
 * official registry with a kind derived from the cordis plugin name (`skill-map`,
 * from `export const name = 'skill-map'` in src/index.ts). Two extensions on one
 * kind collide, and the observed error was exactly that:
 *
 *     [dsh-better-sidebar] native register skill-map error:
 *     sidebarRight: tab kind "skill-map" is already registered (extension)
 *
 * The kind is an internal discriminator — users see `title`, never this — so it
 * costs nothing to keep it out of everyone else's way.
 */
const TAB_KIND = 'kissfire-skill-map'

/** Row order on the right Sidebar's guide page. */
const GUIDE_ORDER = 60

/** Structural face of the official tab-type registry (`ctx.sidebarRightTabs`). */
interface TabRegistryFace {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: ReadonlyArray<{ id: string; order: number; title: () => string; description?: () => string }>
  }): () => void
}

/** Structural face of the official right-Sidebar controller (`ctx.sidebarRight`). */
interface SidebarRightFace {
  openTab(kind: string, options?: Record<string, unknown>): void
}

/** Structural face of the framework slot registry. */
interface SlotFace {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(slot: string, callback: () => unknown): () => void
}

function readTabRegistry(ctx: unknown): TabRegistryFace | undefined {
  const registry = (ctx as { sidebarRightTabs?: unknown } | undefined)?.sidebarRightTabs
  if (registry === undefined || typeof registry !== 'object') return undefined
  const face = registry as TabRegistryFace
  return typeof face.register === 'function' ? face : undefined
}

function readSidebarRight(ctx: unknown): SidebarRightFace | undefined {
  const sidebar = (ctx as { sidebarRight?: unknown } | undefined)?.sidebarRight
  if (sidebar === undefined || typeof sidebar !== 'object') return undefined
  const face = sidebar as SidebarRightFace
  return typeof face.openTab === 'function' ? face : undefined
}

function readSlots(ctx: unknown): SlotFace | undefined {
  const slots = (ctx as { slots?: unknown } | undefined)?.slots
  if (slots === undefined || typeof slots !== 'object') return undefined
  const face = slots as SlotFace
  if (typeof face.register !== 'function' || typeof face.inject !== 'function') return undefined
  return face
}

/**
 * Put the map in the official right Sidebar's tab strip, falling back to the
 * central panel when that sidebar is unavailable.
 * @param ctx - client root context (slots, sidebarRight, sidebarRightTabs).
 * @param api - the skill map API client the panel operates through.
 * @returns disposer releasing the tab type, its body and any fallback seat.
 */
export function registerRightTab(ctx: ClientContext, api: SkillMapApi): () => void {
  let stopped = false
  let disposeMain: (() => void) | undefined

  /** Put the central-panel seat back up (the last resort, never duplicated). */
  const mountMain = (): void => {
    if (stopped || disposeMain !== undefined) return
    disposeMain = registerMainPanel(ctx, api)
  }

  // Seat of last resort, first: a profile without the official right Sidebar must
  // still leave the plugin reachable.
  mountMain()

  const handle = ctx.inject(['slots', 'sidebarRightTabs'], (inner) => {
    const tabs = readTabRegistry(inner)
    const slots = readSlots(inner)
    if (tabs === undefined || slots === undefined) {
      // The official right Sidebar is not running here; the central panel stands.
      return
    }

    // Stage one: declare the tab type. The id and kind are ours alone, which is
    // what keeps this from ever colliding with a shipped type.
    const disposers: Array<() => void> = []
    try {
      disposers.push(tabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => tt('entry.label'),
        guide: [{
          id: TAB_KIND,
          order: GUIDE_ORDER,
          title: () => tt('entry.label'),
          description: () => tt('entry.description'),
        }],
      }))
    } catch (error) {
      console.warn('[skill-map] right-sidebar tab type registration failed; keeping the central panel:', error)
      return
    }

    // Stage two: the body, keyed by the definition id. The central panel is
    // retired here rather than after stage one: a declared type whose body never
    // arrived is a tab that cannot open, and retiring the fallback then would
    // leave the plugin with no seat at all.
    try {
      disposers.push(slots.inject('sidebar.right.pane.tab', () => {
        const dispose = slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_ID },
          (): React.ReactElement => <SkillMapPanel api={api} />,
        )
        disposeMain?.()
        disposeMain = undefined
        // Bring the map up once, so it lands where a sidebar tab would rather than
        // waiting behind the guide page for someone to find it.
        try {
          readSidebarRight(inner)?.openTab(TAB_KIND)
        } catch (error) {
          console.warn('[skill-map] opening the map tab failed:', error)
        }
        return dispose
      }))
    } catch (error) {
      console.warn('[skill-map] right-sidebar tab body registration failed:', error)
    }

    return () => {
      for (const dispose of disposers.splice(0)) dispose()
      // The official right Sidebar went away (disabled or reloaded): its tab
      // registry and our type died with it, so the central panel takes over
      // again instead of leaving the plugin with no seat until a restart.
      mountMain()
    }
  })

  return () => {
    stopped = true
    disposeMain?.()
    disposeMain = undefined
    void (handle as { dispose?: () => void } | undefined)?.dispose?.()
  }
}
