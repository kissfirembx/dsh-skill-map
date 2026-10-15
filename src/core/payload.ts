/**
 * Wire contract shared by the skill-map halves. Pure types and constants only:
 * the browser bundle imports this module, so nothing here may reach for node
 * APIs.
 *
 * The map is a user-owned category list over the loaded skill inventory:
 * categories carry a name and an order (the array order), skills are placed by
 * name, and anything unplaced shows up in the unassigned bucket. There is no
 * taxonomy copy beyond the category name.
 */

/** Current map file schema version. */
export const MAP_VERSION = 2

/** Placeholder the inventory stores when a SKILL.md carries no description. */
export const MISSING_DESCRIPTION = '(no description)'

/** Longest served description; longer text is compacted to one ellipsised line. */
export const MAX_DESCRIPTION_LENGTH = 200

/** Category id accepted from the panel and written to the map file. */
export const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** One category as stored: id plus display name. */
export interface MapCategoryRef {
  id: string
  name: string
}

/** One category as served: the ref plus its members, name-sorted. */
export interface MapCategory extends MapCategoryRef {
  skills: string[]
}

/** The user-owned map: category order plus skill placements. */
export interface MapState {
  version: number
  categories: MapCategoryRef[]
  assignments: Record<string, string>
}

/** One language's skill descriptions: skill name → translated text. */
export type DescriptionRow = Record<string, string>

/** Translated descriptions keyed by language tag, e.g. `{ zh: { … } }`. */
export type DescriptionTranslations = Record<string, DescriptionRow>

/** List payload served by /api/dsh-skill-map/list. */
export interface MapPayload {
  cwd: string
  /** False when the registry snapshot could not be read in full. */
  complete: boolean
  /** Total skills in the inventory. */
  total: number
  categories: MapCategory[]
  /** Loaded skills no category claims, name-sorted. */
  unassigned: string[]
  /**
   * One compacted line per inventory skill, keyed by name. The panel shows it
   * under the skill name and searches it alongside the name; a skill the
   * inventory carries no description for is simply absent.
   */
  descriptions: Record<string, string>
  /**
   * The same descriptions in other languages, read from the user's cache files
   * `<dshHome>/skill-map/descriptions.<lang>.json`. The panel picks one by its
   * language setting; a skill missing from a language falls back to
   * `descriptions`. Absent when no cache file exists.
   */
  translations?: DescriptionTranslations
  /** Absolute path of the user map file. */
  mapPath: string
}

/** One inventory skill as the list route hands it to assembly. */
export interface SkillEntry {
  name: string
  description: string
}

/** Body of /api/dsh-skill-map/save. */
export interface SaveRequest {
  categories: MapCategoryRef[]
  assignments: Record<string, string>
}

/** Result of /api/dsh-skill-map/save. */
export interface SaveResponse {
  ok: true
  mapPath: string
  /** Placements dropped because the skill is no longer installed. */
  dropped: number
}
