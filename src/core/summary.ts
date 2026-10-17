/**
 * One-sentence skill summaries for the map row.
 *
 * A row carries two granularities of the same SKILL.md text: a summary beside
 * the name at rest, and the fuller compacted description under it on hover.
 * Both are cut from the raw description, so the summary is never a truncation
 * of an already-truncated line.
 *
 * Pure text: the browser bundle imports this module, so nothing here may reach
 * for node APIs.
 */

/** Longest served summary. A first sentence longer than this is cut at a clause boundary. */
export const MAX_SUMMARY_LENGTH = 56

/** CJK sentence terminators: any one of these always ends a sentence. */
const CJK_TERMINATOR = /[。！？…]/

/**
 * ASCII terminators count only before whitespace or at the end, so version
 * numbers and abbreviations ("0.1.0", "e.g. this") stay inside one sentence.
 */
const ASCII_TERMINATOR = /[.!?](?=\s|$)/

/** Clause boundaries a too-long first sentence is cut at, in preference order. */
const CLAUSE_MARKS = ['，', '、', '；', '：', ',', ';', ':']

/**
 * First sentence of a description, bounded to one readable line.
 * @param text - raw SKILL.md description (may carry newlines or run-on spaces).
 * @returns the summary, ending in an ellipsis when it had to be cut; empty for empty input.
 */
export function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const sentence = firstSentence(flat)
  if (sentence.length <= MAX_SUMMARY_LENGTH) return sentence
  const cut = sentence.slice(0, MAX_SUMMARY_LENGTH)
  const boundary = lastBoundary(cut)
  // Keep the clause boundary only when it leaves a readable head; otherwise the
  // cut itself is the summary, which is the CJK case (no spaces to break on).
  const head = boundary > MAX_SUMMARY_LENGTH / 2 ? cut.slice(0, boundary) : cut
  return `${stripTrailingMarks(head)}…`
}

/** The leading sentence, terminator included; the whole text when it carries none. */
function firstSentence(flat: string): string {
  const ends: number[] = []
  const cjk = CJK_TERMINATOR.exec(flat)
  if (cjk !== null) ends.push(cjk.index + 1)
  const ascii = ASCII_TERMINATOR.exec(flat)
  if (ascii !== null) ends.push(ascii.index + 1)
  if (ends.length === 0) return flat
  return flat.slice(0, Math.min(...ends)).trim()
}

/** Last space or clause mark inside the cut, or -1 when there is none. */
function lastBoundary(cut: string): number {
  let best = cut.lastIndexOf(' ')
  for (const mark of CLAUSE_MARKS) {
    const at = cut.lastIndexOf(mark)
    if (at > best) best = at
  }
  return best
}

/** Drop clause marks left dangling in front of the ellipsis. */
function stripTrailingMarks(text: string): string {
  let out = text.trimEnd()
  while (out !== '' && CLAUSE_MARKS.includes(out.slice(-1))) out = out.slice(0, -1).trimEnd()
  return out
}
