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
import type { CopyCoverage, DescriptionTranslations, MapCategory, MapCategoryRef, MapPayload, MapWorkspace, SaveRequest, SkillOrigin } from '../core/payload.ts'
import { originLabel, tt } from './panel-helpers.ts'
import css from './skill-map-panel.module.css'

/** Panel props: the API client the panel loads and saves through. */
export interface SkillMapPanelProps {
  api: SkillMapApi
}

/** One workspace in the panel's editable shape: a complete classification of the inventory. */
export type LocalWorkspace = MapWorkspace

/** Placements only: the part of a workspace the pure helpers rewrite. */
export type Placements = Pick<LocalWorkspace, 'categories' | 'unassigned'>

/** Local, editable shape of the map document. */
interface LocalMap {
  /** The user's workspaces, in tab order. */
  workspaces: LocalWorkspace[]
  /** Every loaded skill, name-sorted; a new workspace starts with all of them unassigned. */
  skills: string[]
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
export const UNASSIGNED = '__unassigned__'

/** Save debounce: several quick edits become one write. */
const SAVE_DELAY_MS = 400

/** How long a copy confirmation stays on screen. */
const NOTICE_MS = 2600

/** Language value meaning "the description the skill's own SKILL.md carries". */
export const SOURCE_LANGUAGE = 'source'

/** localStorage key holding the description-language choice. */
export const LANGUAGE_STORAGE_KEY = 'dsh-skill-map:description-language'

/** localStorage key holding the workspace the panel opens on. */
export const WORKSPACE_STORAGE_KEY = 'dsh-skill-map:active-workspace'

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

/** The workspace the panel last opened, or undefined when it has no preference. */
export function readStoredWorkspace(): string | undefined {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKSPACE_STORAGE_KEY) : null
    return value !== null && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/** Persist the active workspace; a storage failure still leaves the session choice. */
export function storeWorkspace(id: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WORKSPACE_STORAGE_KEY, id)
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
    workspaces: payload.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      categories: workspace.categories.map((category) => ({ ...category, skills: [...category.skills] })),
      unassigned: [...workspace.unassigned],
    })),
    skills: [...payload.skills],
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

/** Local shape to the save request: one document with every workspace. */
export function toRequest(map: LocalMap): SaveRequest {
  return {
    workspaces: map.workspaces.map((workspace) => {
      const assignments: Record<string, string> = {}
      for (const category of workspace.categories) {
        for (const skill of category.skills) assignments[skill] = category.id
      }
      return {
        id: workspace.id,
        name: workspace.name,
        categories: workspace.categories.map((category) => ({ id: category.id, name: category.name })),
        assignments,
      }
    }),
  }
}

/** First free generated category id, so ids stay readable in the file. */
export function nextCategoryId(existing: Iterable<string>): string {
  const taken = new Set(existing)
  let index = 1
  while (taken.has(`c${index}`)) index += 1
  return `c${index}`
}

/** First free generated workspace id. */
export function nextWorkspaceId(existing: Iterable<string>): string {
  const taken = new Set(existing)
  let index = 1
  while (taken.has(`w${index}`)) index += 1
  return `w${index}`
}

