/**
 * Seat selection: where the plugin's surface goes.
 *
 * Three seats, in order of preference, each a downgrade and never a duplicate:
 *
 *   1. the right sidebar's own tab service (`dsh-better-sidebar`), when the
 *      profile installs it;
 *   2. the official right Sidebar's tab strip (`ctx.sidebarRightTabs`) — the same
 *      place, from the framework itself, with no third-party dependency (see
 *      right-tab.tsx);
 *   3. the official central panel plus a sidebar icon.
 *
 * Seats 1 and 2 are alternatives rather than a pair: a profile running
 * `dsh-better-sidebar` fails to start the official right Sidebar, because the
 * former takes the `rightbar` slot.
 *
 * **That slot is off limits.** Two attempts to take it crashed the whole GUI:
 * `rightbar` is a single slot owned by the official right Sidebar, so taking it
 * fails that plugin, which starves the eleven official plugins waiting on its
 * `sidebarRight` service and fails the web boot. The crash logs read exactly that
 * way. `sidebar.right.pane.tab` — a keyed slot — is the supported way to add a
 * tab, and it is what seat 2 uses.
 *
 * Seats move in both directions. Enabling `dsh-better-sidebar` takes seat 1 and
 * retires seat 2; disabling it disposes the `betterSidebar` service, and the
 * seat-1 registrations die with their host. Without the reverse move the button
 * simply vanishes until the whole plugin is restarted — the observed field bug.
 * The `ctx.inject` body below returns a cleanup for exactly that transition: an
 * inject fiber unloads when a required service disappears and reloads when it
 * comes back, so the cleanup puts seat 2 back up and the body takes seat 1 again.
 *
 * @module @kissfire/dsh-skill-map/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from './api.ts'
import { registerRightTab } from './right-tab.tsx'
import { readFace, registerTabOn } from './side-tab.tsx'

/**
 * Mount the map on whichever seat this profile offers.
 * @param ctx - client root context.
 * @param api - the skill map API client the panel operates through.
 * @returns disposer releasing every registration this call made.
 */
export function registerSurface(ctx: ClientContext, api: SkillMapApi): () => void {
  let stopped = false
  let disposeTab: (() => void) | undefined
  let disposePanel: (() => void) | undefined

  /** Put the official seat (or its central-panel fallback) back up. */
  const mountFallback = (): void => {
    if (stopped || disposePanel !== undefined) return
    disposePanel = registerRightTab(ctx, api)
  }

  /** Release the seat-1 registration, if any. */
  const retireTab = (): void => {
    const dispose = disposeTab
    disposeTab = undefined
    if (dispose === undefined) return
    try {
      dispose()
    } catch (error) {
      // The sidebar already dropped its own registry on the way out.
      console.warn('[skill-map] releasing the right-sidebar tab failed:', error)
    }
  }

  const handle = ctx.inject(['betterSidebar'], (inner) => {
    const service = readFace(inner)
    if (service === undefined) return
    // The right sidebar is (or has become) available: give the fallback seat up
    // rather than leaving two ways into the same panel.
    disposePanel?.()
    disposePanel = undefined
    try {
      disposeTab = registerTabOn(service, api)
    } catch (error) {
      // The sidebar refused the tab (say, its own table already holds this id).
      // A rejected registration must not leave the plugin with no seat at all.
      console.warn('[skill-map] right-sidebar tab registration failed; keeping the fallback seat:', error)
      mountFallback()
      return
    }
    return () => {
      // The service is going away (the sidebar plugin was disabled or reloaded).
      // Its tab strip — and our entry in it — goes with the host, so restore the
      // official seat instead of waiting for this plugin to be restarted.
      retireTab()
      mountFallback()
    }
  })

  // No sidebar service in sight yet — put the official seat up so the plugin is
  // reachable at all. If the sidebar turns up later, the callback above retires
  // it; if it was there all along, cordis runs that callback immediately and this
  // branch never fires.
  if (readFace(ctx) === undefined) {
    mountFallback()
  }

  return () => {
    stopped = true
    retireTab()
    disposePanel?.()
    disposePanel = undefined
    void (handle as { dispose?: () => void } | undefined)?.dispose?.()
  }
}
