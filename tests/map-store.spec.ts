import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
  mapPath,
  parseMapState,
  readMapState,
  sanitizeSave,
  writeMapState,
} from '../src/map-store.ts'
import { MAP_VERSION } from '../src/core/payload.ts'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempMapPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-map-'))
  tempDirs.push(dir)
  return join(dir, 'skill-map', 'map.json')
}

describe('mapPath', () => {
  it('lives under the dsh home, never inside a skill root', () => {
    expect(mapPath('C:\\home\\.dsh')).toBe(join('C:\\home\\.dsh', 'skill-map', 'map.json'))
  })
})

describe('parseMapState', () => {
  it('reads a well-formed map', () => {
    const parsed = parseMapState(JSON.stringify({ version: 1, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } }))
    expect(parsed).toEqual({ version: MAP_VERSION, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } })
  })

  it('reports an unusable top-level shape instead of throwing', () => {
    expect(parseMapState('not json')).toBeUndefined()
    expect(parseMapState('[]')).toBeUndefined()
    expect(parseMapState('null')).toBeUndefined()
    expect(parseMapState('{"assignments":{}}')).toBeUndefined()
  })

  it('keeps an empty category list as a valid map', () => {
    expect(parseMapState('{"categories":[]}')).toEqual({ version: MAP_VERSION, categories: [], assignments: {} })
  })

  it('drops malformed categories, duplicate ids and dangling placements', () => {
    const parsed = parseMapState(JSON.stringify({
      categories: [
        { id: 'ok', name: 'Ok' },
        { id: 'ok', name: 'Duplicate' },
        { id: 'bad id', name: 'Bad' },
        { id: 'noname', name: '   ' },
        { id: 'toolong', name: 'x'.repeat(MAX_CATEGORY_NAME + 1) },
        'not an object',
      ],
      assignments: { alpha: 'ok', beta: 'missing', 'Bad Name': 'ok', gamma: 42 },
    }))
    expect(parsed?.categories).toEqual([{ id: 'ok', name: 'Ok' }])
    expect(parsed?.assignments).toEqual({ alpha: 'ok' })
  })
})

describe('sanitizeSave', () => {
  const known = new Set(['alpha', 'beta'])

  it('accepts a well-formed request', () => {
    const result = sanitizeSave({ categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' } }, known)
    expect(result?.state).toEqual({ version: MAP_VERSION, categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' } })
    expect(result?.dropped).toBe(0)
  })

  it('rejects a malformed request instead of writing it', () => {
    expect(sanitizeSave(null, known)).toBeUndefined()
    expect(sanitizeSave({}, known)).toBeUndefined()
    expect(sanitizeSave({ categories: [], assignments: [] }, known)).toBeUndefined()
    expect(sanitizeSave({ categories: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], assignments: {} }, known)).toBeUndefined()
    expect(sanitizeSave({ categories: [{ id: 'bad id', name: 'A' }], assignments: {} }, known)).toBeUndefined()
    expect(sanitizeSave({ categories: [{ id: 'a', name: '' }], assignments: {} }, known)).toBeUndefined()
    expect(sanitizeSave({ categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'missing' } }, known)).toBeUndefined()
    expect(sanitizeSave({ categories: Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => ({ id: `c${i}`, name: 'x' })), assignments: {} }, known)).toBeUndefined()
  })

  it('drops placements for skills the host no longer serves and counts them', () => {
    const result = sanitizeSave({
      categories: [{ id: 'c1', name: 'One' }],
      assignments: { alpha: 'c1', removed: 'c1', 'Bad Name': 'c1' },
    }, known)
    expect(result?.state.assignments).toEqual({ alpha: 'c1' })
    expect(result?.dropped).toBe(2)
  })

  it('trims category names', () => {
    const result = sanitizeSave({ categories: [{ id: 'c1', name: '  One  ' }], assignments: {} }, known)
    expect(result?.state.categories).toEqual([{ id: 'c1', name: 'One' }])
  })
})

describe('readMapState / writeMapState', () => {
  it('seeds a fresh map when the file is missing', async () => {
    const path = await tempMapPath()
    const { state, seeded } = await readMapState(path)
    expect(seeded).toBe(true)
    expect(state.categories.length).toBeGreaterThan(0)
  })

  it('seeds again when the file is unreadable', async () => {
    const path = await tempMapPath()
    await writeMapState(path, { version: MAP_VERSION, categories: [], assignments: {} })
    await writeFile(path, '{"categories":[', 'utf8')
    const { state, seeded } = await readMapState(path)
    expect(seeded).toBe(true)
    expect(state.categories.length).toBeGreaterThan(0)
  })

  it('round-trips through disk and leaves no temp file behind', async () => {
    const path = await tempMapPath()
    const state = { version: MAP_VERSION, categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' } }
    await writeMapState(path, state)
    const { state: read, seeded } = await readMapState(path)
    expect(seeded).toBe(false)
    expect(read).toEqual(state)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: MAP_VERSION })
    const siblings = await readdir(join(path, '..'))
    expect(siblings.filter((name) => name.includes('.tmp-'))).toEqual([])
  })
})
