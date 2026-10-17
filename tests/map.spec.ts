import { describe, expect, it } from 'vitest'
import { assembleMap, compactDescription, seedMapState } from '../src/core/map.ts'
import { fingerprint } from '../src/core/fingerprint.ts'
import { MAP_VERSION, MAX_DESCRIPTION_LENGTH, type MapCategoryRef, type SkillEntry, type WorkspaceSave } from '../src/core/payload.ts'

/** Shorthand: an inventory entry, description optional. */
function skill(name: string, description = ''): SkillEntry {
  return { name, description }
}

/** Shorthand: one stored workspace. */
function workspace(id: string, name: string, categories: MapCategoryRef[], assignments: Record<string, string>): WorkspaceSave {
  return { id, name, categories, assignments }
}

/**
 * Assembly rules: each workspace decides its own category order and membership,
 * a placement that no longer resolves degrades to that workspace's unassigned
 * bucket, and the global copy/description maps are computed once per inventory.
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
  const state = workspace('w1', '甲套', [
    { id: 'b', name: '乙' },
    { id: 'a', name: '甲' },
  ], { zeta: 'b', alpha: 'a' })

  it('keeps the stored category order and sorts members by name', () => {
    const payload = assembleMap({
      cwd: 'C:\\work',
      complete: true,
      mapPath: 'C:\\home\\.dsh\\skill-map\\map.json',
      skills: [skill('alpha'), skill('zeta'), skill('beta'), skill('gamma')],
      workspaces: [state],
    })
    const shown = payload.workspaces[0]!
    expect(shown.categories.map((category) => category.id)).toEqual(['b', 'a'])
    expect(shown.categories[0]?.skills).toEqual(['zeta'])
    expect(shown.categories[1]?.skills).toEqual(['alpha'])
  })

  it('puts every unplaced skill in the unassigned bucket, name-sorted', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('gamma'), skill('beta')], workspaces: [state] })
    expect(payload.workspaces[0]?.unassigned).toEqual(['beta', 'gamma'])
    expect(payload.total).toBe(2)
  })

  it('treats a placement naming a deleted category as unplaced', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha')],
      workspaces: [{ ...state, categories: [{ id: 'b', name: '乙' }] }],
    })
    expect(payload.workspaces[0]?.categories[0]?.skills).toEqual([])
    expect(payload.workspaces[0]?.unassigned).toEqual(['alpha'])
  })

  it('never lists a skill twice, even when the inventory repeats one', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha'), skill('alpha', 'second')], workspaces: [state] })
    const listed = [
      ...(payload.workspaces[0]?.categories.flatMap((category) => category.skills) ?? []),
      ...(payload.workspaces[0]?.unassigned ?? []),
    ]
    expect(listed).toEqual(['alpha'])
    expect(payload.total).toBe(1)
  })

  it('resolves each workspace independently over the same inventory', () => {
    const other = workspace('w2', '乙套', [{ id: 'x', name: '另一套' }], { beta: 'x' })
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha'), skill('beta')],
      workspaces: [state, other],
    })
    expect(payload.workspaces.map((entry) => entry.id)).toEqual(['w1', 'w2'])
    expect(payload.workspaces[0]?.categories[1]?.skills).toEqual(['alpha'])
    expect(payload.workspaces[0]?.unassigned).toEqual(['beta'])
    expect(payload.workspaces[1]?.categories[0]?.skills).toEqual(['beta'])
    expect(payload.workspaces[1]?.unassigned).toEqual(['alpha'])
  })

  it('serves a name-sorted flat skill list for seeding a new workspace', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('zeta'), skill('alpha', 'A')],
      workspaces: [],
    })
    expect(payload.skills).toEqual(['alpha', 'zeta'])
    expect(payload.workspaces).toEqual([])
  })

  it('carries the completeness flag and map path through', () => {
    const payload = assembleMap({ cwd: 'c', complete: false, mapPath: 'M', skills: [], workspaces: [state] })
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
      workspaces: [state],
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
      workspaces: [state],
    })
    expect(payload.descriptions).toEqual({})
  })

  it('compacts an over-long description before serving it', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'x'.repeat(MAX_DESCRIPTION_LENGTH * 3))],
      workspaces: [state],
    })
    expect(payload.descriptions.alpha?.endsWith('…')).toBe(true)
  })

  it('carries translations only when a language cache has rows', () => {
    const base = { cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha', 'A')], workspaces: [state] }
    expect(assembleMap(base).translations).toBeUndefined()
    expect(assembleMap({ ...base, translations: {} }).translations).toBeUndefined()
    expect(assembleMap({ ...base, translations: { zh: { alpha: '甲' } } }).translations).toEqual({ zh: { alpha: '甲' } })
  })
})

/**
 * The resting row carries a summary and the open row carries an origin line, so
 * assembly has to serve both beside the full description — and stay silent for a
 * skill whose inventory entry says nothing about where it came from.
 */
