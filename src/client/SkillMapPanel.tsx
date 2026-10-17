/**
 * Skill map panel: the loaded skills as the user's own categories.
 *
 * The user owns the shape of this list. Categories are renamed, created,
 * deleted and reordered in place; skills are dragged between categories (or
 * onto Unassigned). Every mutation is persisted as one whole-map save, so the
 * file on disk and the panel can never drift.
 *
 * A skill row is one line: the name, plus its invocation string on hover
 * (clicking the row copies `/name`). Its description stays collapsed and
 * unfolds on hover, or while a search is filtering, so the list keeps its
 * rhythm at rest. The description is searched either way, so a half remembered
 * phrase finds the skill whose name the user forgot.
 *
 * Descriptions come from each skill's own SKILL.md, so they keep the language
 * its author wrote. The footer language picker switches to any translation
 * cache kept beside the map file
 * (`<dshHome>/skill-map/descriptions.<lang>.json`); a skill with no row in that
 * cache keeps its source text.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkillMapApi } from './api.ts'
import type { CopyCoverage, DescriptionTranslations, MapCategory, MapPayload, SaveRequest, SkillOrigin } from '../core/payload.ts'
import { originLabel, tt } from './panel-helpers.ts'
import css from './skill-map-panel.module.css'

/** Panel props: the API client the panel loads and saves through. */
export interface SkillMapPanelProps {
  api: SkillMapApi
}

/** Local, editable shape of the map. */
interface LocalMap {
  categories: MapCategory[]
  unassigned: string[]
  /** One-line description per skill name; absent when the inventory has none. */
  descriptions: Record<string, string>
  /** One-sentence summary per skill name, shown beside the name while the row is at rest. */
  summaries: Record<string, string>
  /** Origin per skill name, shown on the row's open line above the full description. */
  origins: Record<string, SkillOrigin>
  /** Coverage of the hand-written copy, as the host last computed it. */
  copy: CopyCoverage
  /** Translations by language tag, when the user keeps cache files. */
  translations: DescriptionTranslations
  total: number
  mapPath: string
  complete: boolean
}

/** Footer message: a copy confirmation or a failure to report. */
interface Notice {
  text: string
  kind: 'ok' | 'error'
}

/** Drop target standing for the unassigned bucket. */
const UNASSIGNED = '__unassigned__'

/** Save debounce: several quick edits become one write. */
const SAVE_DELAY_MS = 400

/** How long a copy confirmation stays on screen. */
const NOTICE_MS = 2600

/** Language value meaning "the description the skill's own SKILL.md carries". */
export const SOURCE_LANGUAGE = 'source'

/** localStorage key holding the description-language choice. */
export const LANGUAGE_STORAGE_KEY = 'dsh-skill-map:description-language'

/** The stored language choice, or the source language when storage is unusable. */
export function readStoredLanguage(): string {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : null
    return value !== null && value !== '' ? value : SOURCE_LANGUAGE
  } catch {
    return SOURCE_LANGUAGE
  }
}

/** Persist the language choice; a storage failure still leaves the session choice. */
export function storeLanguage(language: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Private mode or a hostile storage: the in-memory choice still applies.
  }
}

