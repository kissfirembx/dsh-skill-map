import { describe, expect, it } from 'vitest'
import { fingerprint } from '../src/core/fingerprint.ts'

/**
 * The fingerprint only has to answer "same or different" for a SKILL.md
 * description. It must survive a reflow (the same text wrapped differently) but
 * not a real edit, and it must be usable in the browser half.
 */
describe('fingerprint', () => {
  it('is eight hex digits', () => {
    expect(fingerprint('anything')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is stable for the same text', () => {
    expect(fingerprint('extract text from a PDF')).toBe(fingerprint('extract text from a PDF'))
  })

  it('ignores whitespace reflow', () => {
    expect(fingerprint('one\ntwo   three')).toBe(fingerprint('one two three'))
    expect(fingerprint('  padded  ')).toBe(fingerprint('padded'))
  })

  it('changes when the text changes', () => {
    expect(fingerprint('reads PDFs')).not.toBe(fingerprint('reads and writes PDFs'))
  })

  it('handles an empty string', () => {
    expect(fingerprint('')).toBe('811c9dc5')
  })

  it('separates strings that differ only in CJK characters', () => {
    expect(fingerprint('审查代码')).not.toBe(fingerprint('审查文案'))
  })
})
