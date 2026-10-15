import { describe, expect, it } from 'vitest'
import { assembleMap, seedMapState } from '../src/core/map.ts'
import { MAP_VERSION } from '../src/core/payload.ts'

/**
 * Assembly rules: the user map decides category order and membership, and a
 * placement that no longer resolves must degrade to the unassigned bucket
 * rather than invent a category.
 */
describe('seedMapState', () => {
  it('carries the shipped categories and placements', () => {
    const state = seedMapState()
    expect(state.version).toBe(MAP_VERSION)
    expect(state.categories.length).toBeGreaterThan(0)
    expect(Object.keys(state.assignments).length).toBeGreaterThan(0)
  })

  it('returns a fresh object each call', () => {
    const first = seedMapState()
    first.categories[0]!.name = 'mutated'
    expect(seedMapState().categories[0]!.name).not.toBe('mutated')
  })
})

describe('assembleMap', () => {
  const state = {
    version: MAP_VERSION,
    categories: [
      { id: 'b', name: '乙' },
      { id: 'a', name: '甲' },
    ],
    assignments: { zeta: 'b', alpha: 'a' },
  }

  it('keeps the stored category order and sorts members by name', () => {
    const payload = assembleMap({
      cwd: 'C:\\work',
      complete: true,
      mapPath: 'C:\\home\\.dsh\\skill-map\\map.json',
      skills: ['alpha', 'zeta', 'beta', 'gamma'],
      state,
    })
    expect(payload.categories.map((category) => category.id)).toEqual(['b', 'a'])
    expect(payload.categories[0]?.skills).toEqual(['zeta'])
    expect(payload.categories[1]?.skills).toEqual(['alpha'])
  })

  it('puts every unplaced skill in the unassigned bucket, name-sorted', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: ['gamma', 'beta'], state })
    expect(payload.unassigned).toEqual(['beta', 'gamma'])
    expect(payload.total).toBe(2)
  })

  it('treats a placement naming a deleted category as unplaced', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: ['alpha'],
      state: { ...state, categories: [{ id: 'b', name: '乙' }] },
    })
    expect(payload.categories[0]?.skills).toEqual([])
    expect(payload.unassigned).toEqual(['alpha'])
  })

  it('never lists a skill twice, even when the inventory repeats one', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: ['alpha', 'alpha'], state })
    const listed = [...payload.categories.flatMap((category) => category.skills), ...payload.unassigned]
    expect(listed).toEqual(['alpha'])
  })

  it('carries the completeness flag and map path through', () => {
    const payload = assembleMap({ cwd: 'c', complete: false, mapPath: 'M', skills: [], state })
    expect(payload.complete).toBe(false)
    expect(payload.mapPath).toBe('M')
    expect(payload.total).toBe(0)
  })
})
