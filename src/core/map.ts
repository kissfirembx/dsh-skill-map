/**
 * Pure map assembly: the loaded inventory plus the user map become the payload
 * the panel renders. No filesystem access, so the placement rules are
 * unit-testable on their own.
 */

import { MAP_VERSION, type MapCategory, type MapPayload, type MapState } from './payload.ts'
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

/** Input for assembleMap. */
export interface AssembleMapInput {
  cwd: string
  complete: boolean
  mapPath: string
  /** Names of every loaded skill. */
  skills: readonly string[]
  state: MapState
}

/**
 * Assemble the list payload.
 *
 * Skills are matched by name; a placement naming a category that no longer
 * exists is treated as unplaced rather than inventing a category. Category
 * order is the stored array order (the user's own ordering); members and the
 * unassigned bucket are name-sorted.
 * @param input - inventory names plus the user map.
 * @returns the payload served to the panel.
 */
export function assembleMap(input: AssembleMapInput): MapPayload {
  // The inventory is a set by construction (the scan dedupes by name), but the
  // payload must stay a set even if a caller passes a repeated name.
  const inventory = [...new Set(input.skills)]
  const known = new Set(input.state.categories.map((category) => category.id))
  const placedBy = new Map<string, string>()
  for (const name of inventory) {
    const category = input.state.assignments[name]
    if (category !== undefined && known.has(category)) placedBy.set(name, category)
  }

  const categories: MapCategory[] = input.state.categories.map((category) => ({
    id: category.id,
    name: category.name,
    skills: inventory.filter((name) => placedBy.get(name) === category.id).slice().sort((a, b) => a.localeCompare(b)),
  }))

  const unassigned = inventory
    .filter((name) => !placedBy.has(name))
    .slice()
    .sort((a, b) => a.localeCompare(b))

  return {
    cwd: input.cwd,
    complete: input.complete,
    total: inventory.length,
    categories,
    unassigned,
    mapPath: input.mapPath,
  }
}
