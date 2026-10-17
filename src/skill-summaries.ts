/**
 * Hand-written skill copy: the one-line brief beside the name, and the plain
 * paragraph shown on hover.
 *
 * Both exist because neither the SKILL.md description nor a truncation of it is
 * written for a person scanning a list. A description opens with its trigger
 * clause ("Use this skill whenever the user wants to…"), assumes the reader
 * knows the domain, and is addressed to the model rather than to someone
 * deciding whether to reach for the skill at all.
 *
 * Two files live beside the map. `<dshHome>/skill-map/summaries.json` is the
 * user's own copy and always wins; `summaries.auto.json` is what the panel's sync
 * action generated, read only where the hand-written file is silent. An entry is
 * either the brief alone (a bare string) or both lines plus the description
 * fingerprint they were written from:
 *
 *   {
 *     "pdf": "PDF 读取、合并、拆分与 OCR",
 *     "agent-reach": {
 *       "brief": "全网调研，按平台取内容",
 *       "detail": "你想知道别人怎么看一件事。它去各网站把内容找回来，整理成能读的文字。"
 *     }
 *   }
 *
 * Tolerant read, like the translation caches: a missing, truncated or reshaped
 * file falls back to the description, never to an empty row. The host never
 * writes it.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillSummaryEntry } from './core/payload.ts'

export type { SkillSummaryEntry }

/** Directory under the DSH home holding the map and its side files. */
const STORE_DIR = 'skill-map'

/** File names: the hand-written copy, and the machine-written one it outranks. */
const SUMMARIES_FILES = {
  hand: 'summaries.json',
  auto: 'summaries.auto.json',
} as const

/** Which copy file to read. */
export type SummaryKind = keyof typeof SUMMARIES_FILES

/** Fold whitespace to one line; undefined for anything that is not a usable string. */
function line(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' ? undefined : text
}

/**
 * Read one copy file.
 * @param dshHome - the DSH config root (`~/.dsh`).
 * @param kind - `hand` for the user's own file, `auto` for what the sync action wrote.
 * @returns skill name to entry; empty when the file is absent or unreadable.
 */
export async function readSkillSummaries(dshHome: string, kind: SummaryKind = 'hand'): Promise<Record<string, SkillSummaryEntry>> {
  let text: string
  try {
    text = await readFile(join(dshHome, STORE_DIR, SUMMARIES_FILES[kind]), 'utf8')
  } catch {
    return {}
  }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return {}
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return {}
  const out: Record<string, SkillSummaryEntry> = {}
  for (const [name, value] of Object.entries(doc as Record<string, unknown>)) {
    // A bare string is the brief-only shorthand.
    const bare = line(value)
    if (bare !== undefined) {
      out[name] = { brief: bare }
      continue
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const brief = line((value as { brief?: unknown }).brief)
    const detail = line((value as { detail?: unknown }).detail)
    const from = line((value as { from?: unknown }).from)
    if (brief === undefined && detail === undefined) continue
    out[name] = {
      ...(brief !== undefined ? { brief } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(from !== undefined ? { from } : {}),
    }
  }
  return out
}
