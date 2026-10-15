/**
 * Pure map assembly: the loaded inventory plus the user map become the payload
 * the panel renders. No filesystem access, so the placement rules are
 * unit-testable on their own.
 */

import {
  MAP_VERSION,
  MAX_DESCRIPTION_LENGTH,
  MISSING_DESCRIPTION,
  type DescriptionTranslations,
  type MapCategory,
  type MapPayload,
  type MapState,
  type SkillEntry,
} from './payload.ts'
import { SEED_CATEGORIES, SEED_ENTRIES } from './taxonomy.ts'

/**
 * The map a fresh install starts from: the shipped seed categories plus the
 * seeded placements. Once this state is written the user owns it.
 * @returns a new map state (never shared with the seed tables).
 */
export function seedMapState(): MapState {
  const assignments: Record<string, string> = {}
  for (const entry of SEED_ENTRIES) assignments[entry.skill] = entry.category
  return {
    version: MAP_VERSION,
    categories: SEED_CATEGORIES.map((category) => ({ ...category })),
    assignments,
  }
}

/**
 * Flatten a skill description to one line and bound its length, so a verbose
 * SKILL.md cannot dominate the panel row or the payload it rides in.
 * @param text - raw description (may carry newlines or runs of spaces).
 * @returns the compacted single line, ending in an ellipsis when truncated.
 */
export function compactDescription(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_DESCRIPTION_LENGTH) return flat
  const cut = flat.slice(0, MAX_DESCRIPTION_LENGTH)
  const boundary = cut.lastIndexOf(' ')
  // Break on the last word boundary, but only when it is not near the start:
  // a CJK description has no spaces at all and truncates mid-run by design.
  const head = boundary > MAX_DESCRIPTION_LENGTH / 2 ? cut.slice(0, boundary) : cut
  return `${head.trimEnd()}…`
}

/** Input for assembleMap. */
export interface AssembleMapInput {
  cwd: string
  complete: boolean
  mapPath: string
  /** Every loaded skill, with the description the panel shows under its name. */
  skills: readonly SkillEntry[]
  state: MapState
  /** Translated descriptions by language; omitted or empty when none exist. */
  translations?: DescriptionTranslations
}

/**
 * Assemble the list payload.
 *
 * Skills are matched by name; a placement naming a category that no longer
 * exists is treated as unplaced rather than inventing a category. Category
 * order is the stored array order (the user's own ordering); members and the
 * unassigned bucket are name-sorted. Descriptions ride beside the names rather
 * than inside every category, so one skill name still appears once per list.
 * @param input - inventory entries plus the user map.
 * @returns the payload served to the panel.
 */
export function assembleMap(input: AssembleMapInput): MapPayload {
  // The inventory is a set by construction (the scan dedupes by name), but the
  // payload must stay a set even if a caller passes a repeated name.
  const inventory: SkillEntry[] = []
  const knownNames = new Set<string>()
  for (const skill of input.skills) {
    if (knownNames.has(skill.name)) continue
    knownNames.add(skill.name)
    inventory.push(skill)
  }
  const names = inventory.map((skill) => skill.name)

  const knownCategories = new Set(input.state.categories.map((category) => category.id))
  const placedBy = new Map<string, string>()
  for (const name of names) {
    const category = input.state.assignments[name]
    if (category !== undefined && knownCategories.has(category)) placedBy.set(name, category)
  }

  const categories: MapCategory[] = input.state.categories.map((category) => ({
    id: category.id,
    name: category.name,
    skills: names.filter((name) => placedBy.get(name) === category.id).slice().sort((a, b) => a.localeCompare(b)),
  }))

  const unassigned = names
    .filter((name) => !placedBy.has(name))
    .slice()
    .sort((a, b) => a.localeCompare(b))

  const descriptions: Record<string, string> = {}
  for (const skill of inventory) {
    const text = compactDescription(skill.description)
    if (text !== '' && text !== MISSING_DESCRIPTION) descriptions[skill.name] = text
  }

  return {
    cwd: input.cwd,
    complete: input.complete,
    total: names.length,
    categories,
    unassigned,
    descriptions,
    ...(Object.keys(input.translations ?? {}).length > 0 ? { translations: input.translations } : {}),
    mapPath: input.mapPath,
  }
}
