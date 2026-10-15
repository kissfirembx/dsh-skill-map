/**
 * The user map file: read, validate, seed and write.
 *
 * The map is the user's own data, so the reader is forgiving (a truncated or
 * hand-edited file falls back to the shipped seed instead of breaking the
 * panel) while the writer is strict (a save request from the panel is rejected
 * unless it is well formed). The only file this plugin ever writes lives here.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { seedMapState } from './core/map.ts'
import { CATEGORY_ID_PATTERN, MAP_VERSION, type MapCategoryRef, type MapState } from './core/payload.ts'

/** Skill name pattern accepted from the panel. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Upper bound on categories per map (guards a runaway client). */
export const MAX_CATEGORIES = 200

/** Upper bound on a category name, in characters. */
export const MAX_CATEGORY_NAME = 60

/** Absolute path of the map file under a DSH home directory. */
export function mapPath(dshHome: string): string {
  return join(dshHome, 'skill-map', 'map.json')
}

/** Narrow one stored category. */
function readCategory(value: unknown): MapCategoryRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !CATEGORY_ID_PATTERN.test(raw.id)) return undefined
  if (typeof raw.name !== 'string') return undefined
  const name = raw.name.trim()
  if (name === '' || name.length > MAX_CATEGORY_NAME) return undefined
  return { id: raw.id, name }
}

/**
 * Parse the map file, dropping rows that do not satisfy the schema.
 * @param text - raw file contents.
 * @returns the parsed state, or undefined when the top-level shape is unusable.
 */
export function parseMapState(text: string): MapState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const raw = parsed as Record<string, unknown>
  if (!Array.isArray(raw.categories)) return undefined

  const categories: MapCategoryRef[] = []
  const seen = new Set<string>()
  for (const value of raw.categories) {
    const category = readCategory(value)
    if (category === undefined || seen.has(category.id)) continue
    seen.add(category.id)
    categories.push(category)
  }

  const assignments: Record<string, string> = {}
  const rawAssignments = raw.assignments
  if (typeof rawAssignments === 'object' && rawAssignments !== null && !Array.isArray(rawAssignments)) {
    for (const [skill, category] of Object.entries(rawAssignments as Record<string, unknown>)) {
      if (!SKILL_NAME_PATTERN.test(skill)) continue
      if (typeof category !== 'string' || !seen.has(category)) continue
      assignments[skill] = category
    }
  }

  return { version: MAP_VERSION, categories, assignments }
}

/**
 * Validate a save request from the panel.
 * @param raw - the parsed JSON body.
 * @param knownSkills - names present in the current inventory; placements for
 *   any other name are dropped (a skill that was uninstalled must not keep a
 *   row alive forever).
 * @returns the state to write plus the drop count, or undefined when the
 *   request is malformed.
 */
export function sanitizeSave(raw: unknown, knownSkills: ReadonlySet<string>): { state: MapState; dropped: number } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.categories) || body.categories.length > MAX_CATEGORIES) return undefined
  if (typeof body.assignments !== 'object' || body.assignments === null || Array.isArray(body.assignments)) return undefined

  const categories: MapCategoryRef[] = []
  const seen = new Set<string>()
  for (const value of body.categories) {
    const category = readCategory(value)
    if (category === undefined) return undefined
    if (seen.has(category.id)) return undefined
    seen.add(category.id)
    categories.push(category)
  }

  const assignments: Record<string, string> = {}
  let dropped = 0
  for (const [skill, category] of Object.entries(body.assignments as Record<string, unknown>)) {
    if (typeof category !== 'string' || !seen.has(category)) return undefined
    if (!SKILL_NAME_PATTERN.test(skill) || !knownSkills.has(skill)) {
      dropped += 1
      continue
    }
    assignments[skill] = category
  }

  return { state: { version: MAP_VERSION, categories, assignments }, dropped }
}

/**
 * Read the map file, seeding a fresh one when it is missing or unreadable.
 * @param path - absolute map file path.
 * @returns the state plus whether it came from the seed (the caller persists it).
 */
export async function readMapState(path: string): Promise<{ state: MapState; seeded: boolean }> {
  if (!existsSync(path)) return { state: seedMapState(), seeded: true }
  try {
    const parsed = parseMapState(await readFile(path, 'utf8'))
    if (parsed === undefined) return { state: seedMapState(), seeded: true }
    return { state: parsed, seeded: false }
  } catch {
    return { state: seedMapState(), seeded: true }
  }
}

/**
 * Write the map file atomically (temp file + rename) so a crash mid-write
 * cannot leave a half-written map behind.
 * @param path - absolute map file path.
 * @param state - map to persist.
 */
export async function writeMapState(path: string, state: MapState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}
