import { describe, expect, it } from 'vitest'
import { MAX_SUMMARY_LENGTH, summarize } from '../src/core/summary.ts'

/**
 * The summary is the row's resting text: the first sentence of the description,
 * cut further only when that sentence is itself long. These cases pin the
 * boundaries the panel depends on — one readable line, no dangling clause marks,
 * and no split inside a version number.
 */
describe('summarize', () => {
  it('returns an empty string for empty input', () => {
    expect(summarize('')).toBe('')
    expect(summarize('   \n\t ')).toBe('')
  })

  it('flattens newlines and runs of spaces', () => {
    expect(summarize('one\n  two')).toBe('one two')
  })

  it('keeps a short description whole', () => {
    expect(summarize('Runs the tests.')).toBe('Runs the tests.')
  })

  it('keeps the first sentence and drops the rest', () => {
    expect(summarize('Runs the tests. Then it writes a long report.')).toBe('Runs the tests.')
  })

  it('treats a CJK full stop as a sentence end', () => {
    expect(summarize('审查一段改动。并按严重程度排序输出。')).toBe('审查一段改动。')
  })

  it('does not split a version number on its dots', () => {
    expect(summarize('Pins v0.1.0 of the plugin')).toBe('Pins v0.1.0 of the plugin')
  })

  it('cuts a long first sentence at a clause mark', () => {
    const summary = summarize('审查一段改动或单个文件，找出其中的缺陷、风格漂移与缺失的测试，并按严重程度从高到低排序，输出一份可直接执行的完整报告与修复建议。')
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH + 1)
    expect(summary).not.toMatch(/[，、；：,;:]…$/)
  })

  it('hard-cuts a long sentence that carries no boundary at all', () => {
    const summary = summarize('技'.repeat(MAX_SUMMARY_LENGTH * 3))
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.length).toBe(MAX_SUMMARY_LENGTH + 1)
  })
})
