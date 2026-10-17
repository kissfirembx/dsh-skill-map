import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mapPath } from '../src/map-store.ts'
import { ROUTES, makeRoutes, type SkillMapRoutesDeps } from '../src/routes.ts'
import { fakeRequest, fakeResponse, makeTempDir, writeSkill } from './helpers.ts'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Fixture: two project skills plus an empty user home. */
async function fixture(llm?: SkillMapRoutesDeps['llm']): Promise<{ project: string; dshHome: string; agentsHome: string; routes: WebRoute[] }> {
  const base = await makeTempDir()
  tempDirs.push(base)
  const project = join(base, 'project')
  const dshHome = join(base, 'home', '.dsh')
  const agentsHome = join(base, 'home', '.agents')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  await writeSkill(join(project, '.dsh', 'skills'), 'alpha', { name: 'alpha', description: 'A' })
  await writeSkill(join(project, '.dsh', 'skills'), 'zeta', { name: 'zeta', description: 'Z' })

  const deps: SkillMapRoutesDeps = {
    dshHome,
    agentsHome,
    customSkillDirs: [],
    registry: { snapshot: async () => ({ skills: [], complete: true }) },
    activeSessionCwds: () => [project],
    ...(llm !== undefined ? { llm } : {}),
    logger: { warn: () => {} },
  }
  return { project, dshHome, agentsHome, routes: makeRoutes({} as Context, deps) }
}

/** Invoke one route by exact path. */
async function call(routes: WebRoute[], path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = routes.find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error(`route not registered: ${path}`)
  await (route.handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>)(req, res)
}

/** GET list for a workspace. */
async function list(routes: WebRoute[], project: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, captured } = fakeResponse()
  await call(routes, ROUTES.list, fakeRequest({ method: 'GET', url: `${ROUTES.list}?cwd=${encodeURIComponent(project)}` }), res)
  return { status: captured.status, body: captured.body as Record<string, unknown> }
}

