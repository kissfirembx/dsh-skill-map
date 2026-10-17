/**
 * Wire contract shared by the skill-map halves. Pure types and constants only:
 * the browser bundle imports this module, so nothing here may reach for node
 * APIs.
 *
 * The map is a user-owned set of workspaces over the loaded skill inventory. A
 * workspace is one complete way of sorting the same skills: its own ordered
 * category list plus the placement of every skill into one of them (or into the
 * unassigned bucket). Switching tabs therefore switches classification scheme,
 * not a filter — the same skill can sit in different categories in two
 * workspaces.
 */

/** Current map file schema version. */
export const MAP_VERSION = 3

/** Placeholder the inventory stores when a SKILL.md carries no description. */
export const MISSING_DESCRIPTION = '(no description)'

/** Longest served description; longer text is compacted to one ellipsised line. */
export const MAX_DESCRIPTION_LENGTH = 200

/** Category id accepted from the panel and written to the map file. */
export const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Workspace id accepted from the panel and written to the map file. */
export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Upper bound on workspaces per file (guards a runaway client). */
export const MAX_WORKSPACES = 20

/** Longest accepted workspace name, in characters. */
export const MAX_WORKSPACE_NAME = 40

/**
 * Name a migrated single-map file keeps as its only workspace. Existing users
 * keep their categories under a tab they will recognise; the panel renames it
 * like any other workspace.
 */
export const DEFAULT_WORKSPACE_NAME = '默认分类'

/** One category as stored: id plus display name. */
export interface MapCategoryRef {
  id: string
  name: string
}

/** One category as served: the ref plus its members, name-sorted. */
export interface MapCategory extends MapCategoryRef {
  skills: string[]
}

/** One stored workspace: its name plus the classification it carries. */
export interface WorkspaceSave {
  id: string
  name: string
  categories: MapCategoryRef[]
  /** Skill name to category id; a skill named here is placed, everything else is unassigned. */
  assignments: Record<string, string>
}

/** The map file: the whole workspace list, versioned as one document. */
export interface MapFile {
  version: number
  workspaces: WorkspaceSave[]
}

/** One workspace as served: members resolved, unplaced skills collected. */
export interface MapWorkspace {
  id: string
  name: string
  categories: MapCategory[]
  /** Loaded skills this workspace does not place, name-sorted. */
  unassigned: string[]
}

/**
 * Legacy single-map state (file version 1/2). Only the migration reader uses it;
 * the panel and the save route speak `MapFile` now.
 */
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
  /**
   * Every loaded skill name, sorted. The panel needs the flat list to seed a new
   * workspace (all skills start there unassigned) and to explain the empty state.
   */
  skills: string[]
  /** Every workspace, in the user's tab order, with placements resolved. */
  workspaces: MapWorkspace[]
  /**
   * One compacted line per inventory skill, keyed by name. The panel unfolds it
   * under the skill name on hover and searches it alongside the name; a skill
   * the inventory carries no description for is simply absent.
   */
  descriptions: Record<string, string>
  /**
   * One sentence per skill, keyed by name, cut from the same raw description the
   * full line comes from. The panel shows it beside the skill name at rest, so a
   * row says what the skill does before it is hovered. Absent for the same
   * reasons as `descriptions`, and when no summary survives compaction.
   */
  summaries?: Record<string, string>
  /**
   * Where each skill came from, keyed by name. The panel reads it as the row's
   * origin line, shown on hover between the name and the full description.
   * Absent when the caller supplied no source level.
   */
  origins?: Record<string, SkillOrigin>
  /**
   * How the hand-written copy lines up with the live inventory. Recomputed on
   * every list, because the inventory drifts whenever a skill is installed,
   * removed or upgraded. Absent when the copy owes nothing and holds nothing
   * stale.
   */
  copy?: CopyCoverage
  /**
   * The same descriptions in other languages, read from the user's cache files
   * `<dshHome>/skill-map/descriptions.<lang>.json`. The panel picks one by its
   * language setting; a skill missing from a language falls back to
   * `descriptions`. Absent when no cache file exists.
   */
  translations?: DescriptionTranslations
  /** Absolute path of the user map file (the workspace document). */
  mapPath: string
}

