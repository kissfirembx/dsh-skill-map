/**
 * Skill map API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the trust fence on its side.
 */

import type { AutoResponse, MapPayload, SaveRequest, SaveResponse } from '../core/payload.ts'

/** Route paths mirrored from the host (src/routes.ts ROUTES). */
const API = {
  list: '/api/dsh-skill-map/list',
  save: '/api/dsh-skill-map/save',
  health: '/api/dsh-skill-map/health',
  sync: '/api/dsh-skill-map/sync',
  auto: '/api/dsh-skill-map/workspaces/auto',
} as const

/** Body of POST /api/dsh-skill-map/sync. */
export interface SyncResponse {
  ok: true
  /** Skills in the inventory the sync pass looked at. */
  total: number
  /** How many of them needed copy (no row at all, or a row whose skill changed). */
  targets: number
  /** Targets the model answered for. */
  updated: number
  /** Targets it skipped or answered unusably. */
  failed: number
}

/** Body of GET /api/dsh-skill-map/health. */
export interface HealthPayload {
  ok: true
  plugin: 'skill-map'
  skills: number
  workspaces: number
  mapPath: string
}

/** One thrown API error with the host-provided message. */
export class ApiError extends Error {}

/** Skill map API client. */
export class SkillMapApi {
  /** Fetch the map payload (categories with their members, plus the remainder). */
  async list(cwd?: string): Promise<MapPayload> {
    const url = typeof cwd === 'string' && cwd.trim() !== ''
      ? `${API.list}?cwd=${encodeURIComponent(cwd)}`
      : API.list
    return this.request<MapPayload>(url)
  }

  /** Persist the whole workspace document (every tab plus its placements). */
  async save(request: SaveRequest): Promise<SaveResponse> {
    return this.request<SaveResponse>(API.save, { method: 'POST', body: request })
  }

  /** Read the route-family health (skill and workspace counts, map file path). */
  async health(): Promise<HealthPayload> {
    return this.request<HealthPayload>(API.health)
  }

  /** Ask the host to write copy for every skill that needs it. */
  async sync(): Promise<SyncResponse> {
    return this.request<SyncResponse>(API.sync, { method: 'POST', body: {} })
  }

  /**
   * Ask the host to classify the inventory. With no workspace id it creates the
   * first workspace; with one it fills that blank tab.
   */
  async auto(workspaceId?: string): Promise<AutoResponse> {
    return this.request<AutoResponse>(API.auto, {
      method: 'POST',
      body: workspaceId === undefined ? {} : { workspaceId },
    })
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
      throw new ApiError(message)
    }
    return body as T
  }
}
