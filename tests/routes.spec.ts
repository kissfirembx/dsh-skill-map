import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mapPath } from '../src/map-store.ts'
import { ROUTES, makeRoutes, type SkillMapRoutesDeps } from '../src/routes.ts'
import { DEFAULT_WORKSPACE_NAME } from '../src/core/payload.ts'
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

/** A model stub that answers with one fixed reply. */
function llmReplying(reply: string): SkillMapRoutesDeps['llm'] {
  return {
    stream: () => (async function* () {
      yield { type: 'text-delta', text: reply }
    })(),
  }
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

/** POST one save body. */
async function save(routes: WebRoute[], body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, captured } = fakeResponse()
  await call(routes, ROUTES.save, fakeRequest({ method: 'POST', url: ROUTES.save, body }), res)
  return { status: captured.status, body: captured.body as Record<string, unknown> }
}

/** POST the auto-classify route. */
async function auto(routes: WebRoute[], body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, captured } = fakeResponse()
  await call(routes, ROUTES.auto, fakeRequest({ method: 'POST', url: ROUTES.auto, body }), res)
  return { status: captured.status, body: captured.body as Record<string, unknown> }
}

/** The workspaces array the list route served, narrowed for assertions. */
function workspacesOf(body: Record<string, unknown>): Array<{ id: string; name: string; categories: Array<{ id: string; name: string; skills: string[] }>; unassigned: string[] }> {
  return body.workspaces as Array<{ id: string; name: string; categories: Array<{ id: string; name: string; skills: string[] }>; unassigned: string[] }>
}

describe('skill-map routes', () => {
  it('registers the documented paths', async () => {
    const { routes } = await fixture()
    expect(routes.map((route) => route.path).sort())
      .toEqual([ROUTES.list, ROUTES.save, ROUTES.health, ROUTES.sync, ROUTES.auto].sort())
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

  it('serves an empty workspace list on a fresh home and writes no file', async () => {
    const { project, dshHome, routes } = await fixture()
    const { status, body } = await list(routes, project)
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.skills).toEqual(['alpha', 'zeta'])
    expect(body.workspaces).toEqual([])
    expect(body.mapPath).toBe(mapPath(dshHome))
    // The first workspace is created from the panel's confirm, never silently.
    expect(existsSync(mapPath(dshHome))).toBe(false)
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
    const { project, dshHome, routes } = await fixture(llmReplying(reply))
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

  it('reports a reply that carries no usable copy instead of claiming success', async () => {
    // A stale model route or a malformed reply used to look like "everything is
    // current": updated 0, failed N, HTTP 200. The route now fails outright so
    // the panel can say what happened.
    const { routes, dshHome } = await fixture(llmReplying('sorry, I cannot help with that'))
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.sync, fakeRequest({ method: 'POST', url: ROUTES.sync }), res)
    expect(captured.status).toBe(500)
    expect(String((captured.body as { error: string }).error)).toContain('no usable copy')
    // Nothing was written, so the next attempt still sees the same targets.
    expect(existsSync(join(dshHome, 'skill-map', 'summaries.auto.json'))).toBe(false)
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

  it('keeps the workspace document the panel saved', async () => {
    const { project, dshHome, routes } = await fixture()
    await list(routes, project)
    const { status, body } = await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '我的分类' }],
        assignments: { alpha: 'mine' },
      }],
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, dropped: 0 })

    const onDisk = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    expect(onDisk).toEqual({
      version: 3,
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '我的分类' }],
        assignments: { alpha: 'mine' },
      }],
    })

    const after = await list(routes, project)
    const shown = workspacesOf(after.body)[0]
    expect(shown?.categories).toEqual([{ id: 'mine', name: '我的分类', skills: ['alpha'] }])
    expect(shown?.unassigned).toEqual(['zeta'])
  })

  it('drops placements for skills the host does not serve and reports the count', async () => {
    const { routes } = await fixture()
    const { status, body } = await save(routes, {
      workspaces: [{
        id: 'w1',
        name: 'One',
        categories: [{ id: 'c1', name: 'One' }],
        assignments: { alpha: 'c1', ghost: 'c1' },
      }],
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, dropped: 1 })
  })

  it('rejects a malformed document instead of writing it', async () => {
    const { routes, dshHome } = await fixture()
    const path = mapPath(dshHome)
    const before = existsSync(path) ? await readFile(path, 'utf8') : undefined
    const { status } = await save(routes, { workspaces: 'nope' })
    expect(status).toBe(400)
    expect(existsSync(path) ? await readFile(path, 'utf8') : undefined).toBe(before)
  })

  it('rejects a body that is not JSON', async () => {
    const { routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.save, fakeRequest({ method: 'POST', url: ROUTES.save }), res)
    expect(captured.status).toBe(400)
  })

  it('answers health with the inventory and workspace counts', async () => {
    const { project, routes } = await fixture()
    const { res, captured } = fakeResponse()
    await call(routes, ROUTES.health, fakeRequest({ method: 'GET', url: `${ROUTES.health}?cwd=${encodeURIComponent(project)}` }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, plugin: 'skill-map', skills: 2, workspaces: 0 })
  })
})