describe('summaries and origins', () => {
  const workspaces = [workspace('w1', '甲套', [{ id: 'a', name: '甲' }], {})]

  it('serves a one-sentence summary beside the full description', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'Runs the tests. Then it writes a long report that keeps going.')],
      workspaces,
    })
    expect(payload.summaries?.alpha).toBe('Runs the tests.')
    expect(payload.descriptions?.alpha).toBe('Runs the tests. Then it writes a long report that keeps going.')
  })

  it('omits the summaries map when no description survives', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha', '(no description)')], workspaces })
    expect(payload.summaries).toBeUndefined()
    expect(payload.descriptions).toEqual({})
  })

  it('prefers hand-written copy over the description for both lines', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'MUST USE when the user wants to look something up on the internet.')],
      workspaces,
      overrides: { alpha: { brief: '全网调研，按平台取内容', detail: '你想知道别人怎么看一件事。' } },
    })
    expect(payload.summaries?.alpha).toBe('全网调研，按平台取内容')
    expect(payload.descriptions?.alpha).toBe('你想知道别人怎么看一件事。')
  })

  it('falls back per line when an entry writes only one of them', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'Extracts the text. Then it does more.')],
      workspaces,
      overrides: { alpha: { brief: '只写了短简介' } },
    })
    expect(payload.summaries?.alpha).toBe('只写了短简介')
    expect(payload.descriptions?.alpha).toBe('Extracts the text. Then it does more.')
  })

  it('reports what the copy still owes the inventory, and what it holds stale', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'A'), skill('beta', 'B')],
      workspaces,
      overrides: { beta: { brief: '乙' }, gone: { brief: '已经删掉的 skill' } },
    })
    expect(payload.copy?.missing).toEqual(['alpha'])
    expect(payload.copy?.stale).toEqual(['gone'])
    expect(payload.copy?.changed).toEqual([])
    expect(payload.copy?.fingerprints).toEqual({ alpha: fingerprint('A') })
  })

  it('omits the coverage report when the copy matches the inventory', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'A')],
      workspaces,
      overrides: { alpha: { brief: '甲' } },
    })
    expect(payload.copy).toBeUndefined()
  })

  it('reports a covered skill whose description changed, with its new fingerprint', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'A rewritten description')],
      workspaces,
      overrides: { alpha: { brief: '甲', from: 'deadbeef' } },
    })
    expect(payload.copy?.changed).toEqual(['alpha'])
    expect(payload.copy?.missing).toEqual([])
    expect(payload.copy?.fingerprints.alpha).toBe(fingerprint('A rewritten description'))
  })

  it('stays quiet while the recorded fingerprint still matches', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'Same text')],
      workspaces,
      overrides: { alpha: { brief: '甲', from: fingerprint('Same text') } },
    })
    expect(payload.copy).toBeUndefined()
  })

  it('serves an origin for every skill that carries a source level', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [
        { name: 'alpha', description: 'x', level: 'project-dsh', project: 'dsh-skill-map', provider: 'filesystem' },
        { name: 'beta', description: 'y', level: 'bundled', provider: '@deepseek-ai/dsh-web-all' },
        { name: 'gamma', description: 'z' },
      ],
      workspaces,
    })
    expect(payload.origins).toEqual({
      alpha: { level: 'project-dsh', project: 'dsh-skill-map' },
      beta: { level: 'bundled', provider: '@deepseek-ai/dsh-web-all' },
    })
  })

  it('drops blank project and provider values instead of serving empty strings', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [{ name: 'alpha', description: 'x', level: 'user-dsh', project: '', provider: '' }],
      workspaces,
    })
    expect(payload.origins).toEqual({ alpha: { level: 'user-dsh' } })
  })

  it('omits the origins map when no caller supplies a level', () => {
    const payload = assembleMap({ cwd: 'c', complete: true, mapPath: 'm', skills: [skill('alpha', 'A')], workspaces })
    expect(payload.origins).toBeUndefined()
  })

  it('attaches the install ledger project to the origin', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [{ name: 'alpha', description: 'x', level: 'user-dsh' }],
      workspaces,
      sources: { alpha: 'dontbesilent2025/dbskill' },
    })
    expect(payload.origins).toEqual({ alpha: { level: 'user-dsh', repo: 'dontbesilent2025/dbskill' } })
  })

  it('serves an origin from the ledger even when no level is known', () => {
    const payload = assembleMap({
      cwd: 'c',
      complete: true,
      mapPath: 'm',
      skills: [skill('alpha', 'x')],
      workspaces,
      sources: { alpha: 'anthropics/skills' },
    })
    expect(payload.origins).toEqual({ alpha: { repo: 'anthropics/skills' } })
  })
})
