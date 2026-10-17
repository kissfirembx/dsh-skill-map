/**
 * Automatic copy generation for the skill map.
 *
 * The panel's sync action asks the host's `llm` service to write the Chinese
 * copy for every skill that has none yet, and for every skill whose description
 * changed under copy that already exists. Results land in `summaries.auto.json`
 * beside the hand-written `summaries.json`, which always wins — so a
 * machine-written line is a floor, never an override of something a person wrote.
 *
 * The service is reached structurally, the way the right sidebar service is: the
 * harness does not publish a typed plugin SDK for it, and this package only
 * depends on `@deepseek-ai/*` packages that exist on the registry. A profile
 * without the service degrades to "sync unavailable" rather than a broken route.
 */

import { fingerprint } from './core/fingerprint.ts'
import type { SkillSummaryEntry } from './core/payload.ts'

/** Structural face of the harness llm service. */
export interface LlmFace {
  stream(options: LlmCallOptions): AsyncIterable<LlmChunk> | Promise<AsyncIterable<LlmChunk>>
}

/** One model call, mirroring the shape the harness's own one-shot callers use. */
export interface LlmCallOptions {
  provider: string
  model: string
  system?: string
  messages: readonly LlmMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** One message in that call. */
export interface LlmMessage {
  role: 'user' | 'system'
  content: Array<{ type: 'text'; text: string }>
  source?: { kind: 'user' }
}

/** One streamed delta. */
export interface LlmChunk {
  type?: string
  text?: string
}

/** A skill the sync pass has to write copy for. */
export interface SyncTarget {
  name: string
  /** The description the panel currently serves for it. */
  description: string
}

/** What one sync pass produced. */
export interface SyncOutcome {
  /** The auto entries after the pass (existing ones kept, stale ones dropped). */
  entries: Record<string, SkillSummaryEntry>
  /** Targets the model answered for. */
  updated: number
  /** Targets the model skipped or answered unusably. */
  failed: number
}

/** How long one sync call may take before the host gives up on the model. */
export const SYNC_TIMEOUT_MS = 120_000

/** Longest brief accepted from the model, in characters. */
const BRIEF_LIMIT = 24

/** Longest detail accepted, in characters. */
const DETAIL_LIMIT = 160

const SYSTEM_PROMPT = [
  '你在给一个 skill 管理面板写中文文案，读者是中文母语者，可能完全不懂技术。',
  '只回复一个 JSON 对象，不要有别的文字、不要用代码块包裹。格式：',
  '{"<skill 名>": {"brief": "...", "detail": "..."}}',
  '每个 skill 写两行：',
  '- brief：不超过 15 个字，说清它做什么。不要写「什么时候用它」，不要用「用于」「适用于」开头。',
  '- detail：40 到 70 个字，用大白话讲清它帮你做什么。假设读者是小学三年级的学生：',
  '  不要用专业术语（OCR、ADR、issue、token、结构化 这类词都要换成人话），',
  '  不要提「skill」「工具」「插件」这类词，直接说它能帮你干什么。',
  '把你写的每个 skill 名都原样用作 JSON 的键。',
].join('\n')

/** Trim a model-provided field to a single bounded line. */
function line(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '') return undefined
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** The first JSON object in a model reply, parsed; undefined when unusable. */
export function extractJsonObject(reply: string): Record<string, unknown> | undefined {
  const cleaned = reply.replace(/```[a-z]*\s*/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const doc: unknown = JSON.parse(cleaned.slice(start, end + 1))
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined
    return doc as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The user turn: every target with the description the model has to compress. */
function targetPrompt(targets: readonly SyncTarget[]): string {
  const blocks = targets.map((target) => `- ${target.name}\n  ${target.description}`)
  return ['要写的 skill：', ...blocks].join('\n')
}

/** Read one model reply into entries, keeping only fields the target list asked for. */
export function readDraft(
  reply: string,
  targets: readonly SyncTarget[],
): Record<string, SkillSummaryEntry> {
  const doc = extractJsonObject(reply)
  if (doc === undefined) return {}
  const out: Record<string, SkillSummaryEntry> = {}
  for (const target of targets) {
    const value = doc[target.name]
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const brief = line((value as { brief?: unknown }).brief, BRIEF_LIMIT)
    const detail = line((value as { detail?: unknown }).detail, DETAIL_LIMIT)
    if (brief === undefined && detail === undefined) continue
    out[target.name] = {
      ...(brief !== undefined ? { brief } : {}),
      ...(detail !== undefined ? { detail } : {}),
      // Record what the model was looking at, so the next pass only reports a
      // change when the skill itself changed again.
      from: fingerprint(target.description),
    }
  }
  return out
}

/** Ask the model for every target at once. */
async function requestDraft(options: {
  llm: LlmFace
  provider: string
  model: string
  targets: readonly SyncTarget[]
}): Promise<Record<string, SkillSummaryEntry>> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, SYNC_TIMEOUT_MS)
  try {
    const stream = await options.llm.stream({
      provider: options.provider,
      model: options.model,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: targetPrompt(options.targets) }],
        source: { kind: 'user' },
      }],
      signal: controller.signal,
    })
    let reply = ''
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
    }
    return readDraft(reply, options.targets)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run one sync pass.
 *
 * Targets are the skills with no copy at all plus the skills whose recorded
 * fingerprint no longer matches; everything else is left alone. Auto entries for
 * skills that are gone are dropped, and entries for skills that did not need a
 * rewrite are kept — so a pass that fails halfway leaves the file consistent.
 * @param options - targets, the llm service, its route, the existing auto file, and a logger.
 * @returns the next auto file contents plus per-target counts.
 * @throws when the llm service is missing or the call fails.
 */
export async function syncCopy(options: {
  targets: readonly SyncTarget[]
  llm: LlmFace | undefined
  provider: string
  model: string
  existing: Record<string, SkillSummaryEntry>
  live: ReadonlySet<string>
  logger: { warn(error: unknown): void }
}): Promise<SyncOutcome> {
  const { targets, llm, provider, model, existing, live } = options
  if (llm === undefined) throw new Error('the llm service is not available in this profile')
  if (provider === '' || model === '') throw new Error('no model route is configured for the sync action')

  // Keep what the previous passes produced for skills that still exist; drop the
  // rest, so the file cannot accumulate rows for uninstalled skills.
  const entries: Record<string, SkillSummaryEntry> = {}
  for (const [name, entry] of Object.entries(existing)) {
    if (live.has(name)) entries[name] = entry
  }

  if (targets.length === 0) return { entries, updated: 0, failed: 0 }

  try {
    const draft = await requestDraft({ llm, provider, model, targets })
    // An empty answer for a non-empty target list is a failure, not "nothing to
    // do". Reporting it keeps the panel from claiming everything is current while
    // the footer still lists the missing copy.
    if (Object.keys(draft).length === 0) {
      throw new Error(`the model route ${provider}/${model} returned no usable copy`)
    }
    let updated = 0
    for (const [name, entry] of Object.entries(draft)) {
      entries[name] = entry
      updated += 1
    }
    return { entries, updated, failed: targets.length - updated }
  } catch (error) {
    options.logger.warn(error)
    throw error
  }
}
