import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from '../src/client/api.ts'
import { registerSurface } from '../src/client/surface.ts'
import type { BetterSidebarFace, BetterSidebarTabDescriptor } from '../src/client/side-tab.tsx'

/**
 * Seat selection, in order of preference and never duplicated:
 *
 *   1. the right sidebar's own tab service (`dsh-better-sidebar`);
 *   2. the official right Sidebar's tab strip (`sidebarRightTabs`);
 *   3. the official central panel plus a sidebar icon.
 *
 * Seat 2 replaced the two `rightbar` attempts, so what matters here is that it
 * goes through the *keyed* slot `sidebar.right.pane.tab` — the one where an
 * outside plugin owns its own key and nothing else is displaced.
 *
 * The seats also move back down: disabling `dsh-better-sidebar` disposes its
 * service, and cordis unloads the `ctx.inject` fiber with it. These specs pin
 * that the cleanup puts the official seat back up, so the entry does not have to
 * wait for a full plugin restart (the reported field symptom).
 */

interface SlotCall {
  options: Record<string, unknown>
  releases: number
}

interface Injectable {
  running: boolean
  cleanup: (() => void) | undefined
  run: () => void
  stop: () => void
}

function fakeCtx(options: {
  sidebar?: BetterSidebarFace
  officialRightSidebar?: boolean
} = {}): {
  ctx: ClientContext
  tabs: BetterSidebarTabDescriptor[]
  releases: number[]
  slots: SlotCall[]
  definitions: Array<Record<string, unknown>>
  opened: string[]
  provide(service: BetterSidebarFace): void
  withdraw(): void
  dropOfficialRightSidebar(): void
  fire(): void
} {
  const tabs: BetterSidebarTabDescriptor[] = []
  const releases: number[] = []
  const slots: SlotCall[] = []
  const definitions: Array<Record<string, unknown>> = []
  const opened: string[] = []
  const pending: Array<() => void> = []
  /** The inject fibers that wait on `betterSidebar`; cordis unloads them on withdrawal. */
  const sidebarFibers: Injectable[] = []
  /** The inject fibers that wait on the official right Sidebar service. */
  const rightFibers: Injectable[] = []
  let service = options.sidebar
  let official = options.officialRightSidebar === true

  const slotFace = {
    register(callOptions: Record<string, unknown>) {
      const call: SlotCall = { options: callOptions, releases: 0 }
      slots.push(call)
      return () => {
        call.releases += 1
      }
    },
    // The framework runs the callback once the slot has a declared owner; the
    // fake has no boot order, so it runs immediately. Its disposer then runs the
    // callback's own cleanup, exactly like the real registry.
    inject(_slot: string, callback: () => unknown) {
      const cleanup = callback()
      return () => {
        if (typeof cleanup === 'function') (cleanup as () => void)()
      }
    },
  }

  const tabRegistry = {
    register(definition: Record<string, unknown>) {
      definitions.push(definition)
      return () => {}
    },
  }
  const rightController = {
    openTab(kind: string) {
      opened.push(kind)
    },
  }

  const inner = {
    get: () => service,
    inject: () => () => {},
    slots: slotFace,
    get sidebarRightTabs() {
      return official ? tabRegistry : undefined
    },
    get sidebarRight() {
      return official ? rightController : undefined
    },
  }

  const ctx = {
    get: (name: string) => (name === 'betterSidebar' ? service : undefined),
    inject: (names: string[], callback: (inner: unknown) => unknown) => {
      const body: Injectable = {
        running: false,
        cleanup: undefined,
        run: () => {
          const result = callback(inner)
          body.cleanup = typeof result === 'function' ? result as () => void : undefined
          body.running = true
        },
        stop: () => {
          if (!body.running) return
          body.running = false
          const cleanup = body.cleanup
          body.cleanup = undefined
          cleanup?.()
        },
      }
      const ready = names.every((name) => {
        if (name === 'slots') return true
        if (name === 'betterSidebar') return service !== undefined
        if (name === 'sidebarRightTabs') return official
        return true
      })
      if (names.includes('betterSidebar')) {
        // Sidebar injects are driven by provide/withdraw, the way cordis
        // unloads and reloads a fiber when the service's epoch changes.
        sidebarFibers.push(body)
        if (ready) body.run()
      } else if (names.includes('sidebarRightTabs')) {
        rightFibers.push(body)
        if (ready) body.run()
      } else if (ready) {
        body.run()
      } else {
        pending.push(body.run)
      }
      return { dispose: body.stop }
    },
    slots: slotFace,
  } as unknown as ClientContext

  return {
    ctx,
    tabs,
    releases,
    slots,
    definitions,
    opened,
    provide(next) {
      // A service change is an epoch change: cordis unloads the fiber (running
      // the body's cleanup) and reloads it with the new service.
      service = next
      for (const fiber of sidebarFibers) {
        fiber.stop()
        fiber.run()
      }
      for (const run of pending.splice(0)) run()
    },
    withdraw() {
      // Plugin disabled: the service disappears and its inject fibers unload.
      service = undefined
      for (const fiber of sidebarFibers) fiber.stop()
    },
    dropOfficialRightSidebar() {
      // The official right Sidebar unloads: its tab registry and our type go too.
      official = false
      for (const fiber of rightFibers) fiber.stop()
    },
    fire() {
      for (const run of pending.splice(0)) run()
    },
  }
}

