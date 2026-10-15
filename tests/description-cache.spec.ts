import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseTranslationFile, readTranslations, translationPath } from '../src/description-cache.ts'
import { makeTempDir } from './helpers.ts'

/**
 * Language caches are user-owned files, so both layers are forgiving: a broken
 * file, a bad name or a non-string row costs that file or row, never the list.
 */

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A DSH home carrying the given `skill-map/` files. */
async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await makeTempDir('dsh-skill-map-i18n-')
  tempDirs.push(home)
  await mkdir(join(home, 'skill-map'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'skill-map', name), content, 'utf8')
  }
  return home
}

describe('parseTranslationFile', () => {
  it('keeps skill-name rows with non-empty string values', () => {
    expect(parseTranslationFile('{"alpha":"甲","beta":"乙"}')).toEqual({ alpha: '甲', beta: '乙' })
  })

  it('trims values and drops blank ones', () => {
    expect(parseTranslationFile('{"alpha":"  甲  ","beta":"   "}')).toEqual({ alpha: '甲' })
  })

  it('drops keys that are not skill names', () => {
    expect(parseTranslationFile('{"Alpha":"甲","alpha":"甲"}')).toEqual({ alpha: '甲' })
  })

  it('drops non-string values', () => {
    expect(parseTranslationFile('{"alpha":1,"beta":null,"gamma":["x"]}')).toEqual({})
  })

  it('returns undefined for broken json or a non-object top level', () => {
    expect(parseTranslationFile('{')).toBeUndefined()
    expect(parseTranslationFile('[1,2]')).toBeUndefined()
    expect(parseTranslationFile('"x"')).toBeUndefined()
  })
})

describe('readTranslations', () => {
  it('reads one row set per language file, key-sorted', async () => {
    const home = await homeWith({
      'descriptions.zh.json': '{"alpha":"甲"}',
      'descriptions.zh-Hans.json': '{"alpha":"甲（简）"}',
      'descriptions.fr.json': '{"alpha":"un"}',
    })
    expect(await readTranslations(home)).toEqual({
      fr: { alpha: 'un' },
      zh: { alpha: '甲' },
      'zh-Hans': { alpha: '甲（简）' },
    })
  })

  it('ignores unrelated files, bad names, broken json and empty caches', async () => {
    const home = await homeWith({
      'map.json': '{"categories":[]}',
      'descriptions..json': '{"alpha":"甲"}',
      'descriptions.UPPER.json': '{"alpha":"甲"}',
      'descriptions.zh.json': 'not json',
      'descriptions.de.json': '{}',
    })
    expect(await readTranslations(home)).toEqual({})
  })

  it('returns nothing when the directory does not exist', async () => {
    const home = await makeTempDir('dsh-skill-map-none-')
    tempDirs.push(home)
    expect(await readTranslations(home)).toEqual({})
  })

  it('keeps the cache beside the map file', () => {
    expect(translationPath('C:\\home\\.dsh', 'zh')).toBe(join('C:\\home\\.dsh', 'skill-map', 'descriptions.zh.json'))
  })
})
