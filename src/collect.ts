/**
 * Skill inventory for the skill map.
 *
 * One filesystem pass over the official skill-root conventions (project, user,
 * custom) plus a registry supplement for the entries only the provider knows
 * about (bundled, runtime-registered). Read-only by construction: this module
 * never writes into a skill root, it only reads SKILL.md frontmatter.
 *
 * The web profile mounts the skill-filesystem provider at the agent-preset
 * scope layer, so the host plane cannot read project/user skills from
 * ctx.skills — the scan is the primary source and the registry fills in the
 * bundled entries.
 */

import { existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'

/** Display copy for each source level (the panel shows it as a badge/filter). */
export interface SourceGroup {
  key: string
  title: string
  hint: string
}

/** Source levels produced by filesystem scanning (registry sources map onto the same set). */
export const SOURCE_GROUPS: SourceGroup[] = [
  { key: 'bundled', title: 'System bundled', hint: 'Global skills shipped with DSH and its plugins' },
  { key: 'project-dsh', title: 'Project skills (.dsh/skills)', hint: 'Located in the project directory, scoped to its workspace' },
  { key: 'project-agents', title: 'Project skills (.agents/skills)', hint: 'Located in the project directory, scoped to its workspace' },
  { key: 'custom', title: 'Custom directories', hint: 'customSkillDirs config' },
  { key: 'user-dsh', title: 'User skills (~/.dsh/skills)', hint: 'Global skills shared by all projects on this machine' },
  { key: 'user-agents', title: 'User skills (~/.agents/skills)', hint: 'Global skills shared by all projects on this machine' },
  { key: 'runtime', title: 'Runtime registered', hint: 'Skills registered at runtime by plugins' },
]

/** Registry source -> display level mapping. */
const REGISTRY_SOURCE_LEVEL: ReadonlyMap<string, string> = new Map(SOURCE_GROUPS.map((group) => [group.key, group.key]))

/**
 * Filesystem precedence across roots, matching the official rank order
 * (project wins over custom wins over user). Parallel scans finish in
 * arbitrary order, so the winner must be decided by priority comparison,
 * never by whichever readdir happened to resolve last.
 */
const LEVEL_PRIORITY: ReadonlyMap<string, number> = new Map([
  ['project-dsh', 0],
  ['project-agents', 1],
  ['custom', 2],
  ['user-dsh', 3],
  ['user-agents', 4],
])

/** One skill in the inventory. */
export interface SkillRecord {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  /** Source level (see SOURCE_GROUPS). */
  level: string
  /** Path of the SKILL.md when the skill came from the filesystem. */
  path?: string
  modelInvocable: boolean
  userInvocable: boolean
}

/** Registry snapshot entry shape (subset of ctx.skills entries). */
export interface RegistrySkill {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  source: string
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
}

/** Collection options. */
export interface CollectOptions {
  /** Registry snapshot workspace base. */
  cwd: string
  /** Extra project roots to scan (each scans .dsh/skills and .agents/skills). */
  projectRoots?: string[]
  /** Extra custom skill roots. */
  customSkillDirs?: string[]
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** ctx.skills registry (snapshot). */
  registry: { snapshot(options: { cwd: string }): Promise<{ skills: RegistrySkill[]; complete: boolean }> }
}

/** Result of one collection pass. */
export interface CollectResult {
  skills: SkillRecord[]
  complete: boolean
}

/** Find the nearest ancestor directory containing .git (cwd itself when none). */
export function findProjectRoot(cwd: string): string {
  let current = cwd
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/**
 * Scan one skill root, one level deep: `<name>/SKILL.md` or `<name>.md`.
 * Symlinked entries (junctions included) are followed like real entries — the
 * user's mount intent is the content being listed.
 */
async function scanSkillRoot(root: string, level: string, into: Map<string, SkillRecord>): Promise<void> {
  if (!existsSync(root)) return
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    let file: string
    if (entry.isDirectory()) {
      file = join(root, name, 'SKILL.md')
    } else if (entry.isSymbolicLink()) {
      const target = await stat(join(root, name)).catch(() => undefined)
      if (target === undefined) continue
      if (target.isDirectory()) file = join(root, name, 'SKILL.md')
      else if (target.isFile() && name.endsWith('.md')) file = join(root, name)
      else continue
    } else if (entry.isFile() && name.endsWith('.md')) {
      file = join(root, name)
    } else {
      continue
    }
    if (!existsSync(file)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(content)
    const skillName = parsed.name ?? name.replace(/\.md$/, '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) continue
    const existing = into.get(skillName)
    if (existing !== undefined) {
      const existingPriority = LEVEL_PRIORITY.get(existing.level) ?? 99
      const priority = LEVEL_PRIORITY.get(level) ?? 99
      if (existingPriority <= priority) continue
    }
    into.set(skillName, {
      name: skillName,
      description: parsed.description ?? '(no description)',
      whenToUse: parsed.whenToUse,
      provider: 'filesystem',
      level,
      path: file,
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
    })
  }
}

/** Serialise one registry entry (no path: the registry owns those files, not the map). */
function serializeRegistry(skill: RegistrySkill): SkillRecord {
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    provider: skill.provider,
    level: REGISTRY_SOURCE_LEVEL.get(skill.source) ?? `other:${skill.source}`,
    modelInvocable: skill.invocation?.modelInvocable ?? false,
    userInvocable: skill.invocation?.userInvocable ?? false,
  }
}

/**
 * Collect the inventory: filesystem scanning (primary) plus the registry
 * supplement. Filesystem entries win on name conflicts; the registry fills in
 * invocation flags and contributes bundled/runtime entries of its own.
 * @param options - collection options.
 * @returns the skills and whether the registry snapshot was complete.
 */
export async function collectSkills(options: CollectOptions): Promise<CollectResult> {
  const { cwd, customSkillDirs, dshHome, agentsHome, registry } = options
  const byName = new Map<string, SkillRecord>()
  const activeProjectRoot = findProjectRoot(cwd)
  const roots = new Set<string>(
    options.projectRoots !== undefined && options.projectRoots.length > 0
      ? [activeProjectRoot, ...options.projectRoots]
      : [activeProjectRoot],
  )
  const scanTasks: Array<Promise<void>> = []
  for (const root of roots) {
    scanTasks.push(scanSkillRoot(join(root, '.dsh', 'skills'), 'project-dsh', byName))
    scanTasks.push(scanSkillRoot(join(root, '.agents', 'skills'), 'project-agents', byName))
  }
  for (const dir of customSkillDirs ?? []) scanTasks.push(scanSkillRoot(dir, 'custom', byName))
  scanTasks.push(scanSkillRoot(join(dshHome, 'skills'), 'user-dsh', byName))
  scanTasks.push(scanSkillRoot(join(agentsHome, 'skills'), 'user-agents', byName))
  await Promise.all(scanTasks)

  const snapshotCwds = new Set<string>([cwd, ...roots])
  let complete = true
  for (const snapshotCwd of snapshotCwds) {
    try {
      const snapshot = await registry.snapshot({ cwd: snapshotCwd })
      if (snapshot.complete !== true) complete = false
      for (const skill of snapshot.skills) {
        const existing = byName.get(skill.name)
        const serialized = serializeRegistry(skill)
        if (existing === undefined) {
          byName.set(skill.name, serialized)
        } else {
          if (serialized.whenToUse !== undefined) existing.whenToUse = serialized.whenToUse
          if (serialized.provider !== undefined) existing.provider = serialized.provider
          existing.modelInvocable = serialized.modelInvocable
          existing.userInvocable = serialized.userInvocable
        }
      }
    } catch {
      // Registry unavailable: the filesystem result still stands.
      complete = false
    }
  }
  return { skills: [...byName.values()], complete }
}

/** Display name of a source level (falls back to the raw key). */
export function sourceTitle(level: string, groups: SourceGroup[] = SOURCE_GROUPS): string {
  return groups.find((group) => group.key === level)?.title ?? (level.startsWith('other:') ? level.slice(6) : level)
}

/** Project skill root convention (project root + .dsh/skills). */
export function projectSkillRoot(projectRoot: string): string {
  return `${projectRoot}${sep}.dsh${sep}skills`
}

/** Workspace display name. */
export function workspaceName(root: string): string {
  return basename(root) || root
}
