import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSkills, findProjectRoot, type CollectOptions, type RegistrySkill } from '../src/collect.ts'
import { makeTempDir, writeSkill } from './helpers.ts'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Fake ctx.skills registry. */
function registry(skills: RegistrySkill[] = [], complete = true): CollectOptions['registry'] {
  return { snapshot: async () => ({ skills, complete }) }
}

/** Build a project root (with .git so findProjectRoot stops there) plus a user home. */
async function fixture(): Promise<{ project: string; dshHome: string; agentsHome: string }> {
  const base = await makeTempDir()
  tempDirs.push(base)
  const project = join(base, 'project')
  const dshHome = join(base, 'home', '.dsh')
  const agentsHome = join(base, 'home', '.agents')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(dshHome, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  return { project, dshHome, agentsHome }
}

describe('findProjectRoot', () => {
  it('walks up to the nearest .git ancestor', async () => {
    const { project } = await fixture()
    const nested = join(project, 'a', 'b')
    await mkdir(nested, { recursive: true })
    expect(findProjectRoot(nested)).toBe(project)
  })
})

describe('collectSkills', () => {
  it('scans project and user roots and labels each source level', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    await writeSkill(join(project, '.dsh', 'skills'), 'alpha', { name: 'alpha', description: 'A' })
    await writeSkill(join(project, '.agents', 'skills'), 'beta', { name: 'beta', description: 'B' })
    await writeSkill(join(dshHome, 'skills'), 'gamma', { name: 'gamma', description: 'G' })
    await writeSkill(join(agentsHome, 'skills'), 'delta', { name: 'delta', description: 'D' })

    const { skills, complete } = await collectSkills({ cwd: project, dshHome, agentsHome, registry: registry() })
    const levels = Object.fromEntries(skills.map((entry) => [entry.name, entry.level]))
    expect(levels).toEqual({
      alpha: 'project-dsh',
      beta: 'project-agents',
      gamma: 'user-dsh',
      delta: 'user-agents',
    })
    expect(complete).toBe(true)
  })

  it('prefers the project copy on a name conflict', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    await writeSkill(join(project, '.dsh', 'skills'), 'shared', { name: 'shared', description: 'project copy' })
    await writeSkill(join(agentsHome, 'skills'), 'shared', { name: 'shared', description: 'user copy' })

    const { skills } = await collectSkills({ cwd: project, dshHome, agentsHome, registry: registry() })
    expect(skills.filter((entry) => entry.name === 'shared')).toHaveLength(1)
    expect(skills.find((entry) => entry.name === 'shared')?.description).toBe('project copy')
  })

  it('adds registry-only skills and fills invocation flags on scanned ones', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    await writeSkill(join(agentsHome, 'skills'), 'alpha', { name: 'alpha', description: 'filesystem copy' })

    const { skills } = await collectSkills({
      cwd: project,
      dshHome,
      agentsHome,
      registry: registry([
        { name: 'alpha', description: 'registry copy', source: 'user-agents', whenToUse: 'from registry', invocation: { modelInvocable: false, userInvocable: true } },
        { name: 'office-docx', description: 'bundled', source: 'bundled', invocation: { modelInvocable: true, userInvocable: true } },
      ]),
    })
    const alpha = skills.find((entry) => entry.name === 'alpha')
    expect(alpha?.description).toBe('filesystem copy')
    expect(alpha?.whenToUse).toBe('from registry')
    expect(alpha?.modelInvocable).toBe(false)
    const bundled = skills.find((entry) => entry.name === 'office-docx')
    expect(bundled?.level).toBe('bundled')
    expect(bundled?.path).toBeUndefined()
  })

  it('uses the frontmatter name and skips names that are not kebab-case', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    const root = join(agentsHome, 'skills')
    await writeSkill(root, 'directory-name', { name: 'real-name', description: 'D' })
    await writeSkill(root, 'BadName', { name: 'BadName', description: 'D' })

    const { skills } = await collectSkills({ cwd: project, dshHome, agentsHome, registry: registry() })
    const names = skills.map((entry) => entry.name)
    expect(names).toContain('real-name')
    expect(names).not.toContain('directory-name')
    expect(names).not.toContain('BadName')
  })

  it('reports an incomplete registry snapshot', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    const { complete } = await collectSkills({ cwd: project, dshHome, agentsHome, registry: registry([], false) })
    expect(complete).toBe(false)
  })

  it('survives a registry that throws', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    await writeSkill(join(agentsHome, 'skills'), 'alpha', { name: 'alpha', description: 'A' })
    const result = await collectSkills({
      cwd: project,
      dshHome,
      agentsHome,
      registry: { snapshot: async () => { throw new Error('registry down') } },
    })
    expect(result.complete).toBe(false)
    expect(result.skills.map((entry) => entry.name)).toEqual(['alpha'])
  })

  it('scans extra custom roots', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    const custom = join(project, 'custom-skills')
    await writeSkill(custom, 'custom-one', { name: 'custom-one', description: 'C' })

    const { skills } = await collectSkills({ cwd: project, dshHome, agentsHome, customSkillDirs: [custom], registry: registry() })
    expect(skills.find((entry) => entry.name === 'custom-one')?.level).toBe('custom')
  })

  it('ignores a missing root instead of failing', async () => {
    const { project, dshHome, agentsHome } = await fixture()
    const { skills } = await collectSkills({ cwd: project, dshHome, agentsHome, registry: registry() })
    expect(skills).toEqual([])
  })
})