/** Human name of a language tag, falling back to the tag itself. */
export function languageLabel(tag: string): string {
  try {
    const ui = typeof navigator !== 'undefined' && navigator.language !== '' ? navigator.language : 'en'
    return new Intl.DisplayNames([ui], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** Payload to local shape. */
function toLocal(payload: MapPayload): LocalMap {
  return {
    categories: payload.categories.map((category) => ({ ...category, skills: [...category.skills] })),
    unassigned: [...payload.unassigned],
    descriptions: { ...payload.descriptions },
    summaries: { ...payload.summaries },
    origins: { ...payload.origins },
    copy: payload.copy ?? { missing: [], stale: [], changed: [], fingerprints: {} },
    translations: { ...payload.translations },
    total: payload.total,
    mapPath: payload.mapPath,
    complete: payload.complete,
  }
}

/** Local shape to the save request (placements derive from membership). */
export function toRequest(map: LocalMap): SaveRequest {
  const assignments: Record<string, string> = {}
  for (const category of map.categories) {
    for (const skill of category.skills) assignments[skill] = category.id
  }
  return {
    categories: map.categories.map((category) => ({ id: category.id, name: category.name })),
    assignments,
  }
}

/** First free generated id, so ids stay readable in the file. */
export function nextCategoryId(existing: Iterable<string>): string {
  const taken = new Set(existing)
  let index = 1
  while (taken.has(`c${index}`)) index += 1
  return `c${index}`
}

/**
 * Whether a skill belongs in the current result set: its name or its
 * description contains the query (already lower-cased).
 * @param name - skill name.
 * @param description - served description, when the inventory has one.
 * @param query - lower-cased trimmed query; empty matches everything.
 */
export function matchesSkill(name: string, description: string | undefined, query: string): boolean {
  if (query === '') return true
  if (name.toLowerCase().includes(query)) return true
  return description !== undefined && description.toLowerCase().includes(query)
}

/** Move one skill into a category (or into the unassigned bucket). */
function moveSkill(map: LocalMap, skill: string, toId: string): LocalMap {
  const categories = map.categories.map((category) => ({
    ...category,
    skills: category.skills.filter((name) => name !== skill),
  }))
  if (toId === UNASSIGNED) {
    return {
      ...map,
      categories,
      unassigned: [...map.unassigned.filter((name) => name !== skill), skill].sort((a, b) => a.localeCompare(b)),
    }
  }
  const target = categories.find((category) => category.id === toId)
  if (target === undefined) return map
  target.skills = [...target.skills, skill].sort((a, b) => a.localeCompare(b))
  return {
    ...map,
    categories,
    unassigned: map.unassigned.filter((name) => name !== skill),
  }
}

/** Reorder one category to another's position. */
function reorderCategories(map: LocalMap, fromId: string, toId: string): LocalMap {
  const from = map.categories.findIndex((category) => category.id === fromId)
  const to = map.categories.findIndex((category) => category.id === toId)
  if (from < 0 || to < 0 || from === to) return map
  const categories = [...map.categories]
  const [moved] = categories.splice(from, 1)
  if (moved === undefined) return map
  categories.splice(to, 0, moved)
  return { ...map, categories }
}

/** The invocation string a skill row copies. */
export function invocationOf(name: string): string {
  return `/${name}`
}

/**
 * Copy text to the clipboard, falling back to a hidden textarea selection when
 * the async clipboard API is unavailable (jsdom, insecure contexts).
 * @param text - the string to copy.
 * @returns whether the copy is expected to have landed.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection fallback.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
    area.remove()
    return copied
  } catch {
    return false
  }
}

/** The disclosure chevron: rotated a quarter turn while the category is open. */
function CaretIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={css.caretIcon}
      data-open={open}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Rename action glyph. */
function RenameIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M11.4 2.6a1.7 1.7 0 0 1 2.4 2.4L5.9 12.9l-3.3.8.8-3.3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Delete action glyph. */
function RemoveIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Gear glyph opening the panel's own settings. */
function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <g stroke="currentColor" strokeWidth="2.4">
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
        <path d="M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
      </g>
    </svg>
  )
}

/** Back-arrow glyph for the settings header. */
function BackIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The panel's own settings view. Every option the map grows belongs in one of
 * these groups, so adding a setting never means finding room in the list head.
 */
function SettingsView({
  language,
  languages,
  mapPath,
  onLanguage,
  onClose,
}: {
  language: string
  languages: string[]
  mapPath: string
  onLanguage: (next: string) => void
  onClose: () => void
}): React.JSX.Element {
  const dir = mapPath.replace(/map\.json$/, '')
  return (
    <div className={css.pane} data-dsh-skillmap-view="" data-dsh-plugin="skill-map" data-dsh-view="settings">
      <header className={css.head} data-dsh-part="head">
        <button
          type="button"
          className={css.iconButton}
          title={tt('settings.back')}
          aria-label={tt('settings.back')}
          onClick={onClose}
        >
          <BackIcon />
        </button>
        <span className={css.title}>{tt('settings.title')}</span>
      </header>
      <div className={css.settings} data-dsh-part="settings">
        <section className={css.settingGroup}>
          <h3 className={css.settingGroupTitle}>{tt('settings.display')}</h3>
          <label className={css.settingRow}>
            <span className={css.settingLabel}>{tt('desc.language')}</span>
            <select
              className={css.langSelect}
              value={language}
              aria-label={tt('desc.language')}
              onChange={(event) => { onLanguage(event.target.value) }}
            >
              <option value={SOURCE_LANGUAGE}>{tt('desc.source')}</option>
              {languages.map((tag) => (
                <option key={tag} value={tag}>{languageLabel(tag)}</option>
              ))}
            </select>
          </label>
          <p className={css.settingHint}>{tt('settings.descHint')}</p>
        </section>
        <section className={css.settingGroup}>
          <h3 className={css.settingGroupTitle}>{tt('settings.data')}</h3>
          <dl className={css.settingList}>
            <dt>{tt('settings.mapFile')}</dt>
            <dd title={mapPath}>{mapPath}</dd>
            {languages.length === 0
              ? (
                  <Fragment>
                    <dt>{tt('settings.cache')}</dt>
                    <dd>{tt('settings.noCache')}</dd>
                  </Fragment>
                )
              : languages.map((tag) => (
                  <Fragment key={tag}>
                    <dt>{tt('settings.cacheFile', { language: languageLabel(tag) })}</dt>
                    <dd title={`${dir}descriptions.${tag}.json`}>{`descriptions.${tag}.json`}</dd>
                  </Fragment>
                ))}
          </dl>
        </section>
      </div>
    </div>
  )
}

/**
 * One skill row: the name with a one-sentence summary beside it at rest. On hover
 * (or while a search is filtering) the summary gives way to the skill's origin
 * and the fuller description.
 */
function SkillRow({
  skill,
  description,
  summary,
  origin,
  dragging,
  reveal,
  onCopy,
  onDragSkill,
}: {
  skill: string
  description: string | undefined
  /** One-sentence summary shown beside the name at rest; hidden while the row is open. */
  summary: string | undefined
  /** Origin line ("Project · dsh-skill-map"), shown while the row is open. */
  origin: string | undefined
  dragging: boolean
  /** True while a search is filtering: the row shows its description without hover. */
  reveal: boolean
  onCopy: (skill: string) => void
  onDragSkill: (skill: string | undefined) => void
}): React.JSX.Element {
  return (
    <div
      className={css.skill}
      data-dsh-part="skill"
      data-dragging={dragging}
      data-reveal={reveal}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', skill)
        event.dataTransfer.effectAllowed = 'move'
        onDragSkill(skill)
      }}
      onDragEnd={() => { onDragSkill(undefined) }}
      onClick={() => { onCopy(skill) }}
    >
      <span className={css.skillHead}>
        <span className={css.skillName} title={skill}>{skill}</span>
        {summary !== undefined && <span className={css.skillSummary}>{summary}</span>}
      </span>
      {origin !== undefined && <span className={css.skillOrigin}>{origin}</span>}
      {description !== undefined && <span className={css.skillDesc} title={description}>{description}</span>}
    </div>
  )
}