describe('skill-map routes', () => {
  it('registers the documented paths', async () => {
    const { routes } = await fixture()
    expect(routes.map((route) => route.path).sort())
      .toEqual([ROUTES.list, ROUTES.save, ROUTES.health, ROUTES.sync].sort())
  })

  it('refuses a non-loopback client before reading any file', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.list, fakeRequest({ method: 'GET', url: ROUTES.list, remoteAddress: '10.0.0.7' }), res)
    expect(captured.status).toBe(403)
    expect(captured.body).toEqual({ error: 'forbidden: loopback-only' })
  })

  it('refuses a non-loopback Host header', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.list, fakeRequest({ method: 'GET', url: ROUTES.list, host: 'evil.example.com' }), res)
    expect(captured.status).toBe(403)
  })

  it('rejects the wrong method', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.list, fakeRequest({ method: 'POST', url: ROUTES.list }), res)
    expect(captured.status).toBe(405)
  })

  it('serves the inventory grouped by the seeded categories and materialises the map file', async () => {
    const { project, dshHome, routes } = await fixture()
    const { status, body } = await list(routes, project)
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(Array.isArray(body.categories)).toBe(true)
    expect((body.categories as unknown[]).length).toBeGreaterThan(0)
    // The shipped seed knows neither temp skill, so both land unassigned.
    expect(body.unassigned).toEqual(['alpha', 'zeta'])
    expect(body.mapPath).toBe(mapPath(dshHome))
    expect(existsSync(mapPath(dshHome))).toBe(true)
  })

  it('serves one compacted description per inventory skill', async () => {
    const { project, routes } = await fixture()
    const { body } = await list(routes, project)
    expect(body.descriptions).toEqual({ alpha: 'A', zeta: 'Z' })
  })

  it('serves the hand-written copy kept beside the map file', async () => {
    const { project, dshHome, routes } = await fixture()
    await mkdir(join(dshHome, 'skill-map'), { recursive: true })
    await writeFile(join(dshHome, 'skill-map', 'summaries.json'), JSON.stringify({
      alpha: { brief: '甲的一句话', detail: '甲的大白话说明。' },
    }), 'utf8')
    const { body } = await list(routes, project)
    // zeta has no row, so it keeps its own description for both lines.
    expect(body.summaries).toEqual({ alpha: '甲的一句话', zeta: 'Z' })
    expect(body.descriptions).toEqual({ alpha: '甲的大白话说明。', zeta: 'Z' })
  })

  it('reports copy coverage against the live inventory', async () => {
    const { project, dshHome, routes } = await fixture()
    await mkdir(join(dshHome, 'skill-map'), { recursive: true })
    await writeFile(join(dshHome, 'skill-map', 'summaries.json'), JSON.stringify({
      zeta: { brief: 'ζ' },
      gone: { brief: '已经删掉的 skill' },
    }), 'utf8')
    const { body } = await list(routes, project)
    // alpha is served but unwritten; `gone` is written but not served.
    const copy = body.copy as { missing: string[]; stale: string[]; changed: string[] }
    expect(copy.missing).toEqual(['alpha'])
    expect(copy.stale).toEqual(['gone'])
    expect(copy.changed).toEqual([])
  })

  it('writes auto copy for every skill that needs it', async () => {
    const reply = JSON.stringify({
      alpha: { brief: '甲的话', detail: '甲的大白话说明。' },
      zeta: { brief: 'ζ的话', detail: 'ζ的大白话说明。' },
    })
    const llm = {
      stream: () => (async function* () {
        yield { type: 'text-delta', text: reply }
      })(),
    }
    const { project, dshHome, routes } = await fixture(llm)
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.sync, fakeRequest({ method: 'POST', url: ROUTES.sync }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, total: 2, targets: 2, updated: 2, failed: 0 })

    const auto = JSON.parse(await readFile(join(dshHome, 'skill-map', 'summaries.auto.json'), 'utf8'))
    expect(auto.alpha.brief).toBe('甲的话')
    expect(auto.alpha.detail).toBe('甲的大白话说明。')
    // The recorded fingerprint is what keeps the next pass quiet.
    expect(typeof auto.alpha.from).toBe('string')

    // The list route serves them straight away, with no second sync needed.
    const after = await list(routes, project)
    expect(after.body.summaries).toMatchObject({ alpha: '甲的话' })
  })

  it('reports the sync action unavailable when the profile has no llm service', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.sync, fakeRequest({ method: 'POST', url: ROUTES.sync }), res)
    expect(captured.status).toBe(503)
    expect(String((captured.body as { error: string }).error)).toContain('llm service')
  })

  it('names the GitHub project each skill was installed from', async () => {
    const { project, agentsHome, routes } = await fixture()
    await writeFile(join(agentsHome, '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: { alpha: { source: 'dontbesilent2025/dbskill', sourceType: 'github' } },
    }), 'utf8')
    const { body } = await list(routes, project)
    // The fixture project directory is named "project", so both temp skills are
    // project-scoped; only alpha has a ledger row.
    expect(body.origins).toEqual({
      alpha: { level: 'project-dsh', project: 'project', repo: 'dontbesilent2025/dbskill' },
      zeta: { level: 'project-dsh', project: 'project' },
    })
  })

  it('still serves the list when the ledger is unreadable', async () => {
    const { project, agentsHome, routes } = await fixture()
    await writeFile(join(agentsHome, '.skill-lock.json'), 'not json at all', 'utf8')
    const { status, body } = await list(routes, project)
    expect(status).toBe(200)
    expect(body.origins).toEqual({
      alpha: { level: 'project-dsh', project: 'project' },
      zeta: { level: 'project-dsh', project: 'project' },
    })
  })

  it('serves the language caches kept beside the map file', async () => {
    const { project, dshHome, routes } = await fixture()
    await mkdir(join(dshHome, 'skill-map'), { recursive: true })
    await writeFile(join(dshHome, 'skill-map', 'descriptions.zh.json'), JSON.stringify({ alpha: '甲' }), 'utf8')
    const { body } = await list(routes, project)
    expect(body.translations).toEqual({ zh: { alpha: '甲' } })
  })

  it('keeps the user map the panel saved', async () => {
    const { project, dshHome, routes } = await fixture()
    await list(routes, project)
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.save, fakeRequest({
      method: 'POST',
      url: ROUTES.save,
      body: { categories: [{ id: 'mine', name: '我的分类' }], assignments: { alpha: 'mine' } },
    }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, dropped: 0 })

    const onDisk = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    expect(onDisk).toEqual({ version: 2, categories: [{ id: 'mine', name: '我的分类' }], assignments: { alpha: 'mine' } })

    const after = await list(routes, project)
    const categories = after.body.categories as Array<{ id: string; name: string; skills: string[] }>
    expect(categories).toEqual([{ id: 'mine', name: '我的分类', skills: ['alpha'] }])
    expect(after.body.unassigned).toEqual(['zeta'])
  })

  it('drops placements for skills the host does not serve and reports the count', async () => {
    const { project, routes } = await fixture()
    await list(routes, project)
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.save, fakeRequest({
      method: 'POST',
      url: ROUTES.save,
      body: { categories: [{ id: 'c1', name: 'One' }], assignments: { alpha: 'c1', ghost: 'c1' } },
    }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, dropped: 1 })
  })

  it('rejects a malformed map instead of writing it', async () => {
    const { project, dshHome, routes } = await fixture()
    await list(routes, project)
    const before = await readFile(mapPath(dshHome), 'utf8')
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.save, fakeRequest({ method: 'POST', url: ROUTES.save, body: { categories: 'nope' } }), res)
    expect(captured.status).toBe(400)
    expect(await readFile(mapPath(dshHome), 'utf8')).toBe(before)
  })

  it('rejects a body that is not JSON', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.save, fakeRequest({ method: 'POST', url: ROUTES.save }), res)
    expect(captured.status).toBe(400)
  })

  it('answers health with the inventory and category counts', async () => {
    const { project, routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.health, fakeRequest({ method: 'GET', url: `${ROUTES.health}?cwd=${encodeURIComponent(project)}` }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, plugin: 'skill-map', skills: 2 })
    expect((captured.body as { categories: number }).categories).toBeGreaterThan(0)
  })
})
