/**
 * Pure map assembly: the loaded inventory plus the user map become the payload
 * the panel renders. No filesystem access, so the placement rules are
 * unit-testable on their own.
 */

import {
  MAP_VERSION,
  MAX_DESCRIPTION_LENGTH,
  MISSING_DESCRIPTION,
  type CopyCoverage,
  type DescriptionTranslations,
  type MapCategory,
  type MapPayload,
  type MapState,
  type SkillEntry,
  type SkillOrigin,
  type SkillSummaryEntry,
} from './payload.ts'
import { fingerprint } from './fingerprint.ts'
import { summarize } from './summary.ts'
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
  /** Skill name to the GitHub project it was installed from; omitted when no ledger exists. */
  sources?: Record<string, string>
  /**
   * Hand-written copy, keyed by skill name: the brief rides beside the name and
   * the detail replaces the description on hover. A skill absent here falls back
   * to its own description for both lines.
   */
  overrides?: Record<string, SkillSummaryEntry>
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
  const summaries: Record<string, string> = {}
  const origins: Record<string, SkillOrigin> = {}
  /** Skills the hand-written copy covers; everything else is reported as missing. */
  const written = new Set<string>()
  /** Covered skills whose description no longer hashes to the recorded fingerprint. */
  const changed: string[] = []
  /** Current description fingerprints, so the next writing pass can record them. */
  const prints: Record<string, string> = {}
  for (const skill of inventory) {
    const override = input.overrides?.[skill.name]
    // The hover line: the written paragraph when there is one, otherwise the
    // SKILL.md description compacted to one line.
    const text = override?.detail ?? compactDescription(skill.description)
    // The fingerprint tracks the compacted description the panel serves — the same
    // text a writer outside the host can see — not the raw SKILL.md body.
    const print = fingerprint(compactDescription(skill.description))
    prints[skill.name] = print
    if (override !== undefined) {
      written.add(skill.name)
      // The entry records the description it was written from, so a skill updated
      // under a name we already have copy for is surfaced rather than trusted.
      if (override.from !== undefined && override.from !== '' && override.from !== print) {
        changed.push(skill.name)
      }
    }
    if (text !== '' && text !== MISSING_DESCRIPTION) descriptions[skill.name] = text
    // The resting line: the written brief when there is one, otherwise the
    // description's first sentence. A truncation is only ever the fallback, never
    // the intent — a description's prefix is usually its trigger clause
    // ("MUST USE when…"), which says nothing about the job.
    const brief = override?.brief ?? summarize(skill.description)
    if (brief !== '' && brief !== MISSING_DESCRIPTION) summaries[skill.name] = brief
    const repo = input.sources?.[skill.name]
    if ((skill.level !== undefined && skill.level !== '') || (repo !== undefined && repo !== '')) {
      origins[skill.name] = {
        ...(skill.level !== undefined && skill.level !== '' ? { level: skill.level } : {}),
        ...(skill.project !== undefined && skill.project !== '' ? { project: skill.project } : {}),
        // `filesystem` is the scan's own marker for "no registry provider", not
        // something the row can say anything with, so it never reaches the wire.
        ...(skill.provider !== undefined && skill.provider !== '' && skill.provider !== 'filesystem' ? { provider: skill.provider } : {}),
        ...(repo !== undefined && repo !== '' ? { repo } : {}),
      }
    }
  }

  // Copy coverage: what the hand-written file still owes the inventory, and what
  // it holds for skills that are gone. Both drift whenever a skill is installed,
  // removed or upgraded, so they are recomputed rather than stored.
  const missing = names.filter((name) => !written.has(name)).slice().sort((a, b) => a.localeCompare(b))
  const stale = Object.keys(input.overrides ?? {}).filter((name) => !knownNames.has(name)).slice().sort((a, b) => a.localeCompare(b))
  changed.sort((a, b) => a.localeCompare(b))
  // Only the skills the next writing pass has to touch carry their fingerprint.
  const fingerprints: Record<string, string> = {}
  for (const name of [...missing, ...changed]) {
    const print = prints[name]
    if (print !== undefined) fingerprints[name] = print
  }

  return {
    cwd: input.cwd,
    complete: input.complete,
    total: names.length,
    categories,
    unassigned,
    descriptions,
    ...(Object.keys(summaries).length > 0 ? { summaries } : {}),
    ...(Object.keys(origins).length > 0 ? { origins } : {}),
    ...(missing.length > 0 || stale.length > 0 || changed.length > 0
      ? { copy: { missing, stale, changed, fingerprints } }
      : {}),
    ...(Object.keys(input.translations ?? {}).length > 0 ? { translations: input.translations } : {}),
    mapPath: input.mapPath,
  }
}
