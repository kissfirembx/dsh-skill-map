/**
 * Skills installer ledger: which GitHub project a skill was downloaded from.
 *
 * The `skills` CLI keeps a lock file beside the skills root it installs into
 * (`<agentsHome>/.skill-lock.json`). Each entry names the skill and the repo it
 * came from, so the map can answer "where did this come from" with the project
 * name instead of guessing from the file's location.
 *
 * Read-only and tolerant by construction: a missing, truncated or reshaped file
 * costs the origin line, never the list. Entries without a usable `source` are
 * simply absent, and a skill the ledger never saw keeps whatever the inventory
 * scan knows about it.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Lock file name the installer writes beside the skills root. */
const LEDGER_FILE = '.skill-lock.json'

/** One ledger entry, as far as this module cares about it. */
interface LedgerEntry {
  source?: unknown
  sourceType?: unknown
}

/**
 * Read the installer ledger under a skills root.
 * @param agentsHome - the agents config root (`~/.agents`), whose `.skill-lock.json` the CLI writes.
 * @returns skill name to `owner/repo`; empty when the ledger is absent or unreadable.
 */
export async function readSkillSources(agentsHome: string): Promise<Record<string, string>> {
  let text: string
  try {
    text = await readFile(join(agentsHome, LEDGER_FILE), 'utf8')
  } catch {
    return {}
  }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return {}
  }
  const skills = (doc as { skills?: unknown } | null)?.skills
  if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(skills as Record<string, LedgerEntry>)) {
    const source = value?.source
    if (typeof source !== 'string') continue
    const trimmed = source.trim()
    if (trimmed !== '') out[name] = trimmed
  }
  return out
}
