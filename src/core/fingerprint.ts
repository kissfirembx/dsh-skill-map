/**
 * Content fingerprint for a skill description.
 *
 * The hand-written copy records the description it was written from, so a skill
 * that gets updated under a name we already have copy for can be reported as
 * due for review instead of silently rendering yesterday's understanding. The
 * fingerprint only has to answer "same or different", so a small non-cryptographic
 * hash is the right size: it is stable, dependency-free, and safe in the browser
 * half (no node:crypto).
 *
 * Whitespace is normalised first, so a reflow or a changed indentation in
 * SKILL.md is not treated as a content change.
 */

/** 32-bit FNV-1a over the UTF-16 code units, rendered as 8 hex digits. */
export function fingerprint(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < flat.length; i += 1) {
    hash ^= flat.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
