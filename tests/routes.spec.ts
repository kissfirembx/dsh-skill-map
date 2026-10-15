import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
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
async function fixture(): Promise<{ project: string; dshHome: string; routes: WebRoute[] }> {
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
    logger: { warn: () => {} },
  }
  return { project, dshHome, routes: makeRoutes({} as Context, deps) }
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
  it('registers the three documented paths', async () => {
    const { routes } = await fixture()
    expect(routes.map((route) => route.path).sort()).toEqual([ROUTES.list, ROUTES.save, ROUTES.health].sort())
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