function fakeSidebar(into: BetterSidebarTabDescriptor[], releases: number[] = []): BetterSidebarFace {
  return {
    registerTab(descriptor) {
      into.push(descriptor)
      const index = releases.length
      releases.push(0)
      return () => {
        releases[index] += 1
      }
    },
  }
}

const api = {} as SkillMapApi

describe('registerSurface', () => {
  it('takes the official right Sidebar tab when that is the sidebar running', () => {
    const h = fakeCtx({ officialRightSidebar: true })
    registerSurface(h.ctx, api)
    expect(h.definitions).toHaveLength(1)
    expect(h.definitions[0]?.kind).toBe('kissfire-skill-map')
    expect(h.definitions[0]?.id).toBe('@kissfire/dsh-skill-map')
    // The central-panel seat went up first and was retired once the tab existed;
    // the body rides the keyed seat under a key of our own.
    expect(h.slots.map((call) => call.options.name)).toEqual(['sidebar.panellist', 'main', 'sidebar.right.pane.tab'])
    expect(h.slots[2]?.options.key).toBe('@kissfire/dsh-skill-map')
    expect(h.slots.slice(0, 2).map((call) => call.releases)).toEqual([1, 1])
    // Brought up once rather than left behind the guide page.
    expect(h.opened).toEqual(['kissfire-skill-map'])
  })

  it('falls back to the central panel when neither sidebar exists', () => {
    const h = fakeCtx()
    registerSurface(h.ctx, api)
    expect(h.definitions).toEqual([])
    expect(h.slots.map((call) => call.options.name)).toEqual(['sidebar.panellist', 'main'])
  })

  it('prefers the better-sidebar tab when its service is up', () => {
    const h = fakeCtx({ officialRightSidebar: true })
    h.provide(fakeSidebar(h.tabs))
    registerSurface(h.ctx, api)
    expect(h.tabs).toHaveLength(1)
    expect(h.tabs[0]?.single).toBe(true)
    // Two ways into the same panel would be a bug, so nothing else registers.
    expect(h.slots).toEqual([])
    expect(h.definitions).toEqual([])
  })

  it('retires the fallback seat when the better sidebar arrives late', () => {
    const h = fakeCtx()
    registerSurface(h.ctx, api)
    expect(h.slots).toHaveLength(2)

    h.provide(fakeSidebar(h.tabs))

    expect(h.tabs).toHaveLength(1)
    expect(h.slots.map((call) => call.releases)).toEqual([1, 1])
  })

  it('restores the official seat when the better sidebar is disabled', () => {
    const h = fakeCtx({ officialRightSidebar: true })
    h.provide(fakeSidebar(h.tabs, h.releases))
    registerSurface(h.ctx, api)
    expect(h.tabs).toHaveLength(1)
    expect(h.slots).toEqual([])

    h.withdraw()

    // Seat 1 died with its host; seat 2 is back, with its keyed tab.
    expect(h.releases).toEqual([1])
    expect(h.slots.map((call) => call.options.name)).toEqual(['sidebar.panellist', 'main', 'sidebar.right.pane.tab'])
    expect(h.definitions).toHaveLength(1)
    expect(h.opened).toEqual(['kissfire-skill-map'])
  })

  it('retakes seat 1 when the better sidebar comes back', () => {
    const h = fakeCtx({ officialRightSidebar: true })
    registerSurface(h.ctx, api)
    expect(h.slots).toHaveLength(3)

    h.provide(fakeSidebar(h.tabs, h.releases))
    expect(h.tabs).toHaveLength(1)
    expect(h.releases).toEqual([0])
    expect(h.slots.map((call) => call.releases)).toEqual([1, 1, 1])

    h.withdraw()
    expect(h.releases).toEqual([1])
    // The official seat went back up, and its tab body replaced the fallback.
    expect(h.slots).toHaveLength(6)
    expect(h.slots.slice(3).map((call) => call.releases)).toEqual([1, 1, 0])

    h.provide(fakeSidebar(h.tabs, h.releases))
    expect(h.tabs).toHaveLength(2)
    expect(h.releases).toEqual([1, 0])
    expect(h.slots.slice(3).map((call) => call.releases)).toEqual([1, 1, 1])
  })

  it('falls back to the central panel when the official right sidebar goes away', () => {
    const h = fakeCtx({ officialRightSidebar: true })
    registerSurface(h.ctx, api)
    expect(h.slots.map((call) => call.options.name))
      .toEqual(['sidebar.panellist', 'main', 'sidebar.right.pane.tab'])

    h.dropOfficialRightSidebar()

    // The tab type and body died with the sidebar; the central panel takes over
    // rather than leaving the plugin with no seat until a restart.
    expect(h.slots[2]?.releases).toBe(1)
    expect(h.slots.slice(3).map((call) => call.options.name)).toEqual(['sidebar.panellist', 'main'])
  })

  it('does not restore the fallback after the whole surface is disposed', () => {
    const h = fakeCtx()
    h.provide(fakeSidebar(h.tabs, h.releases))
    const dispose = registerSurface(h.ctx, api)
    expect(h.tabs).toHaveLength(1)

    dispose()
    h.withdraw()

    expect(h.slots).toEqual([])
    expect(h.releases).toEqual([1])
  })
})
