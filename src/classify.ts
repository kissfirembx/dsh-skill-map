/**
 * First-run classification: turn the loaded inventory into a category scheme.
 *
 * The panel's empty state asks for this only when the user confirms it, so a
 * fresh install still opens blank. The model writes the scheme; the built-in
 * seed table is the floor used when the profile has no `llm` service, the call
 * fails, or the reply is unusable — the action must always end with a workspace,
 * never with a dead button.
 */

import { extractJsonObject, type LlmFace } from './sync.ts'
import { seedMapState } from './core/map.ts'

/** One skill offered to the classifier. */
export interface ClassifyTarget {
  name: string
  /** One compacted line, so the prompt stays bounded. */
  description: string
}

/** One proposed category: a display name and the skills the model put in it. */
export interface ClassifyCategory {
  name: string
  skills: string[]
}

/** Longest category name accepted from the model, in characters. */
const NAME_LIMIT = 40

/** How long one classification call may take before the host gives up. */
export const CLASSIFY_TIMEOUT_MS = 120_000

const SYSTEM_PROMPT = [
  '你在帮用户把他机器上已加载的 skill 分组成类别。',
  '下面是每个 skill 的名字和一句话说明。请按「用它来做什么」分组，不要按名字前缀或来源分。',
  '要求：',
  '- 分 6 到 14 个类别，类别名用中文，不超过 10 个字，按使用场景命名。',
  '- 不要用「其他」「杂项」「未分类」这种兜底类别。',
  '- 每个 skill 必须恰好出现在一个类别里，名字照抄，不要改写。',
  '只回复一个 JSON 对象，不要有别的文字、不要用代码块包裹。格式：',
  '{"categories":[{"name":"类别名","skills":["skill-名","skill-名"]}]}',
].join('\n')

/**
 * The guarded prompt: the user already built the categories, so the model's only
 * job is to place skills into them. Names must be copied verbatim — the host
 * matches them back to the stored category ids.
 */
const ASSIGN_PROMPT = [
  '你在帮用户把他机器上已加载的 skill 放进用户自己建好的分类里。',
  '下面是用户建好的分类名。你只能使用这些分类，名字必须原样照抄：',
  '不要新建分类，不要改名，不要用「其他」「杂项」之类的兜底类别。',
  '每个 skill 最多放进一个分类；实在判断不了的可以不放。名字照抄，不要改写。',
  '只回复一个 JSON 对象，不要有别的文字、不要用代码块包裹。格式：',
  '{"categories":[{"name":"分类名","skills":["skill-名","skill-名"]}]}',
].join('\n')

/** The user turn: one line per skill. */
function targetPrompt(targets: readonly ClassifyTarget[]): string {
  return ['要分类的 skill：', ...targets.map((target) => `- ${target.name} — ${target.description}`)].join('\n')
}

/** The user turn for the guarded mode: the existing categories first, then the skills. */
function assignPrompt(targets: readonly ClassifyTarget[], categories: readonly string[]): string {
  return [
    '已有的分类：',
    ...categories.map((category) => `- ${category}`),
    '',
    targetPrompt(targets),
  ].join('\n')
}

/**
 * Read one model reply into categories, keeping only the row shape the caller
 * validates further.
 * @param reply - raw streamed reply text.
 * @returns the proposed categories (possibly empty when the reply is unusable).
 */
export function readClassification(reply: string): ClassifyCategory[] {
  const doc = extractJsonObject(reply)
  if (doc === undefined || !Array.isArray(doc.categories)) return []
  const categories: ClassifyCategory[] = []
  for (const value of doc.categories) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const row = value as { name?: unknown; skills?: unknown }
    if (typeof row.name !== 'string') continue
    const name = row.name.replace(/\s+/g, ' ').trim()
    if (name === '' || name.length > NAME_LIMIT) continue
    if (!Array.isArray(row.skills)) continue
    const skills = row.skills.filter((skill): skill is string => typeof skill === 'string' && skill !== '')
    if (skills.length === 0) continue
    categories.push({ name, skills })
  }
  return categories
}

/**
 * Ask the profile's model to classify the inventory. With `categories`, the
 * model is told to place skills into those names only and to copy them verbatim.
 * @param options - targets, optional existing category names, the llm service, its route.
 * @returns the proposed categories.
 * @throws when the service is missing, the call fails, or the reply carries no
 *   usable category.
 */
export async function classifySkills(options: {
  targets: readonly ClassifyTarget[]
  /** When present, the model must place skills into these existing categories. */
  categories?: readonly string[]
  llm: LlmFace | undefined
  provider: string
  model: string
}): Promise<ClassifyCategory[]> {
  const { targets, categories, llm, provider, model } = options
  if (llm === undefined) throw new Error('the llm service is not available in this profile')
  if (provider === '' || model === '') throw new Error('no model route is configured for classification')

  const guided = categories !== undefined && categories.length > 0
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, CLASSIFY_TIMEOUT_MS)
  try {
    const stream = await llm.stream({
      provider,
      model,
      system: guided ? ASSIGN_PROMPT : SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: guided ? assignPrompt(targets, categories) : targetPrompt(targets),
        }],
        source: { kind: 'user' },
      }],
      temperature: 0.2,
      maxTokens: 4096,
      signal: controller.signal,
    })
    let reply = ''
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
    }
    const draft = readClassification(reply)
    if (draft.length === 0) throw new Error('the model reply carried no usable categories')
    return draft
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The built-in classification, in the same shape the model is asked for: the
 * shipped seed categories with their seeded placements.
 * @returns categories in seed order; skills absent from the seed are simply not listed.
 */
export function seedClassification(): ClassifyCategory[] {
  const state = seedMapState()
  return state.categories.map((category) => ({
    name: category.name,
    skills: Object.keys(state.assignments)
      .filter((skill) => state.assignments[skill] === category.id)
      .sort((a, b) => a.localeCompare(b)),
  }))
}
