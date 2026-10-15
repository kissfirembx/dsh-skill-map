import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillMapApi } from '../src/client/api.ts'
import { SKILL_MAP_TAB_ID, registerSkillMapTab, skillMapTabIcon, type BetterSidebarFace, type BetterSidebarTabDescriptor } from '../src/client/side-tab.tsx'

/**
 * The map reaches the right sidebar only through the public `betterSidebar`
 * service, and only after that service exists. This suite pins the contract:
 * nothing registers eagerly, the descriptor carries the id/label/single-tab
 * shape the sidebar expects, and both the registration and the pending inject
 * are released by the returned disposer.
 */

interface Registration {
  descriptor: BetterSidebarTabDescriptor
  releases: number
}

function fakeClient(service?: BetterSidebarFace): {
  ctx: ClientContext
  registrations: Registration[]
  injected: string[][]
  fireInject(): void
  disposeInject(): void
} {
  const registrations: Registration[] = []
  const injected: string[][] = []
  const pending: Array<() => unknown> = []
  let injectDisposed = 0
  const ctx = {
    inject(names: string[], callback: (inner: unknown) => unknown) {
      injected.push(names)
      pending.push(() => callback({ get: () => service, inject: () => () => {} }))
      return { dispose: () => { injectDisposed += 1 } }
    },
  } as unknown as ClientContext
  return {
    ctx,
    registrations,
    injected,
    fireInject() {
      for (const run of pending.splice(0)) run()
    },
    disposeInject: () => injectDisposed,
  }
}

/** A service that records registrations and hands back a disposer. */
function fakeService(registrations: Registration[]): BetterSidebarFace {
  return {
    registerTab(descriptor) {
      const record: Registration = { descriptor, releases: 0 }
      registrations.push(record)
      return () => { record.releases += 1 }
    },
  }
}

const api = {} as SkillMapApi

describe('skillMapTabIcon', () => {
  it('accepts a bare size', () => {
    expect(skillMapTabIcon(20).props.width).toBe(20)
  })

  it('accepts a props bag', () => {
    expect(skillMapTabIcon({ size: 14 }).props.width).toBe(14)
  })

  it('falls back to a default size when the sidebar passes nothing usable', () => {
    expect(skillMapTabIcon({}).props.width).toBe(16)
  })
})

describe('registerSkillMapTab', () => {
  it('waits for the right sidebar service instead of registering eagerly', () => {
    const client = fakeClient(fakeService([]))
    registerSkillMapTab(client.ctx, api)
    expect(client.injected).toEqual([['betterSidebar']])
    expect(client.registrations).toEqual([])
  })

  it('registers one single-instance tab once the service exists', () => {
    const registrations: Registration[] = []
    const client = fakeClient(fakeService(registrations))
    registerSkillMapTab(client.ctx, api)
    client.fireInject()
    expect(registrations).toHaveLength(1)
    const descriptor = registrations[0]!.descriptor
    expect(descriptor.id).toBe(SKILL_MAP_TAB_ID)
    expect(descriptor.single).toBe(true)
    expect(typeof descriptor.title()).toBe('string')
    expect(descriptor.title()).not.toBe('')
    expect(typeof descriptor.component).toBe('function')
  })

  it('registers nothing when the service never appears', () => {
    const client = fakeClient(undefined)
    const dispose = registerSkillMapTab(client.ctx, api)
    expect(() => { client.fireInject() }).not.toThrow()
    expect(() => { dispose() }).not.toThrow()
    expect(client.disposeInject()).toBe(1)
  })

  it('releases the tab registration and the pending inject together', () => {
    const registrations: Registration[] = []
    const client = fakeClient(fakeService(registrations))
    const dispose = registerSkillMapTab(client.ctx, api)
    client.fireInject()
    dispose()
    expect(registrations[0]!.releases).toBe(1)
    expect(client.disposeInject()).toBe(1)
  })
})