/** One category row: caret, name, count, actions, plus its members when open. */
function CategoryRow({
  category,
  depth,
  expanded,
  renaming,
  draft,
  over,
  dragging,
  describe,
  summarize,
  originOf,
  onToggle,
  onDraft,
  onCommitRename,
  onStartRename,
  onRemove,
  onCopySkill,
  onDragSkill,
  query,
  dragHandlers,
}: {
  category: MapCategory
  depth: number
  expanded: boolean
  renaming: boolean
  draft: string
  over: boolean
  dragging: string | undefined
  describe: (name: string) => string | undefined
  summarize: (name: string) => string | undefined
  originOf: (name: string) => string | undefined
  onToggle: () => void
  onDraft: (value: string) => void
  onCommitRename: () => void
  onStartRename: () => void
  onRemove: () => void
  onCopySkill: (skill: string) => void
  onDragSkill: (skill: string | undefined) => void
  query: string
  dragHandlers: {
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
    onDragEnd: () => void
  }
}): React.JSX.Element {
  const members = category.skills.filter((skill) => matchesSkill(skill, describe(skill), query))
  const open = query !== '' ? members.length > 0 : expanded

  return (
    <section className={css.category} data-dsh-part="category" data-category={category.id}>
      <div
        className={css.categoryRow}
        data-depth={depth}
        data-over={over}
        draggable={query === ''}
        {...dragHandlers}
      >
        <button
          type="button"
          className={css.caret}
          aria-expanded={open}
          aria-label={category.name}
          onClick={onToggle}
        >
          <CaretIcon open={open} />
        </button>
        {renaming ? (
          <input
            className={css.nameInput}
            value={draft}
            autoFocus
            spellCheck={false}
            placeholder={tt('category.namePlaceholder')}
            onChange={(event) => { onDraft(event.target.value) }}
            onBlur={onCommitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommitRename()
              if (event.key === 'Escape') onDraft(category.name)
            }}
          />
        ) : (
          <button
            type="button"
            className={css.categoryName}
            title={category.name}
            onClick={onToggle}
            onDoubleClick={onStartRename}
          >
            {category.name}
          </button>
        )}
        <span className={css.count}>{tt('list.count', { count: members.length })}</span>
        <span className={css.rowActions}>
          <button
            type="button"
            className={css.iconAction}
            title={tt('action.rename')}
            aria-label={tt('action.rename')}
            onClick={onStartRename}
          >
            <RenameIcon />
          </button>
          <button
            type="button"
            className={css.iconAction}
            title={tt('action.removeHint')}
            aria-label={tt('action.remove')}
            onClick={onRemove}
          >
            <RemoveIcon />
          </button>
        </span>
      </div>
      {open && members.map((skill) => (
        <SkillRow
          key={skill}
          skill={skill}
          description={describe(skill)}
          summary={summarize(skill)}
          origin={originOf(skill)}
          dragging={dragging === skill}
          reveal={query !== ''}
          onCopy={onCopySkill}
          onDragSkill={onDragSkill}
        />
      ))}
      {members.length === 0 && category.skills.length > 0 && (
        <p className={css.hint}>{tt('list.noMatch')}</p>
      )}
    </section>
  )
}

