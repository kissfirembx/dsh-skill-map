/**
 * Default categories shipped with the plugin.
 *
 * These are a SEED, not the taxonomy: on first open the panel writes them into
 * the user map file and from then on the user owns the category list (rename,
 * add, delete, reorder). The map therefore never needs a code change to follow
 * how the user actually thinks about their library.
 *
 * Category names are the only copy the panel shows; per-skill descriptions were
 * deliberately dropped so a category reads like a folder of names.
 */

/** One seeded category. */
export interface SeedCategory {
  id: string
  name: string
}

/** One seeded placement. */
export interface SeedEntry {
  skill: string
  category: string
}

/** Seeded categories in display order. */
export const SEED_CATEGORIES: SeedCategory[] = [
  { id: 'L0', name: '入口与编排' },
  { id: 'L1', name: '认知澄清' },
  { id: 'L2', name: '内容生产' },
  { id: 'L3', name: '传播与风控' },
  { id: 'L4', name: '外部情报与理论' },
  { id: 'L5', name: '本地资产工程' },
  { id: 'L6', name: '会话状态与产物' },
  { id: 'L7', name: '多角色思辨' },
  { id: 'L8', name: '元能力' },
  { id: 'L9', name: '平台接入与外部工具' },
  { id: 'L10', name: '办公文档与介质处理' },
  { id: 'L11', name: '工程协作与规格文档' },
]

/** Seeded placements: which category each known skill starts in. */
export const SEED_ENTRIES: SeedEntry[] = [
  { skill: 'dbs', category: 'L0' },
  { skill: 'dbs-diagnosis', category: 'L1' },
  { skill: 'dbs-deconstruct', category: 'L1' },
  { skill: 'dbs-good-question', category: 'L1' },
  { skill: 'dbs-goal', category: 'L1' },
  { skill: 'dbs-jtbd', category: 'L1' },
  { skill: 'dbs-action', category: 'L1' },
  { skill: 'dbs-content', category: 'L2' },
  { skill: 'dbs-content-value', category: 'L2' },
  { skill: 'dbs-hook', category: 'L2' },
  { skill: 'dbs-xhs-title', category: 'L2' },
  { skill: 'dbs-script-flow', category: 'L2' },
  { skill: 'dbs-wechat-html', category: 'L2' },
  { skill: 'dbs-video-extract', category: 'L2' },
  { skill: 'dbs-resonate', category: 'L3' },
  { skill: 'dbs-spread', category: 'L3' },
  { skill: 'dbs-ai-check', category: 'L3' },
  { skill: 'dbs-content-risk-check', category: 'L3' },
  { skill: 'dbs-benchmark', category: 'L4' },
  { skill: 'dbs-standard-answer', category: 'L4' },
  { skill: 'dbs-theory-grounding', category: 'L4' },
  { skill: 'dbs-knowledge', category: 'L5' },
  { skill: 'dbs-decision', category: 'L5' },
  { skill: 'dbs-content-system', category: 'L5' },
  { skill: 'dbs-learning', category: 'L5' },
  { skill: 'dbs-save', category: 'L6' },
  { skill: 'dbs-restore', category: 'L6' },
  { skill: 'dbs-report', category: 'L6' },
  { skill: 'dbs-chatroom', category: 'L7' },
  { skill: 'dbs-chatroom-austrian', category: 'L7' },
  { skill: 'dbs-skill-maker', category: 'L8' },
  { skill: 'dbs-agent-migration', category: 'L8' },
  { skill: 'docx', category: 'L10' },
  { skill: 'domain-modeling', category: 'L11' },
  { skill: 'gh', category: 'L9' },
  { skill: 'lark-base', category: 'L9' },
  { skill: 'lark-contact', category: 'L9' },
  { skill: 'lark-doc', category: 'L9' },
  { skill: 'lark-im', category: 'L9' },
  { skill: 'lark-shared', category: 'L9' },
  { skill: 'lark-sheets', category: 'L9' },
  { skill: 'office-docx', category: 'L10' },
  { skill: 'office-pptx', category: 'L10' },
  { skill: 'office-xlsx', category: 'L10' },
  { skill: 'opencli-adapter-author', category: 'L9' },
  { skill: 'opencli-autofix', category: 'L9' },
  { skill: 'opencli-browser', category: 'L9' },
  { skill: 'pdf', category: 'L10' },
  { skill: 'pptx', category: 'L10' },
  { skill: 'to-spec', category: 'L11' },
  { skill: 'to-tickets', category: 'L11' },
  { skill: 'wayfinder', category: 'L11' },
  { skill: 'xlsx', category: 'L10' },
  { skill: 'find-skills', category: 'L0' },
  { skill: 'opencli-usage', category: 'L0' },
  { skill: 'discernment-nudge', category: 'L1' },
  { skill: 'grill-me', category: 'L1' },
  { skill: 'grill-with-docs', category: 'L1' },
  { skill: 'grilling', category: 'L1' },
  { skill: 'loop-me', category: 'L1' },
  { skill: 'to-questionnaire', category: 'L1' },
  { skill: 'wait-what', category: 'L1' },
  { skill: 'canvas-design', category: 'L2' },
  { skill: 'chatcut', category: 'L2' },
  { skill: 'doc-coauthoring', category: 'L2' },
  { skill: 'mbx-simplify', category: 'L2' },
  { skill: 'theme-factory', category: 'L2' },
  { skill: 'agent-reach', category: 'L4' },
  { skill: 'defuddle', category: 'L4' },
  { skill: 'research', category: 'L4' },
  { skill: 'smart-search', category: 'L4' },
  { skill: 'json-canvas', category: 'L5' },
  { skill: 'knap', category: 'L5' },
  { skill: 'mbx-book-translation', category: 'L5' },
  { skill: 'obsidian-bases', category: 'L5' },
  { skill: 'obsidian-cli', category: 'L5' },
  { skill: 'obsidian-markdown', category: 'L5' },
  { skill: 'paddleocr-doc-parsing', category: 'L5' },
  { skill: 'paddleocr-text-recognition', category: 'L5' },
  { skill: 'teach', category: 'L5' },
  { skill: 'handoff', category: 'L6' },
  { skill: 'diagnose-windows-sandbox-acl', category: 'L8' },
  { skill: 'mbx-skill-butler', category: 'L8' },
  { skill: 'retro', category: 'L8' },
  { skill: 'writing-for-agents', category: 'L8' },
]
