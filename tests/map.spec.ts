import { describe, expect, it } from 'vitest'
import { assembleMap, compactDescription, seedMapState } from '../src/core/map.ts'
import { MAP_VERSION, MAX_DESCRIPTION_LENGTH, type SkillEntry } from '../src/core/payload.ts'

/** Shorthand: an inventory entry, description optional. */
function skill(name: string, description = ''): SkillEntry {
  return { name, description }
}

/**
 * Assembly rules: the user map decides category order and membership, a
 * placement that no longer resolves must degrade to the unassigned bucket
 * rather than invent a category, and every listed skill carries at most one
 * compacted description line.
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

describe('compactDescription', () => {
  it('flattens newlines and runs of spaces to one line', () => {
    expect(compactDescription('one\n  two\tthree ')).toBe('one two three')
  })

  it('leaves a short description untouched', () => {
    expect(compactDescription('short line')).toBe('short line')
  })

  it('breaks a long description on a word boundary and marks the cut', () => {
    const long = `${'word '.repeat(80)}end`
    const compacted = compactDescription(long)
    expect(compacted.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH + 1)
    expect(compacted.endsWith('…')).toBe(true)
    expect(compacted).not.toContain('  ')
  })

  it('truncates a CJK description that carries no spaces at all', () => {
    const compacted = compactDescription('技'.repeat(MAX_DESCRIPTION_LENGTH * 2))
    expect(compacted.endsWith('…')).toBe(true)
    expect(compacted.length).toBe(MAX_DESCRIPTION_LENGTH + 1)
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
      skills: [skill('alpha'), skill('zeta'), skill('beta'), skill('gamma')],
      state,
    })
    expect(payload.categories.map((category) => category.id)).toEqual(['b', 'a'])
    expect(payload.categories[0]?.skills).toEqual(['zeta'])
    expect(payload.categories[1]?.skills).toEqual(['alpha'])
  })

  it('puts every unplaced skill in the unassigned bucket, name-sorted', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('gamma'), skill('beta')], state })
    expect(payload.unassigned).toEqual(['beta', 'gamma'])
    expect(payload.total).toBe(2)
  })

  it('treats a placement naming a deleted category as unplaced', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha')],
      state: { ...state, categories: [{ id: 'b', name: '乙' }] },
    })
    expect(payload.categories[0]?.skills).toEqual([])
    expect(payload.unassigned).toEqual(['alpha'])
  })

  it('never lists a skill twice, even when the inventory repeats one', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha'), skill('alpha', 'second')], state })
    const listed = [...payload.categories.flatMap((category) => category.skills), ...payload.unassigned]
    expect(listed).toEqual(['alpha'])
    expect(payload.total).toBe(1)
  })

  it('carries the completeness flag and map path through', () => {
    const payload = assembleMap({ cwd: 'c', complete: false, mapPath: 'M', skills: [], state })
    expect(payload.complete).toBe(false)
    expect(payload.mapPath).toBe('M')
    expect(payload.total).toBe(0)
  })

  it('serves one description per skill, placed ones included', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'drafts copy'), skill('zeta', 'multi\nline copy'), skill('beta')],
      state,
    })
    expect(payload.descriptions).toEqual({
      alpha: 'drafts copy',
      zeta: 'multi line copy',
    })
  })

  it('omits the inventory placeholder and empty descriptions', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', '(no description)'), skill('beta', '   ')],
      state,
    })
    expect(payload.descriptions).toEqual({})
  })

  it('compacts an over-long description before serving it', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'x'.repeat(MAX_DESCRIPTION_LENGTH * 3))],
      state,
    })
    expect(payload.descriptions.alpha?.endsWith('…')).toBe(true)
  })

  it('carries translations only when a language cache has rows', () => {
    const base = { cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha', 'A')], state }
    expect(assembleMap(base).translations).toBeUndefined()
    expect(assembleMap({ ...base, translations: {} }).translations).toBeUndefined()
    expect(assembleMap({ ...base, translations: { zh: { alpha: '甲' } } }).translations).toEqual({ zh: { alpha: '甲' } })
  })
})