/** The skill map body (the host tab owns the pane around it). */
export function SkillMapPanel({ api }: SkillMapPanelProps): React.JSX.Element {
  const [map, setMap] = useState<LocalMap | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [overId, setOverId] = useState<string | undefined>(undefined)
  const [draggingSkill, setDraggingSkill] = useState<string | undefined>(undefined)
  const [language, setLanguage] = useState<string>(readStoredLanguage)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const loadSeq = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragCategory = useRef<string | undefined>(undefined)

  useEffect(() => {
    const seq = ++loadSeq.current
    void (async () => {
      try {
        const payload = await api.list()
        if (seq !== loadSeq.current) return
        setMap(toLocal(payload))
        setError(undefined)
      } catch (err) {
        if (seq !== loadSeq.current) return
        setError(tt('list.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
      }
    })()
  }, [api])

  useEffect(() => () => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
  }, [])

  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => { setNotice(undefined) }, NOTICE_MS)
    return () => { clearTimeout(timer) }
  }, [notice])

  /** Persist the whole map, debounced, keeping the panel responsive. */
  const persist = useCallback((next: LocalMap): void => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.save(toRequest(next))
        .then(() => { setNotice(undefined) })
        .catch((err: unknown) => {
          setNotice({ text: tt('save.failed', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' })
        })
    }, SAVE_DELAY_MS)
  }, [api])

  /** Apply one mutation locally and schedule its save. */
  const apply = useCallback((mutate: (current: LocalMap) => LocalMap): void => {
    setMap((current) => {
      if (current === undefined) return current
      const next = mutate(current)
      if (next === current) return current
      persist(next)
      return next
    })
  }, [persist])

  const trimmed = query.trim().toLowerCase()

  /** The description this row shows: the chosen language when it has a row, else the source. */
  const describe = useCallback((name: string): string | undefined => {
    if (map === undefined) return undefined
    if (language !== SOURCE_LANGUAGE) {
      const translated = map.translations[language]?.[name]
      if (translated !== undefined && translated !== '') return translated
    }
    return map.descriptions[name]
  }, [map, language])

  /** The one-sentence summary for a row; absent until the inventory carries one. */
  const summaryOf = useCallback((name: string): string | undefined => map?.summaries[name], [map])

  /** The row's origin line, already composed for the active language. */
  const originOf = useCallback((name: string): string | undefined => originLabel(map?.origins[name]), [map])

  const languages = useMemo(() => (map === undefined ? [] : Object.keys(map.translations).sort()), [map])

  // A cache file can disappear between loads; drop back to the source text
  // rather than leaving the picker on a value no option carries.
  useEffect(() => {
    if (language !== SOURCE_LANGUAGE && map !== undefined && map.translations[language] === undefined) {
      setLanguage(SOURCE_LANGUAGE)
    }
  }, [language, map])

  const chooseLanguage = useCallback((next: string): void => {
    storeLanguage(next)
    setLanguage(next)
  }, [])

  const visible = useMemo(() => {
    if (map === undefined) return undefined
    if (trimmed === '') return map.categories
    return map.categories.filter((category) =>
      category.skills.some((skill) => matchesSkill(skill, describe(skill), trimmed)))
  }, [map, trimmed, describe])

  const unassignedVisible = useMemo(() => {
    if (map === undefined) return []
    if (trimmed === '') return map.unassigned
    return map.unassigned.filter((skill) => matchesSkill(skill, describe(skill), trimmed))
  }, [map, trimmed, describe])

  const allOpen = map !== undefined
    && map.categories.length > 0
    && map.categories.every((category) => expanded[category.id] === true)

  const copySkill = useCallback((skill: string): void => {
    void copyText(invocationOf(skill)).then((ok) => {
      setNotice({
        text: ok
          ? tt('notice.copied', { name: invocationOf(skill) })
          : tt('notice.copyFailed', { name: invocationOf(skill) }),
        kind: ok ? 'ok' : 'error',
      })
    })
  }, [])

  const moveSkillTo = useCallback((skill: string, toId: string): void => {
    apply((current) => moveSkill(current, skill, toId))
  }, [apply])

  /**
   * Run one sync pass: the host asks the model for the copy every unwritten or
   * changed skill is missing, writes it beside the hand-written file, and this
   * reloads so the new lines render without a second click.
   */
  const runSync = useCallback((): void => {
    if (syncing) return
    setSyncing(true)
    setNotice(undefined)
    void api.sync()
      .then(async (result) => {
        const payload = await api.list()
        setMap(toLocal(payload))
        setNotice({
          text: result.updated === 0
            ? tt('notice.syncCurrent')
            : result.failed > 0
              ? tt('notice.syncPartial', { count: result.updated, failed: result.failed })
              : tt('notice.synced', { count: result.updated }),
          kind: result.failed > 0 ? 'error' : 'ok',
        })
      })
      .catch((error: unknown) => {
        setNotice({
          text: tt('notice.syncFailed', { error: error instanceof Error ? error.message : String(error) }),
          kind: 'error',
        })
      })
      .finally(() => { setSyncing(false) })
  }, [api, syncing])

  if (map === undefined) {
    return (
      <div className={css.pane} data-dsh-skillmap-view="" data-dsh-plugin="skill-map">
        <p className={css.status}>{error ?? tt('list.loading')}</p>
      </div>
    )
  }

  // The settings view replaces the list in place: the sidebar is too narrow for
  // a dialog, and the tab keeps its own chrome either way.
  if (settingsOpen) {
    return (
      <SettingsView
        language={language}
        languages={languages}
        mapPath={map.mapPath}
        onLanguage={chooseLanguage}
        onClose={() => { setSettingsOpen(false) }}
      />
    )
  }

  const total = map.total
  // Only what the update action can actually fill is surfaced: a skill with no
  // copy in either layer. The rest of the coverage record (changed, stale) stays
  // in the payload and the files, unrendered — the footer nudges one update click
  // instead of showing a to-do list the user has to read.
  const pendingCopy = map.copy?.missing.length ?? 0

  return (
    <div className={css.pane} data-dsh-skillmap-view="" data-dsh-plugin="skill-map">
      <header className={css.head} data-dsh-part="head">
        <span className={css.titleGroup}>
          <span className={css.title}>{tt('entry.label')}</span>
          <button
            type="button"
            className={css.titleAction}
            title={tt('settings.open')}
            aria-label={tt('settings.open')}
            onClick={() => { setSettingsOpen(true) }}
          >
            <GearIcon />
          </button>
        </span>
        <button
          type="button"
          className={css.ghostAction}
          onClick={() => {
            setExpanded(allOpen ? {} : Object.fromEntries(map.categories.map((category) => [category.id, true])))
          }}
        >
          {allOpen ? tt('action.collapseAll') : tt('action.expandAll')}
        </button>
        <button type="button" className={css.primaryAction} onClick={() => { setAdding(true) }}>
          {tt('action.newCategory')}
        </button>
        <button
          type="button"
          className={css.syncAction}
          disabled={syncing}
          title={tt('action.syncHint')}
          onClick={runSync}
        >
          <svg
            className={css.syncIcon}
            data-spinning={syncing}
            viewBox="0 0 16 16"
            width="13"
            height="13"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M13.4 2.4v2.8h-2.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {syncing ? tt('action.syncing') : tt('action.sync')}
        </button>
      </header>
      <div className={css.searchRow}>
        <input
          className={css.searchInput}
          type="text"
          value={query}
          spellCheck={false}
          placeholder={tt('search.placeholder')}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
        />
        {query !== '' && (
          <button type="button" className={css.searchClear} onClick={() => { setQuery('') }}>
            {tt('search.clear')}
          </button>
        )}
      </div>
      {error !== undefined && <p className={css.error}>{error}</p>}
      {map.complete !== true && <p className={css.hint}>{tt('list.incomplete')}</p>}
      <div className={css.list} data-dsh-part="list">
        {adding && (
          <div className={css.categoryRow}>
            <span className={css.caret} aria-hidden="true"><CaretIcon open /></span>
            <input
              className={css.nameInput}
              autoFocus
              spellCheck={false}
              placeholder={tt('category.namePlaceholder')}
              value={draft}
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const name = draft.trim() === '' ? tt('category.newName') : draft.trim()
                  apply((current) => ({
                    ...current,
                    categories: [...current.categories, { id: nextCategoryId(current.categories.map((c) => c.id)), name, skills: [] }],
                  }))
                  setDraft('')
                  setAdding(false)
                }
                if (event.key === 'Escape') { setDraft(''); setAdding(false) }
              }}
            />
          </div>
        )}
        {visible?.length === 0 && !adding && (
          <p className={css.status}>{trimmed === '' ? tt('list.empty') : tt('list.noMatch')}</p>
        )}
        {visible?.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            depth={0}
            expanded={expanded[category.id] === true}
            renaming={renamingId === category.id}
            draft={renamingId === category.id ? draft : category.name}
            over={overId === category.id}
            dragging={draggingSkill}
            describe={describe}
            summarize={summaryOf}
            originOf={originOf}
            query={trimmed}
            onToggle={() => { setExpanded((current) => ({ ...current, [category.id]: current[category.id] !== true })) }}
            onDraft={setDraft}
            onStartRename={() => { setRenamingId(category.id); setDraft(category.name) }}
            onCommitRename={() => {
              const name = draft.trim()
              if (name !== '' && name !== category.name) {
                apply((current) => ({
                  ...current,
                  categories: current.categories.map((entry) => entry.id === category.id ? { ...entry, name } : entry),
                }))
              }
              setRenamingId(undefined)
            }}
            onRemove={() => {
              apply((current) => ({
                ...current,
                categories: current.categories.filter((entry) => entry.id !== category.id),
                unassigned: [...current.unassigned, ...category.skills].sort((a, b) => a.localeCompare(b)),
              }))
            }}
            onCopySkill={copySkill}
            onDragSkill={setDraggingSkill}
            dragHandlers={{
              onDragStart: (event) => {
                dragCategory.current = category.id
                event.dataTransfer.setData('text/plain', '')
                event.dataTransfer.effectAllowed = 'move'
              },
              onDragOver: (event) => { event.preventDefault(); setOverId(category.id) },
              onDragLeave: () => { setOverId(undefined) },
              onDrop: (event) => {
                event.preventDefault()
                event.stopPropagation()
                setOverId(undefined)
                setDraggingSkill(undefined)
                // One drop target serves both gestures: a skill payload moves
                // that skill here, an empty payload reorders the dragged
                // category to this position.
                const skill = event.dataTransfer.getData('text/plain')
                if (skill !== '') {
                  dragCategory.current = undefined
                  moveSkillTo(skill, category.id)
                  return
                }
                const from = dragCategory.current
                dragCategory.current = undefined
                if (from !== undefined && from !== category.id) {
                  apply((current) => reorderCategories(current, from, category.id))
                }
              },
              onDragEnd: () => {
                dragCategory.current = undefined
                setOverId(undefined)
                setDraggingSkill(undefined)
              },
            }}
          />
        ))}
        <section className={css.category} data-dsh-part="category" data-category={UNASSIGNED}>
          <div
            className={css.categoryRow}
            data-unassigned="true"
            data-over={overId === UNASSIGNED}
            onDragOver={(event) => { event.preventDefault(); setOverId(UNASSIGNED) }}
            onDragLeave={() => { setOverId(undefined) }}
            onDrop={(event) => {
              event.preventDefault()
              setOverId(undefined)
              setDraggingSkill(undefined)
              const skill = event.dataTransfer.getData('text/plain')
              if (skill !== '') moveSkillTo(skill, UNASSIGNED)
            }}
          >
            <span className={css.caret} aria-hidden="true"> </span>
            <span className={css.categoryName} data-static="true">{tt('list.unassigned')}</span>
            <span className={css.count}>{tt('list.count', { count: unassignedVisible.length })}</span>
          </div>
          {unassignedVisible.map((skill) => (
            <SkillRow
              key={skill}
              skill={skill}
              description={describe(skill)}
              summary={summaryOf(skill)}
              origin={originOf(skill)}
              dragging={draggingSkill === skill}
              reveal={trimmed !== ''}
              onCopy={copySkill}
              onDragSkill={setDraggingSkill}
            />
          ))}
        </section>
      </div>
      <footer className={css.foot} data-dsh-part="footer">
        <span>{tt('footer.total', { total })}</span>
        {pendingCopy > 0 && (
          <button
            type="button"
            className={css.footAction}
            title={tt('copy.pendingHint')}
            disabled={syncing}
            onClick={runSync}
          >
            {tt('copy.pending', { count: pendingCopy })}
          </button>
        )}
        {notice !== undefined && <span className={css.notice} data-kind={notice.kind}>{notice.text}</span>}
      </footer>
    </div>
  )
}
