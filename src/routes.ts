/**
 * The /api/dsh-skill-map route family: list (the inventory plus every workspace
 * with its placements resolved), save (write the whole workspace document),
 * classify (build a workspace from the model or the built-in table) and health.
 *
 * Every route carries the shared trust fence (loopback by default; a live
 * paired-device cookie is an extra allow path when remote-web-ui is loaded).
 * The only file this plugin ever writes is its own map file under the DSH home
 * directory — skill roots stay read-only.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isSkillMapAllowed } from './access.ts'
import { classifySkills, seedClassification, type ClassifyCategory } from './classify.ts'
import { collectSkills, findProjectRoot, type CollectOptions } from './collect.ts'
import { fingerprint } from './core/fingerprint.ts'
import { assembleMap, compactDescription } from './core/map.ts'
import type { AutoResponse, MapCategoryRef, WorkspaceSave } from './core/payload.ts'
import { DEFAULT_WORKSPACE_NAME, MAX_WORKSPACES } from './core/payload.ts'
import { readTranslations } from './description-cache.ts'
import { readJsonBody, writeJson } from './http.ts'
import { MAX_CATEGORY_NAME, mapPath, readMapFile, sanitizeSave, writeMapFile } from './map-store.ts'
import { readSkillSources } from './skill-ledger.ts'
import { readSkillSummaries } from './skill-summaries.ts'
import { syncCopy, type LlmFace, type SyncTarget } from './sync.ts'

/** Route paths (the client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skill-map/list',
  save: '/api/dsh-skill-map/save',
  health: '/api/dsh-skill-map/health',
  sync: '/api/dsh-skill-map/sync',
  auto: '/api/dsh-skill-map/workspaces/auto',
} as const

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Next free `wN` workspace id, so ids stay readable in the file. */
export function nextWorkspaceId(existing: Iterable<string>): string {
  const taken = new Set(existing)
  let index = 1
  while (taken.has(`w${index}`)) index += 1
  return `w${index}`
}

/**
 * Turn a classification proposal into a stored workspace, keeping only skills the
 * inventory really serves and dropping categories nothing survived into.
 * @param id - workspace id.
 * @param name - workspace display name.
 * @param draft - proposed categories (model or built-in).
 * @param known - live skill names.
 * @returns the workspace plus how many skills it placed.
 */
export function buildWorkspace(
  id: string,
  name: string,
  draft: readonly ClassifyCategory[],
  known: ReadonlySet<string>,
): { workspace: WorkspaceSave; assigned: number } {
  const categories: WorkspaceSave['categories'] = []
  const assignments: Record<string, string> = {}
  for (const proposal of draft) {
    const categoryId = `c${categories.length + 1}`
    const members: string[] = []
    for (const skill of proposal.skills) {
      if (!known.has(skill) || assignments[skill] !== undefined) continue
      assignments[skill] = categoryId
      members.push(skill)
    }
    if (members.length === 0) continue
    categories.push({ id: categoryId, name: proposal.name.slice(0, MAX_CATEGORY_NAME) })
  }
  return { workspace: { id, name, categories, assignments }, assigned: Object.keys(assignments).length }
}

/**
 * Place proposed skills into categories the user already built, matching the
 * proposal's category name to the stored one exactly.
 *
 * Only skills the caller lists as pending can move, so a skill the user already
 * dragged somewhere is never taken by the model, and a proposal that invents a
 * category name is ignored.
 * @param draft - the model's categories.
 * @param categories - the workspace's stored categories (name to id).
 * @param pending - skills still unassigned that the pass may place.
 * @param existing - placements already in the workspace.
 * @returns the merged placements plus how many skills the pass added.
 */
export function assignToCategories(
  draft: readonly ClassifyCategory[],
  categories: readonly MapCategoryRef[],
  pending: ReadonlySet<string>,
  existing: Record<string, string>,
): { assignments: Record<string, string>; assigned: number } {
  const byName = new Map(categories.map((category) => [category.name, category.id]))
  const assignments: Record<string, string> = { ...existing }
  let assigned = 0
  for (const proposal of draft) {
    const id = byName.get(proposal.name)
    if (id === undefined) continue
    for (const skill of proposal.skills) {
      if (!pending.has(skill) || assignments[skill] !== undefined) continue
      assignments[skill] = id
      assigned += 1
    }
  }
  return { assignments, assigned }
}

