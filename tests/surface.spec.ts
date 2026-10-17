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
 */

interface SlotCall {
  options: Record<string, unknown>
  releases: number
}

function fakeCtx(options: {
  sidebar?: BetterSidebarFace
  officialRightSidebar?: boolean
} = {}): {
  ctx: ClientContext
  tabs: BetterSidebarTabDescriptor[]
  slots: SlotCall[]
  definitions: Array<Record<string, unknown>>
  opened: string[]
  provide(service: BetterSidebarFace): void
  fire(): void
} {
  const tabs: BetterSidebarTabDescriptor[] = []
  const slots: SlotCall[] = []
  const definitions: Array<Record<string, unknown>> = []
  const opened: string[] = []
  const pending: Array<() => void> = []
  let service = options.sidebar

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

  const inner = {
    get: () => service,
    inject: () => () => {},
    slots: slotFace,
    sidebarRightTabs: options.officialRightSidebar === true
      ? {
          register(definition: Record<string, unknown>) {
            definitions.push(definition)
            return () => {}
          },
        }
      : undefined,
    sidebarRight: options.officialRightSidebar === true
      ? {
          openTab(kind: string) {
            opened.push(kind)
          },
        }
      : undefined,
  }

  const ctx = {
    get: (name: string) => (name === 'betterSidebar' ? service : undefined),
    inject: (names: string[], callback: (inner: unknown) => unknown) => {
      let cleanup: unknown
      const run = (): void => {
        cleanup = callback(inner)
      }
      const ready = names.every((name) => {
        if (name === 'slots') return true
        if (name === 'betterSidebar') return service !== undefined
        if (name === 'sidebarRightTabs') return options.officialRightSidebar === true
        return true
      })
      if (ready) run()
      else pending.push(run)
      return {
        dispose: () => {
          if (typeof cleanup === 'function') (cleanup as () => void)()
        },
      }
    },
    slots: slotFace,
  } as unknown as ClientContext

  return {
    ctx,
    tabs,
    slots,
    definitions,
    opened,
    provide(next) {
      service = next
    },
    fire() {
      for (const run of pending.splice(0)) run()
    },
  }
}

function fakeSidebar(into: BetterSidebarTabDescriptor[]): BetterSidebarFace {
  return {
    registerTab(descriptor) {
      into.push(descriptor)
      return () => {}
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
    const tabs: BetterSidebarTabDescriptor[] = []
    const h = fakeCtx({ sidebar: fakeSidebar(tabs), officialRightSidebar: true })
    registerSurface(h.ctx, api)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.single).toBe(true)
    // Two ways into the same panel would be a bug, so nothing else registers.
    expect(h.slots).toEqual([])
    expect(h.definitions).toEqual([])
  })

  it('retires the fallback seat when the better sidebar arrives late', () => {
    const h = fakeCtx()
    registerSurface(h.ctx, api)
    expect(h.slots).toHaveLength(2)

    const tabs: BetterSidebarTabDescriptor[] = []
    h.provide(fakeSidebar(tabs))
    h.fire()

    expect(tabs).toHaveLength(1)
    expect(h.slots.map((call) => call.releases)).toEqual([1, 1])
  })
})
