/**
 * skill-map surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'entry.label': '技能地图',
  'entry.description': '按自己的分类浏览全部 skill',
  'action.newCategory': '新建分类',
  'action.rename': '重命名',
  'action.remove': '删除',
  'action.removeHint': '删除该分类，其中的 skill 回到未归类',
  'category.namePlaceholder': '分类名称',
  'category.newName': '新分类',
  'search.placeholder': '搜索 skill',
  'search.clear': '清空',
  'list.loading': '加载中…',
  'list.loadFailed': '加载失败：{error}',
  'list.empty': '没有已加载的 skill',
  'list.noMatch': '没有匹配的 skill',
  'list.unassigned': '未归类',
  'list.count': '{count}',
  'list.incomplete': '注册表快照不完整，列表可能缺少部分 skill。',
  'save.failed': '保存失败：{error}',
  'footer.total': '共 {total} 个 skill',
} as const

export const en: Record<keyof typeof zh, string> = {
  'entry.label': 'Skill Map',
  'entry.description': 'Browse every skill through your own categories',
  'action.newCategory': 'New category',
  'action.rename': 'Rename',
  'action.remove': 'Delete',
  'action.removeHint': 'Delete this category; its skills return to Unassigned',
  'category.namePlaceholder': 'Category name',
  'category.newName': 'New category',
  'search.placeholder': 'Search skills',
  'search.clear': 'Clear',
  'list.loading': 'Loading…',
  'list.loadFailed': 'Failed to load: {error}',
  'list.empty': 'No skills loaded',
  'list.noMatch': 'No matching skill',
  'list.unassigned': 'Unassigned',
  'list.count': '{count}',
  'list.incomplete': 'The registry snapshot is incomplete, so some skills may be missing.',
  'save.failed': 'Save failed: {error}',
  'footer.total': '{total} skills',
}

/** Locale key union for the slot map. */
export type SkillMapKey = keyof typeof zh