/** Where one skill came from, as the panel shows it on the row's origin line. */
export interface SkillOrigin {
  /**
   * Source level key (the `level` field of the inventory record, see
   * SOURCE_GROUPS in collect.ts): `bundled`, `project-dsh`, `project-agents`,
   * `custom`, `user-dsh`, `user-agents`, `runtime`, or `other:<source>` for a
   * registry source the scan does not know. Absent when the caller supplied none.
   */
  level?: string
  /** Display name of the owning project or custom root; only project and custom levels carry one. */
  project?: string
  /** Registry provider (the plugin package that registered the skill); the filesystem scan reports `filesystem`. */
  provider?: string
  /**
   * GitHub project the skill was installed from (`owner/repo`), read from the
   * skills installer's ledger. The panel shows this in preference to the level
   * label, because it answers "where did this come from" exactly.
   */
  repo?: string
}

/** One hand-written entry for a skill: the one-line brief, the plain paragraph, or both. */
export interface SkillSummaryEntry {
  /** Shown beside the skill name at rest. */
  brief?: string
  /** Shown on hover in place of the skill's own description. */
  detail?: string
  /**
   * Fingerprint of the skill description this entry was written from (see
   * `src/core/fingerprint.ts`). When the skill's current description no longer
   * hashes to this, the entry is reported as due for review. Absent means "not
   * recorded", which is never reported — so a file written before this field
   * existed does not light up wholesale.
   */
  from?: string
}

/**
 * How the hand-written copy lines up with the live inventory. Both lists are
 * name-sorted, so the panel's report reads the same way every time.
 */
export interface CopyCoverage {
  /** Inventory skills with no hand-written row; their rows fall back to the raw SKILL.md text. */
  missing: string[]
  /** Hand-written rows no inventory skill claims; harmless to display, dead weight in the file. */
  stale: string[]
  /**
   * Rows whose skill has been updated since the copy was written. The entry still
   * matches a skill by name, so it renders — but it may now describe behaviour
   * that changed underneath it. Only entries that recorded a fingerprint qualify.
   */
  changed: string[]
  /**
   * Current description fingerprints for the skills named in `missing` and
   * `changed`, so the next writing pass can record them in the same breath as the
   * new text. `stale` names need no fingerprint.
   */
  fingerprints: Record<string, string>
}

/** One inventory skill as the list route hands it to assembly. */
export interface SkillEntry {
  name: string
  description: string
  /** Source level key; absent when the caller only carries a name and description. */
  level?: string
  /** Owning project or custom-root display name. */
  project?: string
  /** Registry provider name. */
  provider?: string
  /** GitHub project the skill was installed from (`owner/repo`). */
  repo?: string
}

/** Body of /api/dsh-skill-map/save: the whole workspace document. */
export interface SaveRequest {
  workspaces: WorkspaceSave[]
}

/** Result of /api/dsh-skill-map/save. */
export interface SaveResponse {
  ok: true
  mapPath: string
  /** Placements dropped because the skill is no longer installed. */
  dropped: number
}

/** Body of /api/dsh-skill-map/workspaces/auto. */
export interface AutoRequest {
  /** Place skills inside this existing workspace instead of creating one. */
  workspaceId?: string
}

/** Result of /api/dsh-skill-map/workspaces/auto. */
export interface AutoResponse {
  ok: true
  workspaceId: string
  name: string
  /**
   * `create` built a scheme of its own (a new workspace, or a blank one);
   * `assign` placed skills into categories the user had already built.
   */
  mode: 'create' | 'assign'
  /** Whether the model produced the classification or the built-in table fell back. */
  source: 'model' | 'seed'
  /** Skills the pass placed. */
  assigned: number
  /** Skills the pass looked at (still unassigned at the time). */
  total: number
  /** Present when the model was unavailable or unusable. */
  warning?: string
}