/** Route family dependencies (tests inject fakes). */
export interface SkillMapRoutesDeps {
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** Extra custom skill roots from plugin config. */
  customSkillDirs: string[]
  /** ctx.skills registry (snapshot). */
  registry: CollectOptions['registry']
  /** Active session cwd list (project root base). */
  activeSessionCwds(): string[]
  /** Harness llm service, when the profile provides one; the sync action needs it. */
  llm?: LlmFace
  /** Model route for the sync action (`provider/model`); the fallback route is used when absent. */
  syncModel?: string
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/**
 * Last-resort model route, used only when neither the plugin config nor the
 * profile's agent-default-model reports one. The host prefers the profile's own
 * route: a hardcoded provider goes stale when the official one is renamed, and a
 * stale route makes model calls come back empty without an error.
 */
export const DEFAULT_SYNC_MODEL = 'deepseek-account/deepseek-flash'

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

/** Write the auto copy file atomically (tmp + rename), the way the map file is written. */
async function writeAutoCopy(file: string, entries: Record<string, unknown>): Promise<void> {
  // The store directory may not exist yet on a profile that never opened the panel.
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${Date.now().toString(36)}.tmp`
  await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * Build every /api/dsh-skill-map route (exact paths).
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param deps - dshHome/agentsHome/registry/sessions.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(ctx: Context, deps: SkillMapRoutesDeps): WebRoute[] {
  const { dshHome, agentsHome, customSkillDirs, registry, activeSessionCwds, logger } = deps
  const mapFile = mapPath(dshHome)

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isSkillMapAllowed(ctx, req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Active session cwd list (degraded to [] when sessions throw). */
  const safeSessionCwds = (): string[] => {
    try {
      return activeSessionCwds()
    } catch {
      return []
    }
  }

  /** Active session project roots (degraded to [] when sessions throw). */
  const sessionProjectRoots = (): string[] => {
    try {
      return safeSessionCwds().map((sessionCwd) => findProjectRoot(sessionCwd))
    } catch {
      return []
    }
  }

  /** Collect options shared by every handler. */
  const collectOptions = (cwd: string): CollectOptions => ({
    cwd,
    projectRoots: sessionProjectRoots(),
    customSkillDirs,
    dshHome,
    agentsHome,
    registry,
  })

  /** The workspace base the panel is showing. */
  const resolveCwd = (explicit?: string): string => explicit ?? safeSessionCwds()[0] ?? DEFAULT_CWD()

  return [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const cwd = resolveCwd(queryParam(url, 'cwd'))
          const { skills, complete } = await collectSkills(collectOptions(cwd))
          // A missing or unusable file is an empty document: the panel then shows
          // its first-run prompt instead of a classification nobody confirmed.
          const { file } = await readMapFile(mapFile)
          // Language caches are user-owned files beside the map; an unreadable
          // one costs a language, never the list.
          const translations = await readTranslations(dshHome).catch(() => ({}))
          // The installer ledger sits beside the agents skills root; a missing
          // or unreadable file costs the origin line, never the list.
          const sources = await readSkillSources(agentsHome).catch(() => ({}))
          // Copy lives beside the map file in two layers: what the user wrote, and
          // what the sync action generated under it. The hand-written file always
          // wins, and a skill in neither keeps its own description for both lines.
          const [hand, auto] = await Promise.all([
            readSkillSummaries(dshHome, 'hand'),
            readSkillSummaries(dshHome, 'auto'),
          ])
          const overrides = { ...auto, ...hand }
          writeJson(res, 200, assembleMap({
            cwd,
            complete,
            mapPath: mapFile,
            // The row's origin line reads level/project/provider, so those three
            // ride along; path and the invocation flags stay host-side.
            skills: skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              level: skill.level,
              ...(skill.project !== undefined ? { project: skill.project } : {}),
              ...(skill.provider !== undefined ? { provider: skill.provider } : {}),
            })),
            workspaces: file.workspaces,
            sources,
            overrides,
            translations,
          }))
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.save,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 256 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          // Placements are validated against a fresh inventory pass, so a
          // request can only ever describe skills this host really serves.
          const { skills } = await collectSkills(collectOptions(resolveCwd()))
          const sanitized = sanitizeSave(body, new Set(skills.map((skill) => skill.name)))
          if (sanitized === undefined) {
            writeJson(res, 400, { error: 'invalid map: expected { workspaces }' })
            return
          }
          await writeMapFile(mapFile, sanitized.file)
          writeJson(res, 200, { ok: true, mapPath: mapFile, dropped: sanitized.dropped })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const { skills } = await collectSkills(collectOptions(resolveCwd()))
          const { file } = await readMapFile(mapFile)
          writeJson(res, 200, {
            ok: true,
            plugin: 'skill-map',
            skills: skills.length,
            workspaces: file.workspaces.length,
            mapPath: mapFile,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.auto,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 16 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const requested = (body as { workspaceId?: unknown }).workspaceId
          if (requested !== undefined && (typeof requested !== 'string' || requested === '')) {
            writeJson(res, 400, { error: 'workspaceId must be a non-empty string' })
            return
          }
          const { file } = await readMapFile(mapFile)
          const target = requested === undefined
            ? undefined
            : file.workspaces.find((workspace) => workspace.id === requested)
          if (requested !== undefined && target === undefined) {
            writeJson(res, 404, { error: 'unknown workspace' })
            return
          }
          if (target === undefined && file.workspaces.length >= MAX_WORKSPACES) {
            writeJson(res, 409, { error: `at most ${MAX_WORKSPACES} workspaces are supported` })
            return
          }
          const { skills } = await collectSkills(collectOptions(resolveCwd()))
          if (skills.length === 0) {
            writeJson(res, 409, { error: 'no skills in the inventory' })
            return
          }

          // The pass only ever fills skills that are still unplaced: a skill the
          // user dragged somewhere is never moved by the model. With categories
          // already built, the model is confined to those categories; without
          // them it proposes a scheme of its own.
          const placed = target?.assignments ?? {}
          const pending = skills.filter((skill) => placed[skill.name] === undefined)
          if (pending.length === 0) {
            writeJson(res, 409, { error: 'every skill is already assigned' })
            return
          }
          const guided = target !== undefined && target.categories.length > 0
          const targets = pending.map((skill) => ({
            name: skill.name,
            description: compactDescription(skill.description),
          }))
          const known = new Set(targets.map((entry) => entry.name))
          const route = (deps.syncModel ?? DEFAULT_SYNC_MODEL).split('/')

          let source: AutoResponse['source'] = 'model'
          let warning: string | undefined
          let draft: ClassifyCategory[]
          try {
            draft = await classifySkills({
              targets,
              ...(guided && target !== undefined
                ? { categories: target.categories.map((category) => category.name) }
                : {}),
              llm: deps.llm,
              provider: route[0] ?? '',
              model: route.slice(1).join('/'),
            })
          } catch (error) {
            logger.warn(error)
            // The built-in table cannot answer "which of the user's categories
            // does this skill belong to", so a guided pass needs the model and
            // reports the failure instead of writing a guess.
            if (guided) {
              writeJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
              return
            }
            source = 'seed'
            warning = error instanceof Error ? error.message : String(error)
            draft = seedClassification()
          }

          const id = target?.id ?? nextWorkspaceId(file.workspaces.map((workspace) => workspace.id))
          const name = target?.name ?? DEFAULT_WORKSPACE_NAME
          const floor = Math.ceil(pending.length * 0.3)
          const mode: AutoResponse['mode'] = guided ? 'assign' : 'create'
          let workspace: WorkspaceSave
          let assigned: number

          if (guided && target !== undefined) {
            const result = assignToCategories(draft, target.categories, known, placed)
            if (result.assigned === 0 || result.assigned < floor) {
              writeJson(res, 502, {
                error: `the model placed only ${result.assigned} of ${pending.length} skills into your categories; nothing was written`,
              })
              return
            }
            workspace = { ...target, assignments: result.assignments }
            assigned = result.assigned
          } else {
            let built = buildWorkspace(id, name, draft, known)
            // A model answer that barely covers the inventory leaves a panel that
            // is worse than the shipped table: fall back rather than ship it.
            if (source === 'model' && built.assigned < floor) {
              source = 'seed'
              warning = 'the model classified too few skills'
              built = buildWorkspace(id, name, seedClassification(), known)
            }
            workspace = built.workspace
            assigned = built.assigned
          }

          const workspaces = target === undefined
            ? [...file.workspaces, workspace]
            : file.workspaces.map((entry) => entry.id === id ? workspace : entry)
          await writeMapFile(mapFile, { version: file.version, workspaces })

          const response: AutoResponse = {
            ok: true,
            workspaceId: id,
            name,
            mode,
            source,
            assigned,
            total: pending.length,
            ...(warning !== undefined ? { warning } : {}),
          }
          writeJson(res, 200, response)
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.sync,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const cwd = resolveCwd()
          const { skills } = await collectSkills(collectOptions(cwd))
          const [hand, auto] = await Promise.all([
            readSkillSummaries(dshHome, 'hand'),
            readSkillSummaries(dshHome, 'auto'),
          ])
          // The model compresses exactly what the list route serves, so the
          // fingerprint recorded here lines up with the one that route computes.
          const inventory: SyncTarget[] = skills.map((skill) => ({
            name: skill.name,
            description: compactDescription(skill.description),
          }))
          const live = new Set(inventory.map((entry) => entry.name))
          // A target is a skill with no copy at all, or one whose description no
          // longer matches the fingerprint its copy was written from.
          const targets = inventory.filter((entry) => {
            const override = hand[entry.name] ?? auto[entry.name]
            if (override === undefined) return true
            return override.from !== undefined && override.from !== '' && override.from !== fingerprint(entry.description)
          })
          const route = (deps.syncModel ?? DEFAULT_SYNC_MODEL).split('/')
          const outcome = await syncCopy({
            targets,
            llm: deps.llm,
            provider: route[0] ?? '',
            model: route.slice(1).join('/'),
            existing: auto,
            live,
            logger,
          })
          await writeAutoCopy(join(dshHome, 'skill-map', 'summaries.auto.json'), outcome.entries)
          writeJson(res, 200, {
            ok: true,
            total: inventory.length,
            targets: targets.length,
            updated: outcome.updated,
            failed: outcome.failed,
          })
        } catch (error) {
          logger.warn(error)
          const message = error instanceof Error ? error.message : String(error)
          // A missing model service is a profile fact, not a bad request.
          writeJson(res, message.includes('llm service') ? 503 : 500, { error: message })
        }
      },
    },
  ]
}