/** A blank workspace: every loaded skill starts in the unassigned bucket. */
export function newWorkspace(id: string, name: string, skills: readonly string[]): LocalWorkspace {
  return {
    id,
    name,
    categories: [],
    unassigned: skills.slice().sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * Apply one mutation to one workspace, leaving the other tabs untouched.
 * @returns the same map when the id names no workspace, so renderers can skip work.
 */
export function updateWorkspace(
  map: LocalMap,
  id: string,
  mutate: (workspace: LocalWorkspace) => LocalWorkspace,
): LocalMap {
  const index = map.workspaces.findIndex((workspace) => workspace.id === id)
  if (index < 0) return map
  const current = map.workspaces[index]!
  const next = mutate(current)
  if (next === current) return map
  const workspaces = [...map.workspaces]
  workspaces[index] = next
  return { ...map, workspaces }
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
export function moveSkill(map: Placements, skill: string, toId: string): Placements {
  const categories = map.categories.map((category) => ({
    ...category,
    skills: category.skills.filter((name) => name !== skill),
  }))
  if (toId === UNASSIGNED) {
    return {
      categories,
      unassigned: [...map.unassigned.filter((name) => name !== skill), skill].sort((a, b) => a.localeCompare(b)),
    }
  }
  const target = categories.find((category) => category.id === toId)
  if (target === undefined) return map
  target.skills = [...target.skills, skill].sort((a, b) => a.localeCompare(b))
  return {
    categories,
    unassigned: map.unassigned.filter((name) => name !== skill),
  }
}

/**
 * Delete one category, returning its members to the unassigned bucket. Deleting
 * a category never deletes skills: the members are file placements, and the file
 * only stores placements that name a category that exists.
 */
export function removeCategory(map: Placements, id: string): Placements {
  const category = map.categories.find((entry) => entry.id === id)
  if (category === undefined) return map
  return {
    categories: map.categories.filter((entry) => entry.id !== id),
    unassigned: [...map.unassigned, ...category.skills].sort((a, b) => a.localeCompare(b)),
  }
}

/** Reorder one category to another's position. */
function reorderCategories(map: Placements, fromId: string, toId: string): Placements {
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

/** Close glyph for a workspace tab. */
function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Plus glyph for the new-workspace tab. */
function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
 * One skill row: the name with a one-sentence summary beside it at rest. Opening
 * the row (hover, keyboard focus, or an active search) swaps the summary for the
 * skill's origin and its fuller description; while it is open, a category picker
 * sits under the description, so re-filing a skill never requires dragging it
 * across a collapsed list. The picker belongs to the open state only — a row at
 * rest stays one line, and a search that merely reveals the description does not
 * unfold the picker.
 */
function SkillRow({
  skill,
  description,
  summary,
  origin,
  categoryId,
  categories,
  dragging,
  reveal,
  onCopy,
  onDragSkill,
  onPickCategory,
}: {
  skill: string
  description: string | undefined
  /** One-sentence summary shown beside the name at rest; hidden while the row is open. */
  summary: string | undefined
  /** Origin line ("Project · dsh-skill-map"), shown while the row is open. */
  origin: string | undefined
  /** The category the row is filed under right now; UNASSIGNED for the remainder bucket. */
  categoryId: string
  /** Every placement the picker offers, in the user's category order. */
  categories: readonly MapCategoryRef[]
  dragging: boolean
  /** True while a search is filtering: the row shows its description without hover. */
  reveal: boolean
  onCopy: (skill: string) => void
  onDragSkill: (skill: string | undefined) => void
  onPickCategory: (skill: string, categoryId: string) => void
}): React.JSX.Element {
  // A mousedown on the picker must not start dragging the row: the dropdown would
  // never open. The flag is per row, so a drag from anywhere else still works.
  const pickerDown = useRef(false)
  return (
    <div
      className={css.skill}
      data-dsh-part="skill"
      data-dragging={dragging}
      data-reveal={reveal}
      draggable
      onMouseDown={(event) => {
        pickerDown.current = (event.target as HTMLElement | null)?.closest('select') !== null
      }}
      onDragStart={(event) => {
        if (pickerDown.current) {
          event.preventDefault()
          return
        }
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
      <span className={css.skillActions} onClick={(event) => { event.stopPropagation() }}>
        <label className={css.skillCategory}>
          {tt('skill.category')}
          <select
            className={css.skillCategorySelect}
            value={categoryId}
            onChange={(event) => { onPickCategory(skill, event.target.value) }}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
            <option value={UNASSIGNED}>{tt('list.unassigned')}</option>
          </select>
        </label>
      </span>
    </div>
  )
}

/** One category row: caret, name, count, actions, plus its members when open. */
function CategoryRow({
  category,
  depth,
  expanded,
  renaming,
  confirming,
  draft,
  over,
  dragging,
  describe,
  summarize,
  originOf,
  categories,
  onToggle,
  onDraft,
  onCommitRename,
  onStartRename,
  onAskRemove,
  onCancelRemove,
  onRemove,
  onCopySkill,
  onDragSkill,
  onPickCategory,
  query,
  dragHandlers,
}: {
  category: MapCategory
  depth: number
  expanded: boolean
  renaming: boolean
  /** True while the delete bar is open for this category. */
  confirming: boolean
  draft: string
  over: boolean
  dragging: string | undefined
  describe: (name: string) => string | undefined
  summarize: (name: string) => string | undefined
  originOf: (name: string) => string | undefined
  /** Every category, so each member row can offer the placement picker. */
  categories: readonly MapCategoryRef[]
  onToggle: () => void
  onDraft: (value: string) => void
  onCommitRename: () => void
  onStartRename: () => void
  /** Arm the delete confirmation; nothing is removed yet. */
  onAskRemove: () => void
  /** Disarm it. */
  onCancelRemove: () => void
  /** Remove the category for real. */
  onRemove: () => void
  onCopySkill: (skill: string) => void
  onDragSkill: (skill: string | undefined) => void
  onPickCategory: (skill: string, categoryId: string) => void
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
            onClick={onAskRemove}
          >
            <RemoveIcon />
          </button>
        </span>
      </div>
      {confirming && (
        <div className={css.confirmBar} data-dsh-part="remove-confirm">
          <span className={css.confirmText}>
            {tt('remove.confirmText', { name: category.name, count: category.skills.length })}
          </span>
          <button
            type="button"
            className={css.confirmDelete}
            onClick={onRemove}
          >
            {tt('action.removeConfirm')}
          </button>
          <button
            type="button"
            className={css.confirmCancel}
            onClick={onCancelRemove}
          >
            {tt('action.cancel')}
          </button>
        </div>
      )}
      {open && members.map((skill) => (
        <SkillRow
          key={skill}
          skill={skill}
          description={describe(skill)}
          summary={summarize(skill)}
          origin={originOf(skill)}
          categoryId={category.id}
          categories={categories}
          dragging={dragging === skill}
          reveal={query !== ''}
          onCopy={onCopySkill}
          onDragSkill={onDragSkill}
          onPickCategory={onPickCategory}
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
  const [activeId, setActiveId] = useState<string | undefined>(readStoredWorkspace)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [unassignedOpen, setUnassignedOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [overId, setOverId] = useState<string | undefined>(undefined)
  const [draggingSkill, setDraggingSkill] = useState<string | undefined>(undefined)
  const [language, setLanguage] = useState<string>(readStoredLanguage)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [renamingWsId, setRenamingWsId] = useState<string | undefined>(undefined)
  const [wsDraft, setWsDraft] = useState('')
  const [pendingDeleteWs, setPendingDeleteWs] = useState<string | undefined>(undefined)
  const loadSeq = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragCategory = useRef<string | undefined>(undefined)

  /**
   * Adopt a freshly loaded payload, keeping the currently open workspace when it
   * still exists and falling back to the first one (or to none) when it does not.
   */
  const adopt = useCallback((payload: MapPayload, preferred?: string): void => {
    const next = toLocal(payload)
    setMap(next)
    const ids = new Set(next.workspaces.map((workspace) => workspace.id))
    const pick = preferred !== undefined && ids.has(preferred) ? preferred : next.workspaces[0]?.id
    setActiveId(pick)
    if (pick !== undefined) storeWorkspace(pick)
  }, [])

  useEffect(() => {
    const seq = ++loadSeq.current
    void (async () => {
      try {
        const payload = await api.list()
        if (seq !== loadSeq.current) return
        adopt(payload, readStoredWorkspace())
        setError(undefined)
      } catch (err) {
        if (seq !== loadSeq.current) return
        setError(tt('list.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
      }
    })()
  }, [api, adopt])

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

  /** The workspace the panel is showing; undefined when the user has none yet. */
  const active = useMemo(() => {
    if (map === undefined) return undefined
    return map.workspaces.find((workspace) => workspace.id === activeId) ?? map.workspaces[0]
  }, [map, activeId])

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
    if (active === undefined) return undefined
    if (trimmed === '') return active.categories
    return active.categories.filter((category) =>
      category.skills.some((skill) => matchesSkill(skill, describe(skill), trimmed)))
  }, [active, trimmed, describe])

  const unassignedVisible = useMemo(() => {
    if (active === undefined) return []
    if (trimmed === '') return active.unassigned
    return active.unassigned.filter((skill) => matchesSkill(skill, describe(skill), trimmed))
  }, [active, trimmed, describe])

  // The unassigned bucket is a band pinned under the list: collapsed by default,
  // opened by the user, and forced open while a search is filtering so matches
  // there are not hidden behind a closed band.
  const unassignedExpanded = trimmed !== '' ? unassignedVisible.length > 0 : unassignedOpen

  const allOpen = active !== undefined
    && active.categories.length > 0
    && active.categories.every((category) => expanded[category.id] === true)
    && unassignedOpen

  // The guided-classify prompt belongs to exactly one state: the user has built
  // categories but placed nothing yet. Once a single skill is filed, it goes away.
  const showAssignHint = active !== undefined
    && active.categories.length > 0
    && active.unassigned.length > 0
    && active.categories.every((category) => category.skills.length === 0)

  /**
   * Apply one change to the workspace the panel is showing and schedule the
   * document save. The other tabs are carried through untouched.
   */
  const mutateActive = useCallback((mutate: (workspace: LocalWorkspace) => LocalWorkspace): void => {
    apply((current) => {
      const id = current.workspaces.some((workspace) => workspace.id === activeId)
        ? activeId
        : current.workspaces[0]?.id
      return id === undefined ? current : updateWorkspace(current, id, mutate)
    })
  }, [apply, activeId])

  const selectWorkspace = useCallback((id: string): void => {
    setActiveId(id)
    storeWorkspace(id)
    // Per-tab editing state must not leak into the next tab. Category ids are
    // only unique inside a workspace, so the expansion map is cleared too.
    setQuery('')
    setAdding(false)
    setConfirmingId(undefined)
    setPendingDeleteWs(undefined)
    setRenamingWsId(undefined)
    setExpanded({})
    setUnassignedOpen(false)
    setOverId(undefined)
  }, [])

  const createWorkspace = useCallback((): void => {
    if (map === undefined) return
    const id = nextWorkspaceId(map.workspaces.map((workspace) => workspace.id))
    const name = tt('workspace.defaultName', { index: map.workspaces.length + 1 })
    apply((current) => ({
      ...current,
      workspaces: [...current.workspaces, newWorkspace(id, name, current.skills)],
    }))
    selectWorkspace(id)
  }, [apply, map, selectWorkspace])

  const removeWorkspace = useCallback((id: string): void => {
    if (map === undefined) return
    const index = map.workspaces.findIndex((workspace) => workspace.id === id)
    const target = map.workspaces[index]
    apply((current) => ({ ...current, workspaces: current.workspaces.filter((workspace) => workspace.id !== id) }))
    setPendingDeleteWs(undefined)
    if (activeId === id) {
      const next = map.workspaces[index + 1] ?? map.workspaces[index - 1]
      if (next !== undefined) selectWorkspace(next.id)
      else setActiveId(undefined)
    }
    if (target !== undefined) {
      setNotice({ text: tt('notice.workspaceRemoved', { name: target.name }), kind: 'ok' })
    }
  }, [apply, activeId, map, selectWorkspace])

  /**
   * Ask the host to classify the inventory. With no workspace the host creates
   * the first one; with a blank tab it fills that tab; with categories the user
   * already built, it places skills into those and leaves anything already
   * placed alone. The model is tried first and the built-in table is the floor
   * for the "propose categories" path, so the button never dead-ends.
   */
  const classify = useCallback((workspaceId?: string): void => {
    if (classifying || map === undefined) return
    setClassifying(true)
    setNotice(undefined)
    // Persist first: a tab created a moment ago may still be sitting in the save
    // debounce, and the host cannot fill a workspace it has not seen yet.
    void api.save(toRequest(map))
      .then(() => api.auto(workspaceId))
      .then(async (result) => {
        const payload = await api.list()
        adopt(payload, result.workspaceId)
        setNotice({
          text: result.mode === 'assign'
            ? tt('notice.assigned', { count: result.assigned })
            : result.source === 'model'
              ? tt('notice.classified', { count: result.assigned })
              : tt('notice.classifiedSeed', { count: result.assigned }),
          kind: 'ok',
        })
      })
      .catch((error: unknown) => {
        setNotice({
          text: tt('notice.classifyFailed', { error: error instanceof Error ? error.message : String(error) }),
          kind: 'error',
        })
      })
      .finally(() => { setClassifying(false) })
  }, [adopt, api, classifying, map])

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
    mutateActive((workspace) => ({ ...workspace, ...moveSkill(workspace, skill, toId) }))
  }, [mutateActive])

  /**
   * Re-file a skill from the picker inside its open row. The target category may
   * be collapsed, so the footer names the destination instead of letting the row
   * vanish without a trace.
   */
  const pickCategory = useCallback((skill: string, toId: string): void => {
    mutateActive((workspace) => ({ ...workspace, ...moveSkill(workspace, skill, toId) }))
    const name = toId === UNASSIGNED
      ? tt('list.unassigned')
      : active?.categories.find((category) => category.id === toId)?.name
    if (name !== undefined && name !== '') {
      setNotice({ text: tt('notice.moved', { name }), kind: 'ok' })
    }
  }, [mutateActive, active])

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
        adopt(payload, activeId)
        setNotice({
          // "Nothing to do" is `targets === 0`; an update that wrote nothing while
          // targets existed is a failure, and saying "everything is current" there
          // would leave the footer's missing count unexplained.
          text: result.targets === 0
            ? tt('notice.syncCurrent')
            : result.updated === 0
              ? tt('notice.syncNothing', { failed: result.failed })
              : result.failed > 0
                ? tt('notice.syncPartial', { count: result.updated, failed: result.failed })
                : tt('notice.synced', { count: result.updated }),
          kind: result.failed > 0 || result.updated === 0 ? 'error' : 'ok',
        })
      })
      .catch((error: unknown) => {
        setNotice({
          text: tt('notice.syncFailed', { error: error instanceof Error ? error.message : String(error) }),
          kind: 'error',
        })
      })
      .finally(() => { setSyncing(false) })
  }, [adopt, activeId, api, syncing])

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
  const pendingWs = pendingDeleteWs === undefined
    ? undefined
    : map.workspaces.find((workspace) => workspace.id === pendingDeleteWs)

  /** Commit an inline tab rename; an empty name keeps the old one. */
  const commitWorkspaceRename = (): void => {
    const id = renamingWsId
    if (id === undefined) return
    const name = wsDraft.trim()
    if (name !== '') {
      apply((current) => updateWorkspace(current, id, (workspace) => ({ ...workspace, name })))
    }
    setRenamingWsId(undefined)
  }

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
        {active !== undefined && (
          <>
            <button
              type="button"
              className={css.ghostAction}
              onClick={() => {
                setExpanded(allOpen ? {} : Object.fromEntries(active.categories.map((category) => [category.id, true])))
                setUnassignedOpen(!allOpen)
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
          </>
        )}
      </header>
      {active === undefined ? (
        <div className={css.firstRun} data-dsh-part="first-run">
          <p className={css.firstRunTitle}>{tt('workspace.emptyTitle')}</p>
          <p className={css.firstRunBody}>{tt('workspace.emptyBody', { count: map.total })}</p>
          <div className={css.firstRunActions}>
            <button
              type="button"
              className={css.primaryAction}
              disabled={classifying || map.total === 0}
              onClick={() => { classify() }}
            >
              {classifying ? tt('workspace.classifying') : tt('workspace.auto')}
            </button>
            <button type="button" className={css.ghostAction} onClick={createWorkspace}>
              {tt('workspace.blank')}
            </button>
          </div>
          <p className={css.firstRunHint}>{tt('workspace.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className={css.workspaceTabs} data-dsh-part="workspaces">
            {map.workspaces.map((workspace) => (
              <div key={workspace.id} className={css.workspaceTabWrap} data-active={workspace.id === active.id}>
                {renamingWsId === workspace.id ? (
                  <input
                    className={css.workspaceInput}
                    autoFocus
                    spellCheck={false}
                    value={wsDraft}
                    placeholder={tt('workspace.namePlaceholder')}
                    onChange={(event) => { setWsDraft(event.target.value) }}
                    onBlur={commitWorkspaceRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitWorkspaceRename()
                      if (event.key === 'Escape') setRenamingWsId(undefined)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={css.workspaceTab}
                    title={workspace.name}
                    onClick={() => { selectWorkspace(workspace.id) }}
                    onDoubleClick={() => { setRenamingWsId(workspace.id); setWsDraft(workspace.name) }}
                  >
                    {workspace.name}
                  </button>
                )}
                <button
                  type="button"
                  className={css.workspaceClose}
                  title={tt('workspace.remove')}
                  aria-label={`${tt('workspace.remove')} ${workspace.name}`}
                  onClick={() => { setPendingDeleteWs(workspace.id) }}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={css.workspaceAdd}
              title={tt('workspace.addHint')}
              aria-label={tt('workspace.add')}
              onClick={createWorkspace}
            >
              <PlusIcon />
            </button>
          </div>
          {pendingWs !== undefined && (
            <div className={css.tabConfirm} data-dsh-part="workspace-remove-confirm">
              <span className={css.confirmText}>{tt('workspace.removeConfirm', { name: pendingWs.name })}</span>
              <button type="button" className={css.confirmDelete} onClick={() => { removeWorkspace(pendingWs.id) }}>
                {tt('action.removeConfirm')}
              </button>
              <button type="button" className={css.confirmCancel} onClick={() => { setPendingDeleteWs(undefined) }}>
                {tt('action.cancel')}
              </button>
            </div>
          )}
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
          {showAssignHint && (
            <div className={css.assignHint} data-dsh-part="assign-hint">
              <span className={css.assignHintText}>{tt('assign.hint', { count: active.unassigned.length })}</span>
              <button
                type="button"
                className={css.assignHintAction}
                disabled={classifying}
                onClick={() => { classify(active.id) }}
              >
                {classifying ? tt('workspace.classifying') : tt('assign.action')}
              </button>
            </div>
          )}
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
                      mutateActive((workspace) => ({
                        ...workspace,
                        categories: [
                          ...workspace.categories,
                          { id: nextCategoryId(workspace.categories.map((entry) => entry.id)), name, skills: [] },
                        ],
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
              active.categories.length === 0 && trimmed === '' && map.total > 0 ? (
                <div className={css.blankState} data-dsh-part="blank-workspace">
                  <p className={css.status}>{tt('workspace.blankHint')}</p>
                  <div className={css.blankActions}>
                    <button
                      type="button"
                      className={css.primaryAction}
                      disabled={classifying}
                      onClick={() => { classify(active.id) }}
                    >
                      {classifying ? tt('workspace.classifying') : tt('workspace.auto')}
                    </button>
                    <button type="button" className={css.ghostAction} onClick={() => { setAdding(true) }}>
                      {tt('action.newCategory')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={css.status}>{trimmed === '' ? tt('list.empty') : tt('list.noMatch')}</p>
              )
            )}
            {visible?.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                depth={0}
                expanded={expanded[category.id] === true}
                renaming={renamingId === category.id}
                confirming={confirmingId === category.id}
                draft={renamingId === category.id ? draft : category.name}
                over={overId === category.id}
                dragging={draggingSkill}
                describe={describe}
                summarize={summaryOf}
                originOf={originOf}
                categories={active.categories}
                query={trimmed}
                onToggle={() => { setExpanded((current) => ({ ...current, [category.id]: current[category.id] !== true })) }}
                onDraft={setDraft}
                onStartRename={() => { setRenamingId(category.id); setDraft(category.name) }}
                onCommitRename={() => {
                  const name = draft.trim()
                  if (name !== '' && name !== category.name) {
                    mutateActive((workspace) => ({
                      ...workspace,
                      categories: workspace.categories.map((entry) => entry.id === category.id ? { ...entry, name } : entry),
                    }))
                  }
                  setRenamingId(undefined)
                }}
                onAskRemove={() => { setConfirmingId(category.id) }}
                onCancelRemove={() => { setConfirmingId(undefined) }}
                onRemove={() => {
                  mutateActive((workspace) => ({ ...workspace, ...removeCategory(workspace, category.id) }))
                  setConfirmingId(undefined)
                  setNotice({ text: tt('notice.removed', { name: category.name }), kind: 'ok' })
                }}
                onCopySkill={copySkill}
                onDragSkill={setDraggingSkill}
                onPickCategory={pickCategory}
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
                      mutateActive((workspace) => ({ ...workspace, ...reorderCategories(workspace, from, category.id) }))
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
          </div>
          <section className={css.unassigned} data-dsh-part="unassigned">
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
              <button
                type="button"
                className={css.caret}
                aria-expanded={unassignedExpanded}
                aria-label={tt('list.unassigned')}
                onClick={() => { setUnassignedOpen((open) => !open) }}
              >
                <CaretIcon open={unassignedExpanded} />
              </button>
              <button
                type="button"
                className={css.categoryName}
                data-static="true"
                onClick={() => { setUnassignedOpen((open) => !open) }}
              >
                {tt('list.unassigned')}
              </button>
              <span className={css.count}>{tt('list.count', { count: unassignedVisible.length })}</span>
            </div>
            {unassignedExpanded && (
              <div className={css.unassignedBody}>
                {unassignedVisible.map((skill) => (
                  <SkillRow
                    key={skill}
                    skill={skill}
                    description={describe(skill)}
                    summary={summaryOf(skill)}
                    origin={originOf(skill)}
                    categoryId={UNASSIGNED}
                    categories={active.categories}
                    dragging={draggingSkill === skill}
                    reveal={trimmed !== ''}
                    onCopy={copySkill}
                    onDragSkill={setDraggingSkill}
                    onPickCategory={pickCategory}
                  />
                ))}
                {unassignedVisible.length === 0 && trimmed !== '' && (
                  <p className={css.hint}>{tt('list.noMatch')}</p>
                )}
              </div>
            )}
          </section>
        </>
      )}
      <footer className={css.foot} data-dsh-part="footer">
        <span>{tt('footer.total', { total })}</span>
        {pendingCopy > 0 && active !== undefined && (
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
