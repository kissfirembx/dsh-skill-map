import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { readDefaultModelRoute } from '../src/index.ts'

/**
 * The sync/classify actions must call the model route the profile itself runs.
 * A hardcoded provider goes stale (the official route was renamed once) and the
 * failure mode is silent: the call comes back empty and the panel says "all up to
 * date". This suite pins the resolver's tolerant contract.
 */

function contextWith(service: unknown): Context {
  return {
    get(name: string) {
      return name === 'agentDefaultModel' ? service : undefined
    },
  } as unknown as Context
}

describe('readDefaultModelRoute', () => {
  it('reads the provider and model the profile selected', () => {
    const ctx = contextWith({ currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) })
    expect(readDefaultModelRoute(ctx)).toBe('deepseek-account/deepseek-flash')
  })

  it('returns undefined when the service is absent', () => {
    expect(readDefaultModelRoute(contextWith(undefined))).toBeUndefined()
    expect(readDefaultModelRoute({} as Context)).toBeUndefined()
  })

  it('returns undefined when the selection is missing or incomplete', () => {
    expect(readDefaultModelRoute(contextWith({}))).toBeUndefined()
    expect(readDefaultModelRoute(contextWith({ currentSelection: () => undefined }))).toBeUndefined()
    expect(readDefaultModelRoute(contextWith({ currentSelection: () => ({ provider: 'x' }) }))).toBeUndefined()
    expect(readDefaultModelRoute(contextWith({ currentSelection: () => ({ provider: '', model: 'm' }) }))).toBeUndefined()
    expect(readDefaultModelRoute(contextWith({ currentSelection: () => ({ provider: 'p', model: 42 }) }))).toBeUndefined()
  })

  it('survives a service that throws', () => {
    const ctx = contextWith({ currentSelection: () => { throw new Error('nope') } })
    expect(readDefaultModelRoute(ctx)).toBeUndefined()
  })
})
