import { describe, expect, it } from 'vitest'
import { SEED_CATEGORIES, SEED_ENTRIES } from '../src/core/taxonomy.ts'

/**
 * The seed table is the only shipped default. A broken seed (duplicate id,
 * placement pointing at a category that does not exist) would silently drop
 * skills into the unassigned bucket on a fresh install, so the invariants are
 * pinned here.
 */
describe('seed taxonomy', () => {
  it('gives every category a unique id and a non-empty name', () => {
    const ids = SEED_CATEGORIES.map((category) => category.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const category of SEED_CATEGORIES) {
      expect(category.id.trim()).not.toBe('')
      expect(category.name.trim()).not.toBe('')
    }
  })

  it('places each skill at most once, in a category that exists', () => {
    const known = new Set(SEED_CATEGORIES.map((category) => category.id))
    const seen = new Set<string>()
    for (const entry of SEED_ENTRIES) {
      expect(known.has(entry.category), `${entry.skill} -> ${entry.category}`).toBe(true)
      expect(seen.has(entry.skill), `duplicate ${entry.skill}`).toBe(false)
      seen.add(entry.skill)
    }
  })

  it('leaves no seeded category empty', () => {
    const used = new Set(SEED_ENTRIES.map((entry) => entry.category))
    const empty = SEED_CATEGORIES.filter((category) => !used.has(category.id)).map((category) => category.id)
    expect(empty).toEqual([])
  })
})
