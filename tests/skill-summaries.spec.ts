import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSkillSummaries } from '../src/skill-summaries.ts'

/**
 * The hand-written copy is a user-owned file beside the map. A missing,
 * truncated or reshaped one falls back to the description, so every failure
 * shape has to resolve to an empty map rather than an exception.
 */
describe('readSkillSummaries', () => {
  const dirs: string[] = []

  async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'skill-summaries-'))
    dirs.push(dir)
    return dir
  }

  /** Write a file (an object is serialised; a string is written verbatim). */
  async function withFile(doc: unknown): Promise<string> {
    const dir = await scratch()
    await mkdir(join(dir, 'skill-map'), { recursive: true })
    await writeFile(join(dir, 'skill-map', 'summaries.json'), typeof doc === 'string' ? doc : JSON.stringify(doc), 'utf8')
    return dir
  }

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('reads both lines of an entry', async () => {
    const dir = await withFile({
      'agent-reach': { brief: '全网调研，按平台取内容', detail: '你想知道别人怎么看一件事。' },
    })
    expect(await readSkillSummaries(dir)).toEqual({
      'agent-reach': { brief: '全网调研，按平台取内容', detail: '你想知道别人怎么看一件事。' },
    })
  })

  it('reads the recorded fingerprint alongside the text', async () => {
    const dir = await withFile({ pdf: { brief: 'PDF', from: 'a1b2c3d4' } })
    expect(await readSkillSummaries(dir)).toEqual({ pdf: { brief: 'PDF', from: 'a1b2c3d4' } })
  })

  it('accepts a bare string as the brief-only shorthand', async () => {
    const dir = await withFile({ pdf: 'PDF 合并、拆分、加密码' })
    expect(await readSkillSummaries(dir)).toEqual({ pdf: { brief: 'PDF 合并、拆分、加密码' } })
  })

  it('accepts an entry that writes only the paragraph', async () => {
    const dir = await withFile({ pdf: { detail: '把几个 PDF 合成一个。' } })
    expect(await readSkillSummaries(dir)).toEqual({ pdf: { detail: '把几个 PDF 合成一个。' } })
  })

  it('folds multi-line values and drops blanks and non-strings', async () => {
    const dir = await withFile({
      a: '   ', b: 42, c: ['x'], d: 'keeps\nthis', e: { brief: '  ', detail: 'ok' },
    })
    expect(await readSkillSummaries(dir)).toEqual({ d: { brief: 'keeps this' }, e: { detail: 'ok' } })
  })

  it('returns an empty map when the file is absent', async () => {
    expect(await readSkillSummaries(await scratch())).toEqual({})
  })

  it('survives a truncated file', async () => {
    expect(await readSkillSummaries(await withFile('{ "xlsx":'))).toEqual({})
  })

  it('ignores a file that is not a JSON object', async () => {
    expect(await readSkillSummaries(await withFile(['a']))).toEqual({})
  })
})
