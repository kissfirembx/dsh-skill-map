/**
 * The /api/dsh-skill-map route family: list (inventory grouped by the user's
 * categories), save (write the whole user map) and health.
 *
 * Every route carries the shared trust fence (loopback by default; a live
 * paired-device cookie is an extra allow path when remote-web-ui is loaded).
 * The only file this plugin ever writes is its own map file under the DSH home
 * directory — skill roots stay read-only.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isSkillMapAllowed } from './access.ts'
import { collectSkills, findProjectRoot, type CollectOptions } from './collect.ts'
import { assembleMap } from './core/map.ts'
import { readTranslations } from './description-cache.ts'
import { readJsonBody, writeJson } from './http.ts'
import { mapPath, readMapState, sanitizeSave, writeMapState } from './map-store.ts'

/** Route paths (the client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skill-map/list',
  save: '/api/dsh-skill-map/save',
  health: '/api/dsh-skill-map/health',
} as const

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
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
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

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
          const { state, seeded } = await readMapState(mapFile)
          // A fresh map is materialised on first open so the file the panel
          // reports is always the file the user can edit by hand.
          if (seeded) await writeMapState(mapFile, state).catch((error: unknown) => { logger.warn(error) })
          // Language caches are user-owned files beside the map; an unreadable
          // one costs a language, never the list.
          const translations = await readTranslations(dshHome).catch(() => ({}))
          writeJson(res, 200, assembleMap({
            cwd,
            complete,
            mapPath: mapFile,
            skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
            state,
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
            writeJson(res, 400, { error: 'invalid map: expected { categories, assignments }' })
            return
          }
          await writeMapState(mapFile, sanitized.state)
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
          const { state } = await readMapState(mapFile)
          writeJson(res, 200, {
            ok: true,
            plugin: 'skill-map',
            skills: skills.length,
            categories: state.categories.length,
            mapPath: mapFile,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