describe('workspace classification', () => {
  const reply = JSON.stringify({
    categories: [
      { name: '甲类', skills: ['alpha', 'zeta'] },
      { name: '空类', skills: ['ghost'] },
    ],
  })

  it('creates the first workspace from the model and drops unknown skills', async () => {
    const { project, dshHome, routes } = await fixture(llmReplying(reply))
    const { status, body } = await auto(routes)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      workspaceId: 'w1',
      name: DEFAULT_WORKSPACE_NAME,
      mode: 'create',
      source: 'model',
      assigned: 2,
      total: 2,
    })

    const stored = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    expect(stored.workspaces).toEqual([{
      id: 'w1',
      name: DEFAULT_WORKSPACE_NAME,
      categories: [{ id: 'c1', name: '甲类' }],
      assignments: { alpha: 'c1', zeta: 'c1' },
    }])

    const after = await list(routes, project)
    expect(workspacesOf(after.body)).toHaveLength(1)
  })

  it('fills a blank workspace instead of adding another tab', async () => {
    const { routes, dshHome } = await fixture(llmReplying(reply))
    await save(routes, {
      workspaces: [{ id: 'w1', name: '空白', categories: [], assignments: {} }],
    })
    const { status, body } = await auto(routes, { workspaceId: 'w1' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ workspaceId: 'w1', name: '空白', mode: 'create', source: 'model' })
    const stored = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    expect(stored.workspaces).toHaveLength(1)
    expect(stored.workspaces[0].categories).toEqual([{ id: 'c1', name: '甲类' }])
  })

  it('places skills into categories the user already built', async () => {
    const guidedReply = JSON.stringify({
      categories: [
        { name: '甲类', skills: ['alpha'] },
        { name: '乙类', skills: ['zeta'] },
      ],
    })
    const { routes, dshHome } = await fixture(llmReplying(guidedReply))
    await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '甲类' }, { id: 'other', name: '乙类' }],
        assignments: {},
      }],
    })
    const { status, body } = await auto(routes, { workspaceId: 'w1' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ workspaceId: 'w1', mode: 'assign', source: 'model', assigned: 2 })

    const stored = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    // The user's categories and their ids survive untouched; only placements fill in.
    expect(stored.workspaces[0].categories).toEqual([{ id: 'mine', name: '甲类' }, { id: 'other', name: '乙类' }])
    expect(stored.workspaces[0].assignments).toEqual({ alpha: 'mine', zeta: 'other' })
  })

  it('never moves a skill the user already placed', async () => {
    // The model puts both skills in 乙类; alpha is already filed under 甲类 and stays.
    const guidedReply = JSON.stringify({
      categories: [{ name: '乙类', skills: ['alpha', 'zeta'] }],
    })
    const { routes, dshHome } = await fixture(llmReplying(guidedReply))
    await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '甲类' }, { id: 'other', name: '乙类' }],
        assignments: { alpha: 'mine' },
      }],
    })
    const { status, body } = await auto(routes, { workspaceId: 'w1' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ mode: 'assign', assigned: 1, total: 1 })
    const stored = JSON.parse(await readFile(mapPath(dshHome), 'utf8'))
    expect(stored.workspaces[0].assignments).toEqual({ alpha: 'mine', zeta: 'other' })
  })

  it('rejects a guided pass that places nothing, leaving the file untouched', async () => {
    // The model invents a category name instead of using the user's.
    const guidedReply = JSON.stringify({
      categories: [{ name: '模型自己想的', skills: ['alpha', 'zeta'] }],
    })
    const { routes, dshHome } = await fixture(llmReplying(guidedReply))
    await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '甲类' }],
        assignments: {},
      }],
    })
    const before = await readFile(mapPath(dshHome), 'utf8')
    const { status } = await auto(routes, { workspaceId: 'w1' })
    expect(status).toBe(502)
    expect(await readFile(mapPath(dshHome), 'utf8')).toBe(before)
  })

  it('needs the model when the user already built the categories', async () => {
    const { routes } = await fixture()
    await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'mine', name: '甲类' }],
        assignments: {},
      }],
    })
    const { status } = await auto(routes, { workspaceId: 'w1' })
    // The built-in table cannot answer "which of these categories", so it is not
    // silently substituted for a scheme the user designed.
    expect(status).toBe(503)
  })

  it('refuses when every skill is already placed', async () => {
    const { routes } = await fixture(llmReplying(reply))
    await save(routes, {
      workspaces: [{
        id: 'w1',
        name: '我的分类',
        categories: [{ id: 'c1', name: 'One' }],
        assignments: { alpha: 'c1', zeta: 'c1' },
      }],
    })
    const { status } = await auto(routes, { workspaceId: 'w1' })
    expect(status).toBe(409)
  })

  it('falls back to the built-in categories when the profile has no model', async () => {
    const { routes } = await fixture()
    const { status, body } = await auto(routes)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, source: 'seed', workspaceId: 'w1', mode: 'create' })
  })

  it('rejects an unknown workspace id', async () => {
    const { routes } = await fixture()
    expect((await auto(routes, { workspaceId: 'nope' })).status).toBe(404)
  })
})
