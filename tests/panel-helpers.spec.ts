import { describe, expect, it } from 'vitest'
import { originLabel } from '../src/client/panel-helpers.ts'

/**
 * The row's origin line prefers the install ledger — the exact GitHub project a
 * skill was downloaded from — and falls back to the source level for the skills
 * no ledger knows about (locally written ones, plugin-bundled ones). The jsdom
 * document language is empty here, so the zh dictionary is the one under test.
 */
describe('originLabel', () => {
  it('returns undefined without an origin record', () => {
    expect(originLabel(undefined)).toBeUndefined()
  })

  it('prefers the GitHub project over the level label', () => {
    expect(originLabel({ level: 'user-dsh', repo: 'dontbesilent2025/dbskill' })).toBe('dontbesilent2025/dbskill')
  })

  it('names the project a project-scoped skill belongs to', () => {
    expect(originLabel({ level: 'project-dsh', project: 'dsh-skill-map' })).toBe('项目 · dsh-skill-map')
  })

  it('renders the level label alone for a user-level skill', () => {
    expect(originLabel({ level: 'user-dsh' })).toBe('全局')
  })

  it('falls back to the provider for a bundled skill', () => {
    expect(originLabel({ level: 'bundled', provider: '@deepseek-ai/dsh-web-all' })).toBe('内置 · @deepseek-ai/dsh-web-all')
  })

  it('has nothing to show when neither a repo nor a level is present', () => {
    expect(originLabel({ provider: 'filesystem' })).toBeUndefined()
  })
})
