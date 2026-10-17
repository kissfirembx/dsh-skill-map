/**
 * The user map file: read, validate, migrate and write.
 *
 * The file now holds every workspace — each one a complete classification of the
 * same inventory. It is the user's own data, so the reader is forgiving (a
 * truncated or hand-edited row is dropped instead of breaking the panel) while
 * the writer is strict (a save request from the panel is rejected unless the
 * whole document is well formed). The only file this plugin ever writes is this
 * one.
 *
 * Version 3 replaced the single-map shape (`{ categories, assignments }`) with
 * `{ workspaces: [...] }`. A version 2 file is still read: it becomes one
 * workspace named after `DEFAULT_WORKSPACE_NAME`, and the next save writes the
 * new shape.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CATEGORY_ID_PATTERN,
  DEFAULT_WORKSPACE_NAME,
  MAP_VERSION,
  MAX_WORKSPACES,
  MAX_WORKSPACE_NAME,
  WORKSPACE_ID_PATTERN,
  type MapCategoryRef,
  type MapFile,
  type MapState,
  type WorkspaceSave,
} from './core/payload.ts'

/** Skill name pattern accepted from the panel. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Upper bound on categories per workspace (guards a runaway client). */
export const MAX_CATEGORIES = 200

/** Upper bound on a category name, in characters. */
export const MAX_CATEGORY_NAME = 60

/** The file a fresh install starts from: no workspace until the user asks for one. */
export function emptyMapFile(): MapFile {
  return { version: MAP_VERSION, workspaces: [] }
}

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
 * Parse one workspace row, dropping whatever does not satisfy the schema.
 * @param value - one entry of the file's `workspaces` array.
 * @returns the workspace, or undefined when its identity is unusable.
 */
function readWorkspace(value: unknown): WorkspaceSave | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !WORKSPACE_ID_PATTERN.test(raw.id)) return undefined
  if (typeof raw.name !== 'string') return undefined
  const name = raw.name.trim()
  if (name === '' || name.length > MAX_WORKSPACE_NAME) return undefined

  const categories: MapCategoryRef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw.categories)) {
    for (const value of raw.categories) {
      const category = readCategory(value)
      if (category === undefined || seen.has(category.id)) continue
      seen.add(category.id)
      categories.push(category)
    }
  }

  const assignments: Record<string, string> = {}
  if (typeof raw.assignments === 'object' && raw.assignments !== null && !Array.isArray(raw.assignments)) {
    for (const [skill, category] of Object.entries(raw.assignments as Record<string, unknown>)) {
      if (!SKILL_NAME_PATTERN.test(skill)) continue
      if (typeof category !== 'string' || !seen.has(category)) continue
      assignments[skill] = category
    }
  }

  return { id: raw.id, name, categories, assignments }
}

/**
 * Parse the legacy single-map shape (file version 1/2).
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

  // The version reported here is the shape that was read, not the version the
  // writer emits: the migration path only exists for files this old.
  return { version: 2, categories, assignments }
}

/** One parse result: the document plus whether it came from the legacy shape. */
export interface ParsedMap {
  file: MapFile
  legacy: boolean
}

/**
 * Parse the map file, accepting both the workspace document and the legacy
 * single-map shape.
 * @param text - raw file contents.
 * @returns the document, or undefined when neither shape is usable.
 */
export function parseMapFile(text: string): ParsedMap | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const raw = parsed as Record<string, unknown>

  if (Array.isArray(raw.workspaces)) {
    const workspaces: WorkspaceSave[] = []
    const seen = new Set<string>()
    for (const value of raw.workspaces) {
      const workspace = readWorkspace(value)
      if (workspace === undefined || seen.has(workspace.id)) continue
      seen.add(workspace.id)
      workspaces.push(workspace)
    }
    return { file: { version: MAP_VERSION, workspaces }, legacy: false }
  }

  if (Array.isArray(raw.categories)) {
    const legacy = parseMapState(text)
    if (legacy === undefined) return undefined
    return {
      file: {
        version: MAP_VERSION,
        workspaces: [{
          id: 'w1',
          name: DEFAULT_WORKSPACE_NAME,
          categories: legacy.categories,
          assignments: legacy.assignments,
        }],
      },
      legacy: true,
    }
  }

  return undefined
}

/**
 * Validate a save request from the panel (the whole workspace document).
 * @param raw - the parsed JSON body.
 * @param knownSkills - names present in the current inventory; placements for
 *   any other name are dropped (a skill that was uninstalled must not keep a
 *   row alive forever).
 * @returns the document to write plus the drop count, or undefined when the
 *   request is malformed.
 */
export function sanitizeSave(raw: unknown, knownSkills: ReadonlySet<string>): { file: MapFile; dropped: number } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.workspaces) || body.workspaces.length > MAX_WORKSPACES) return undefined

  const workspaces: WorkspaceSave[] = []
  const seenWorkspaces = new Set<string>()
  let dropped = 0

  for (const value of body.workspaces) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const workspace = value as Record<string, unknown>
    if (typeof workspace.id !== 'string' || !WORKSPACE_ID_PATTERN.test(workspace.id)) return undefined
    if (seenWorkspaces.has(workspace.id)) return undefined
    seenWorkspaces.add(workspace.id)
    if (typeof workspace.name !== 'string') return undefined
    const name = workspace.name.trim()
    if (name === '' || name.length > MAX_WORKSPACE_NAME) return undefined
    if (!Array.isArray(workspace.categories) || workspace.categories.length > MAX_CATEGORIES) return undefined
    if (typeof workspace.assignments !== 'object' || workspace.assignments === null || Array.isArray(workspace.assignments)) return undefined

    const categories: MapCategoryRef[] = []
    const seenCategories = new Set<string>()
    for (const entry of workspace.categories) {
      const category = readCategory(entry)
      if (category === undefined) return undefined
      if (seenCategories.has(category.id)) return undefined
      seenCategories.add(category.id)
      categories.push(category)
    }

    const assignments: Record<string, string> = {}
    for (const [skill, category] of Object.entries(workspace.assignments as Record<string, unknown>)) {
      if (typeof category !== 'string' || !seenCategories.has(category)) return undefined
      if (!SKILL_NAME_PATTERN.test(skill) || !knownSkills.has(skill)) {
        dropped += 1
        continue
      }
      assignments[skill] = category
    }

    workspaces.push({ id: workspace.id, name, categories, assignments })
  }

  return { file: { version: MAP_VERSION, workspaces }, dropped }
}

/**
 * Read the map file. A missing, unreadable or unusable file degrades to an empty
 * document, so the panel shows its first-run prompt instead of a phantom
 * classification the user never confirmed.
 * @param path - absolute map file path.
 * @returns the document plus whether it was read from the legacy shape.
 */
export async function readMapFile(path: string): Promise<{ file: MapFile; migrated: boolean }> {
  if (!existsSync(path)) return { file: emptyMapFile(), migrated: false }
  try {
    const parsed = parseMapFile(await readFile(path, 'utf8'))
    if (parsed === undefined) return { file: emptyMapFile(), migrated: false }
    return { file: parsed.file, migrated: parsed.legacy }
  } catch {
    return { file: emptyMapFile(), migrated: false }
  }
}

/**
 * Write the map file atomically (temp file + rename) so a crash mid-write cannot
 * leave a half-written document behind.
 * @param path - absolute map file path.
 * @param file - document to persist.
 */
export async function writeMapFile(path: string, file: MapFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}
