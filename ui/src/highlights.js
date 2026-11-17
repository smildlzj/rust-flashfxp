// Parse FlashFXP masks, never arbitrary regular expressions. Matching uses bounded
// dynamic programming (no recursive/backtracking wildcard expansion).
export const MAX_HIGHLIGHT_MASK = 512
const cache = new Map()
const fold = value => value.toLowerCase()
function parse(mask) {
  if (typeof mask !== 'string' || !mask.length) return { error: 'highlight_mask_required' }
  if (Array.from(mask).length > MAX_HIGHLIGHT_MASK) return { error: 'highlight_mask_too_long' }
  const chars = Array.from(mask), tokens = []
  const invalid = () => ({ error: 'highlight_mask_invalid' })
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '\\') {
      if (++i === chars.length) return invalid()
      tokens.push({ literal: fold(chars[i]) })
    } else if (c === '*') {
      if (tokens.at(-1)?.type !== '*') tokens.push({ type: '*' })
    } else if (c === '?') tokens.push({ type: '?' })
    else if (c === '[') {
      const negated = chars[i + 1] === '^'
      if (negated) i++
      const members = []
      let closed = false
      while (++i < chars.length) {
        if (chars[i] === ']') { closed = true; break }
        let escaped = false, value = chars[i]
        if (value === '\\') { escaped = true; value = chars[++i]; if (value === undefined) return invalid() }
        if (value === '[' && !escaped) return invalid()
        members.push({ value: fold(value), dash: value === '-' && !escaped })
      }
      if (!closed || !members.length) return invalid()
      const ranges = []
      for (let n = 0; n < members.length; n++) {
        if (members[n].dash) return invalid()
        if (members[n + 1]?.dash) {
          if (!members[n + 2] || members[n + 2].dash || members[n].value > members[n + 2].value) return invalid()
          ranges.push([members[n].value, members[n + 2].value]); n += 2
        } else ranges.push([members[n].value, members[n].value])
      }
      tokens.push({ type: 'set', negated, ranges })
    } else if (c === ']' || c === '-') return invalid()
    else tokens.push({ literal: fold(c) })
  }
  return { tokens }
}
function compiled(mask) {
  if (cache.has(mask)) return cache.get(mask)
  const result = parse(mask)
  if (cache.size >= 128) cache.delete(cache.keys().next().value)
  cache.set(mask, result)
  return result
}
export function validateHighlightMask(mask) { return compiled(mask).error || null }
export function matchesHighlightMask(name, mask) {
  const { tokens, error } = compiled(mask)
  if (error || typeof name !== 'string') return false
  const chars = Array.from(name)
  // Filesystem basenames are far shorter; bound imported/untrusted input too.
  if (chars.length > 4096) return false
  let previous = new Uint8Array(chars.length + 1)
  previous[0] = 1
  for (const token of tokens) {
    const next = new Uint8Array(chars.length + 1)
    if (token.type === '*') next[0] = previous[0]
    for (let j = 1; j <= chars.length; j++) {
      if (token.type === '*') next[j] = previous[j] || next[j - 1]
      else if (previous[j - 1]) {
        const c = fold(chars[j - 1])
        next[j] = token.type === '?' || (token.type === 'set'
          ? token.ranges.some(([lo, hi]) => lo <= c && c <= hi) !== token.negated
          : token.literal === c) ? 1 : 0
      }
    }
    previous = next
  }
  return !!previous[chars.length]
}
export function highlightColor(name, rules = []) {
  return rules.find(rule => /^#[\da-f]{6}$/i.test(rule.color) && matchesHighlightMask(name, rule.mask))?.color
}
