import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSkillSources } from '../src/skill-ledger.ts'

/**
 * The installer ledger is a user-owned file that can be absent, truncated or
 * reshaped. Every one of those costs the origin line, never the list, so each
 * failure shape is pinned here.
 */
describe('readSkillSources', () => {
  const dirs: string[] = []

  async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'skill-ledger-'))
    dirs.push(dir)
    return dir
  }

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('maps each skill to the repository it was installed from', async () => {
    const dir = await scratch()
    await writeFile(join(dir, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        dbs: { source: 'dontbesilent2025/dbskill', sourceType: 'github' },
        'code-review': { source: 'anthropics/skills' },
      },
    }))
    expect(await readSkillSources(dir)).toEqual({
      dbs: 'dontbesilent2025/dbskill',
      'code-review': 'anthropics/skills',
    })
  })

  it('returns an empty map when the ledger is absent', async () => {
    expect(await readSkillSources(await scratch())).toEqual({})
  })

  it('survives a truncated file', async () => {
    const dir = await scratch()
    await writeFile(join(dir, '.skill-lock.json'), '{ "skills": { "dbs":')
    expect(await readSkillSources(dir)).toEqual({})
  })

  it('drops entries without a usable source', async () => {
    const dir = await scratch()
    await writeFile(join(dir, '.skill-lock.json'), JSON.stringify({
      skills: { a: { source: '   ' }, b: { sourceType: 'github' }, c: null, d: { source: 'x/y' } },
    }))
    expect(await readSkillSources(dir)).toEqual({ d: 'x/y' })
  })

  it('ignores a ledger whose skills field is not an object', async () => {
    const dir = await scratch()
    await writeFile(join(dir, '.skill-lock.json'), JSON.stringify({ skills: ['a'] }))
    expect(await readSkillSources(dir)).toEqual({})
  })
})
