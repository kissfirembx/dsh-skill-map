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
  /** Absolute path of the user map file. */
  mapPath: string
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
