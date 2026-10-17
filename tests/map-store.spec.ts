import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
  mapPath,
  parseMapFile,
  parseMapState,
  readMapFile,
  sanitizeSave,
  writeMapFile,
} from '../src/map-store.ts'
import { DEFAULT_WORKSPACE_NAME, MAP_VERSION, MAX_WORKSPACES, MAX_WORKSPACE_NAME } from '../src/core/payload.ts'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempMapPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-map-'))
  tempDirs.push(dir)
  return join(dir, 'skill-map', 'map.json')
}

/** One well-formed workspace row. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'w1', name: '工作区一', categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' }, ...overrides }
}

describe('mapPath', () => {
  it('lives under the dsh home, never inside a skill root', () => {
    expect(mapPath('C:\\home\\.dsh')).toBe(join('C:\\home\\.dsh', 'skill-map', 'map.json'))
  })
})

describe('parseMapState (legacy shape)', () => {
  it('reads a well-formed single map', () => {
    const parsed = parseMapState(JSON.stringify({ version: 2, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } }))
    expect(parsed).toEqual({ version: 2, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } })
  })

  it('reports an unusable top-level shape instead of throwing', () => {
    expect(parseMapState('not json')).toBeUndefined()
    expect(parseMapState('[]')).toBeUndefined()
    expect(parseMapState('null')).toBeUndefined()
    expect(parseMapState('{"assignments":{}}')).toBeUndefined()
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

describe('parseMapFile', () => {
  it('reads a workspace document', () => {
    const parsed = parseMapFile(JSON.stringify({ version: 3, workspaces: [row()] }))
    expect(parsed?.legacy).toBe(false)
    expect(parsed?.file.workspaces).toEqual([{ id: 'w1', name: '工作区一', categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' } }])
  })

  it('accepts an empty document', () => {
    expect(parseMapFile('{"version":3,"workspaces":[]}')?.file.workspaces).toEqual([])
  })

  it('migrates a legacy single map into one workspace', () => {
    const parsed = parseMapFile(JSON.stringify({ version: 2, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } }))
    expect(parsed?.legacy).toBe(true)
    expect(parsed?.file.workspaces).toEqual([{
      id: 'w1',
      name: DEFAULT_WORKSPACE_NAME,
      categories: [{ id: 'a', name: 'A' }],
      assignments: { alpha: 'a' },
    }])
  })

  it('reports an unusable shape instead of throwing', () => {
    expect(parseMapFile('not json')).toBeUndefined()
    expect(parseMapFile('[]')).toBeUndefined()
    expect(parseMapFile('null')).toBeUndefined()
    expect(parseMapFile('{"version":3}')).toBeUndefined()
  })

  it('drops malformed workspace rows, duplicate ids and dangling placements', () => {
    const parsed = parseMapFile(JSON.stringify({
      workspaces: [
        row(),
        row({ name: 'Duplicate id' }),
        row({ id: 'bad id' }),
        row({ id: 'w2', name: '   ' }),
        row({ id: 'w3', name: 'x'.repeat(MAX_WORKSPACE_NAME + 1) }),
        row({ id: 'w4', assignments: { alpha: 'missing', 'Bad Name': 'c1', beta: 42 } }),
        'not an object',
      ],
    }))
    expect(parsed?.file.workspaces.map((workspace) => workspace.id)).toEqual(['w1', 'w4'])
    expect(parsed?.file.workspaces[1]?.assignments).toEqual({})
  })
})

describe('sanitizeSave', () => {
  const known = new Set(['alpha', 'beta'])

  it('accepts a well-formed document', () => {
    const result = sanitizeSave({ workspaces: [row()] }, known)
    expect(result?.file.version).toBe(MAP_VERSION)
    expect(result?.file.workspaces).toEqual([{ id: 'w1', name: '工作区一', categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1' } }])
    expect(result?.dropped).toBe(0)
  })

  it('accepts an empty workspace list (the user deleted every tab)', () => {
    expect(sanitizeSave({ workspaces: [] }, known)?.file.workspaces).toEqual([])
  })

  it('rejects a malformed document instead of writing it', () => {
    expect(sanitizeSave(null, known)).toBeUndefined()
    expect(sanitizeSave({}, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: 'nope' }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row({ id: 'bad id' })] }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row({ name: '' })] }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row(), row()] }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row({ categories: 'nope' })] }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row({ categories: [{ id: 'c1', name: 'A' }, { id: 'c1', name: 'B' }] })] }, known)).toBeUndefined()
    expect(sanitizeSave({ workspaces: [row({ assignments: { alpha: 'missing' } })] }, known)).toBeUndefined()
    expect(sanitizeSave({
      workspaces: [row({ categories: Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => ({ id: `c${i}`, name: 'x' })) })],
    }, known)).toBeUndefined()
    expect(sanitizeSave({
      workspaces: Array.from({ length: MAX_WORKSPACES + 1 }, (_, i) => row({ id: `w${i}` })),
    }, known)).toBeUndefined()
  })

  it('drops placements for skills the host no longer serves and counts them', () => {
    const result = sanitizeSave({
      workspaces: [row({ assignments: { alpha: 'c1', removed: 'c1', 'Bad Name': 'c1' } })],
    }, known)
    expect(result?.file.workspaces[0]?.assignments).toEqual({ alpha: 'c1' })
    expect(result?.dropped).toBe(2)
  })

  it('trims workspace and category names', () => {
    const result = sanitizeSave({
      workspaces: [row({ name: '  甲  ', categories: [{ id: 'c1', name: '  One  ' }] })],
    }, known)
    expect(result?.file.workspaces[0]?.name).toBe('甲')
    expect(result?.file.workspaces[0]?.categories).toEqual([{ id: 'c1', name: 'One' }])
  })
})

describe('readMapFile / writeMapFile', () => {
  it('treats a missing file as an empty document, not a seeded one', async () => {
    const path = await tempMapPath()
    const { file, migrated } = await readMapFile(path)
    expect(file.workspaces).toEqual([])
    expect(migrated).toBe(false)
  })

  it('reads a legacy file as one migrated workspace', async () => {
    const path = await tempMapPath()
    await writeMapFile(path, { version: MAP_VERSION, workspaces: [] })
    await writeFile(path, JSON.stringify({ version: 2, categories: [{ id: 'a', name: 'A' }], assignments: { alpha: 'a' } }), 'utf8')
    const { file, migrated } = await readMapFile(path)
    expect(migrated).toBe(true)
    expect(file.workspaces).toHaveLength(1)
    expect(file.workspaces[0]?.name).toBe(DEFAULT_WORKSPACE_NAME)
  })

  it('degrades an unreadable file to an empty document', async () => {
    const path = await tempMapPath()
    await writeMapFile(path, { version: MAP_VERSION, workspaces: [] })
    await writeFile(path, '{"workspaces":[', 'utf8')
    expect((await readMapFile(path)).file.workspaces).toEqual([])
  })

  it('round-trips through disk and leaves no temp file behind', async () => {
    const path = await tempMapPath()
    const file = { version: MAP_VERSION, workspaces: [{
      id: 'w1',
      name: 'One',
      categories: [{ id: 'c1', name: 'One' }],
      assignments: { alpha: 'c1' },
    }] }
    await writeMapFile(path, file)
    const { file: read, migrated } = await readMapFile(path)
    expect(migrated).toBe(false)
    expect(read).toEqual(file)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: MAP_VERSION })
    const siblings = await readdir(join(path, '..'))
    expect(siblings.filter((name) => name.includes('.tmp-'))).toEqual([])
  })
})
