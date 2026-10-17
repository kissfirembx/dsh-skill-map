/**
 * Shared panel helpers: the active-dictionary pick (document-language based)
 * and the tiny {name} interpolator. All copy stays in locales.ts.
 */
import { en, zh, type SkillMapKey } from './locales.ts'
import type { SkillOrigin } from '../core/payload.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

/**
 * SDK translate seat wired by the browser apply() once ctx.locale is bound
 * (setRuntimeTranslate): reads the ACTIVE locale at call time, so plain-DOM
 * surfaces follow a runtime language switch. The document-language pick stays
 * as the unwired fallback (locale service absent, module-scope early callers).
 */
let runtimeT: ((key: SkillMapKey, values?: TranslateValues) => string) | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: ((key: SkillMapKey, values?: TranslateValues) => string) | undefined): void {
  runtimeT = t
}

/** Translate a key with optional {name} template params (current language). */
export function tt(key: SkillMapKey, values?: TranslateValues): string {
  if (runtimeT !== undefined) return runtimeT(key, values)
  let text: string = dictionary()[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Source level key to its display label (an unknown level renders as itself). */
function levelLabel(level: string): string {
  if (level === 'bundled') return tt('origin.bundled')
  if (level === 'runtime') return tt('origin.runtime')
  if (level === 'custom') return tt('origin.custom')
  if (level.startsWith('project-')) return tt('origin.project')
  if (level.startsWith('user-')) return tt('origin.global')
  if (level.startsWith('other:')) return level.slice(6)
  return level
}

/**
 * The row's origin line: where a skill came from, as one readable phrase.
 *
 * The level is the base. A project-scoped skill names the project (or custom
 * root) that owns it; a registry-provided skill falls back to the plugin package
 * that registered it. The filesystem scan reports provider `filesystem`, which
 * carries no information and is therefore dropped.
 * @param origin - served origin record, when the payload carries one for this skill.
 * @returns the display text, or undefined when there is nothing to show.
 */
export function originLabel(origin: SkillOrigin | undefined): string | undefined {
  if (origin === undefined) return undefined
  // The install ledger answers "where did this come from" exactly, so it wins
  // over the level label, which only says where the file happens to live.
  if (origin.repo !== undefined && origin.repo !== '') return origin.repo
  if (origin.level === undefined || origin.level === '') return undefined
  const parts = [levelLabel(origin.level)]
  if (origin.project !== undefined && origin.project !== '') parts.push(origin.project)
  else if (origin.provider !== undefined && origin.provider !== '' && origin.provider !== 'filesystem') parts.push(origin.provider)
  return parts.join(' · ')
}
