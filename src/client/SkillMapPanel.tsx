/**
 * Skill map panel: a compact, folder-like list over the loaded skills.
 *
 * The user owns the shape of this list. Categories are renamed, created,
 * deleted and reordered in place; skills are dragged between categories (or
 * onto Unassigned). Every mutation is persisted as one whole-map save, so the
 * file on disk and the panel can never drift.
 *
 * Display is deliberately flat: a category is a caret plus a name plus a count,
 * and its members are bare names. Collapsed by default.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkillMapApi } from './api.ts'
import type { MapCategory, MapPayload, SaveRequest } from '../core/payload.ts'
import { tt } from './panel-helpers.ts'
import css from './skill-map-panel.module.css'

/** Panel props: the API client the panel loads and saves through. */
export interface SkillMapPanelProps {
  api: SkillMapApi
}

/** Local, editable shape of the map. */
interface LocalMap {
  categories: MapCategory[]
  unassigned: string[]
  total: number
  mapPath: string
  complete: boolean
}

/** Drop target standing for the unassigned bucket. */
const UNASSIGNED = '__unassigned__'

/** Save debounce: several quick edits become one write. */
const SAVE_DELAY_MS = 400

/** Payload to local shape. */
function toLocal(payload: MapPayload): LocalMap {
  return {
    categories: payload.categories.map((category) => ({ ...category, skills: [...category.skills] })),
    unassigned: [...payload.unassigned],
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

/** One category row: caret, name, count, remove, plus its members when open. */
function CategoryRow({
  category,
  depth,
  expanded,
  renaming,
  draft,
  onToggle,
  onDraft,
  onCommitRename,
  onStartRename,
  onRemove,
  onMoveSkill,
  onCopySkill,
  query,
  dragHandlers,
}: {
  category: MapCategory
  depth: number
  expanded: boolean
  renaming: boolean
  draft: string
  onToggle: () => void
  onDraft: (value: string) => void
  onCommitRename: () => void
  onStartRename: () => void
  onRemove: () => void
  onMoveSkill: (skill: string, toId: string) => void
  onCopySkill: (skill: string) => void
  query: string
  dragHandlers: {
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
    onDragEnd: () => void
  }
}): React.JSX.Element {
  const members = query === ''
    ? category.skills
    : category.skills.filter((skill) => skill.toLowerCase().includes(query))
  const open = query !== '' ? members.length > 0 : expanded

  return (
    <section className={css.category} data-dsh-part="category" data-category={category.id}>
      <div
        className={css.categoryRow}
        data-depth={depth}
        draggable={query === ''}
        {...dragHandlers}
      >
        <button type="button" className={css.caret} aria-expanded={open} onClick={onToggle}>
          {open ? '-' : '+'}
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
        <button
          type="button"
          className={css.rowAction}
          title={tt('action.rename')}
          aria-label={tt('action.rename')}
          onClick={onStartRename}
        >
          {tt('action.rename')}
        </button>
        <button
          type="button"
          className={css.rowAction}
          title={tt('action.removeHint')}
          aria-label={tt('action.remove')}
          onClick={onRemove}
        >
          {tt('action.remove')}
        </button>
      </div>
      {open && members.map((skill) => (
        <div
          key={skill}
          className={css.skillRow}
          data-dsh-part="skill"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', skill)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => { onCopySkill(skill) }}
        >
          <span className={css.skillName}>{skill}</span>
        </div>
      ))}
      {!open && members.length === 0 && category.skills.length > 0 && (
        <p className={css.hint}>{tt('list.noMatch')}</p>
      )}
    </section>
  )
}

/** The skill map body (the host tab owns the pane around it). */
export function SkillMapPanel({ api }: SkillMapPanelProps): React.JSX.Element {
  const [map, setMap] = useState<LocalMap | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
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

  /** Persist the whole map, debounced, keeping the panel responsive. */
  const persist = useCallback((next: LocalMap): void => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.save(toRequest(next))
        .then(() => { setNotice(undefined) })
        .catch((err: unknown) => {
          setNotice(tt('save.failed', { error: err instanceof Error ? err.message : String(err) }))
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

  const visible = useMemo(() => {
    if (map === undefined) return undefined
    if (trimmed === '') return map.categories
    return map.categories.filter((category) => category.skills.some((skill) => skill.toLowerCase().includes(trimmed)))
  }, [map, trimmed])

  const unassignedVisible = useMemo(() => {
    if (map === undefined) return []
    if (trimmed === '') return map.unassigned
    return map.unassigned.filter((skill) => skill.toLowerCase().includes(trimmed))
  }, [map, trimmed])

  const copySkill = useCallback((skill: string): void => {
    void copyText(invocationOf(skill)).then((ok) => {
      setNotice(ok ? invocationOf(skill) : tt('save.failed', { error: invocationOf(skill) }))
    })
  }, [])

  const moveSkillTo = useCallback((skill: string, toId: string): void => {
    apply((current) => moveSkill(current, skill, toId))
  }, [apply])

  if (map === undefined) {
    return (
      <div className={css.pane} data-dsh-skillmap-view="" data-dsh-plugin="skill-map">
        <p className={css.status}>{error ?? tt('list.loading')}</p>
      </div>
    )
  }

  const total = map.total

  return (
    <div className={css.pane} data-dsh-skillmap-view="" data-dsh-plugin="skill-map">
      <header className={css.head} data-dsh-part="head">
        <span className={css.title}>{tt('entry.label')}</span>
        <button type="button" className={css.headAction} onClick={() => { setAdding(true) }}>
          {tt('action.newCategory')}
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
            <span className={css.caret} aria-hidden="true">+</span>
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
            onMoveSkill={moveSkillTo}
            onCopySkill={copySkill}
            dragHandlers={{
              onDragStart: (event) => {
                dragCategory.current = category.id
                event.dataTransfer.setData('text/plain', '')
                event.dataTransfer.effectAllowed = 'move'
              },
              onDragOver: (event) => { event.preventDefault() },
              onDrop: (event) => {
                event.preventDefault()
                event.stopPropagation()
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
              onDragEnd: () => { dragCategory.current = undefined },
            }}
          />
        ))}
        <section className={css.category} data-dsh-part="category" data-category={UNASSIGNED}>
          <div
            className={css.categoryRow}
            data-unassigned="true"
            onDragOver={(event) => { event.preventDefault() }}
            onDrop={(event) => {
              event.preventDefault()
              const skill = event.dataTransfer.getData('text/plain')
              if (skill !== '') moveSkillTo(skill, UNASSIGNED)
            }}
          >
            <span className={css.caret} aria-hidden="true"> </span>
            <span className={css.categoryName}>{tt('list.unassigned')}</span>
            <span className={css.count}>{tt('list.count', { count: unassignedVisible.length })}</span>
          </div>
          {unassignedVisible.map((skill) => (
            <div
              key={skill}
              className={css.skillRow}
              data-dsh-part="skill"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', skill)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => { copySkill(skill) }}
            >
              <span className={css.skillName}>{skill}</span>
            </div>
          ))}
        </section>
      </div>
      <footer className={css.foot} data-dsh-part="footer">
        <span>{tt('footer.total', { total })}</span>
        {notice !== undefined && <span className={css.notice}>{notice}</span>}
        <span className={css.footPath} title={map.mapPath}>{map.mapPath}</span>
      </footer>
    </div>
  )
}
