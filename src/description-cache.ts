/**
 * Description translations: one optional JSON per language under
 * `<dshHome>/skill-map/descriptions.<lang>.json`, keyed by skill name.
 *
 * The file is user-owned content (the user or an agent writes it), so the
 * reader is forgiving: a missing directory, a broken file, a bad language tag
 * or a non-string value drops just that file or entry instead of failing the
 * list route. Nothing here writes, and nothing here reaches the network.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DescriptionTranslations } from './core/payload.ts'
import { SKILL_NAME_PATTERN } from './map-store.ts'

/** Language tag accepted in a cache file name (primary subtag plus optional ones). */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** Cache file name shape. */
const FILE_PATTERN = /^descriptions\.([A-Za-z0-9-]+)\.json$/

/** Largest cache file read into a list payload. */
export const MAX_TRANSLATION_BYTES = 512 * 1024

/** The directory holding the map file and every translation cache. */
export function translationsDir(dshHome: string): string {
  return join(dshHome, 'skill-map')
}

/** Absolute path of one language's cache file. */
export function translationPath(dshHome: string, language: string): string {
  return join(translationsDir(dshHome), `descriptions.${language}.json`)
}

/**
 * Parse one cache file, keeping only well-formed skill name → non-empty string
 * rows.
 * @param text - raw file contents.
 * @returns the usable rows, or undefined when the top-level shape is unusable.
 */
export function parseTranslationFile(text: string): Record<string, string> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SKILL_NAME_PATTERN.test(name)) continue
    if (typeof value !== 'string') continue
    const description = value.trim()
    if (description === '') continue
    out[name] = description
  }
  return out
}

/**
 * Read every `descriptions.<lang>.json` cache beside the map file.
 * @param dshHome - the DSH home directory.
 * @returns language tag → (skill name → translated description), key-sorted.
 */
export async function readTranslations(dshHome: string): Promise<DescriptionTranslations> {
  const dir = translationsDir(dshHome)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return {}
  }
  const found: DescriptionTranslations = {}
  for (const entry of entries) {
    const match = FILE_PATTERN.exec(entry)
    const language = match?.[1]
    if (language === undefined || !LANGUAGE_TAG_PATTERN.test(language)) continue
    const path = join(dir, entry)
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_TRANSLATION_BYTES) continue
      const parsed = parseTranslationFile(await readFile(path, 'utf8'))
      if (parsed !== undefined && Object.keys(parsed).length > 0) found[language] = parsed
    } catch {
      // Unreadable file: the panel falls back to the source description.
    }
  }
  const out: DescriptionTranslations = {}
  for (const language of Object.keys(found).sort()) {
    const rows = found[language]
    if (rows !== undefined) out[language] = rows
  }
  return out
}
