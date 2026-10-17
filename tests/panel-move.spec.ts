import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED,
  moveSkill,
  newWorkspace,
  nextWorkspaceId,
  removeCategory,
  updateWorkspace,
  type Placements,
} from '../src/client/SkillMapPanel.tsx'

/**
 * Placement changes are pure: dragging a skill onto a category row, picking a
 * category inside an open row, and deleting a category all edit one workspace
 * before anything is saved. This suite pins the rules the panel relies on — a
 * move takes the skill out of its old bucket and sorts the target, a deletion
 * never loses a skill, and a mutation only touches the tab it names.
 */

function map(): Placements {
  return {
    categories: [
      { id: 'a', name: 'A', skills: ['one', 'three'] },
      { id: 'b', name: 'B', skills: ['two'] },
    ],
    unassigned: ['four'],
  }
}

/** A whole local document, for the workspace-level helpers. */
function document() {
  return {
    workspaces: [
      { id: 'w1', name: 'One', categories: map().categories, unassigned: map().unassigned },
      { id: 'w2', name: 'Two', categories: [], unassigned: ['one', 'two', 'three', 'four'] },
    ],
    skills: ['four', 'one', 'three', 'two'],
    descriptions: {},
    summaries: {},
    origins: {},
    copy: { missing: [], stale: [], changed: [], fingerprints: {} },
    translations: {},
    total: 4,
    mapPath: '/tmp/skill-map/map.json',
    complete: true,
  }
}

describe('moveSkill', () => {
  it('files the skill under the target category and sorts that category', () => {
    const next = moveSkill(map(), 'one', 'b')
    expect(next.categories.map((category) => category.id)).toEqual(['a', 'b'])
    expect(next.categories[0]!.skills).toEqual(['three'])
    expect(next.categories[1]!.skills).toEqual(['one', 'two'])
  })

  it('takes the skill out of the unassigned bucket on its way in', () => {
    const next = moveSkill(map(), 'four', 'b')
    expect(next.unassigned).toEqual([])
    expect(next.categories[1]!.skills).toEqual(['four', 'two'])
  })

  it('moves a skill back to the unassigned bucket', () => {
    const next = moveSkill(map(), 'one', UNASSIGNED)
    expect(next.categories[0]!.skills).toEqual(['three'])
    expect(next.unassigned).toEqual(['four', 'one'])
  })

  it('leaves the map untouched when the target is unknown', () => {
    const before = map()
    expect(moveSkill(before, 'one', 'gone')).toBe(before)
  })

  it('does not mutate the map it was handed', () => {
    const before = map()
    const next = moveSkill(before, 'one', 'b')
    expect(before.categories[0]!.skills).toEqual(['one', 'three'])
    expect(next).not.toBe(before)
    expect(next.categories).not.toBe(before.categories)
  })
})

describe('removeCategory', () => {
  it('returns the members to the unassigned bucket instead of dropping them', () => {
    const next = removeCategory(map(), 'a')
    expect(next.categories.map((category) => category.id)).toEqual(['b'])
    expect(next.unassigned).toEqual(['four', 'one', 'three'])
  })

  it('keeps the remaining categories in their order', () => {
    const next = removeCategory(map(), 'b')
    expect(next.categories.map((category) => category.id)).toEqual(['a'])
    expect(next.categories[0]!.skills).toEqual(['one', 'three'])
  })

  it('leaves the map untouched when the id is unknown', () => {
    const before = map()
    expect(removeCategory(before, 'gone')).toBe(before)
  })
})

describe('workspace helpers', () => {
  it('starts a new workspace with every skill unassigned', () => {
    const workspace = newWorkspace('w3', 'Three', ['two', 'one'])
    expect(workspace.categories).toEqual([])
    expect(workspace.unassigned).toEqual(['one', 'two'])
  })

  it('generates the first free workspace id', () => {
    expect(nextWorkspaceId([])).toBe('w1')
    expect(nextWorkspaceId(['w1', 'w2'])).toBe('w3')
    expect(nextWorkspaceId(['w2'])).toBe('w1')
  })

  it('mutates only the named workspace', () => {
    const before = document()
    const next = updateWorkspace(before, 'w2', (workspace) => ({
      ...workspace,
      categories: [{ id: 'c1', name: 'C', skills: [] }],
    }))
    expect(next.workspaces[0]).toBe(before.workspaces[0])
    expect(next.workspaces[1]!.categories).toEqual([{ id: 'c1', name: 'C', skills: [] }])
    expect(before.workspaces[1]!.categories).toEqual([])
  })

  it('returns the same document when the id names no workspace', () => {
    const before = document()
    expect(updateWorkspace(before, 'gone', (workspace) => workspace)).toBe(before)
  })
})
