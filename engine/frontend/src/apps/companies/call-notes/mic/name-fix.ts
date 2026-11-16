/**
 * Fixes a near miss of a name the mic heard (PLAN-V18 T3-5): the company's or the person's, like
 * "Vitara" for "Vitera". Speech tools know common words well and names badly, and the rep knows
 * who they called, so a word that is one or two letters off a name on the call becomes the name.
 * The card shows each fix once, so the rep sees it and can put it back.
 *
 * Careful by design, so a real word is never changed:
 * - only a word that starts with a capital letter (a name, as the tools write names);
 * - only against the distinctive words of the names (no "Pty", "Ltd", "Group", ...), of 4 letters
 *   or more;
 * - the same first letter, and at most 1 letter off (2 for a name of 8 letters or more);
 * - never a common word, even with a capital at the start of a sentence.
 * Pure code, so the tests prove each case.
 */

export interface NameFix {
  from: string
  to: string
}

/** Words of a company name that say what kind of company, not which one. */
const GENERIC = new Set([
  'pty',
  'ltd',
  'limited',
  'group',
  'australia',
  'australian',
  'holdings',
  'services',
  'company',
  'the',
  'and',
  'trust',
  'partners',
  'international',
])

/** Common words that look like names to a speller. A capital alone never makes them a name. */
const COMMON = new Set([
  'simple',
  'people',
  'office',
  'offices',
  'still',
  'state',
  'staff',
  'their',
  'there',
  'these',
  'those',
  'where',
  'which',
  'while',
  'would',
  'could',
  'should',
  'about',
  'after',
  'again',
  'other',
  'level',
  'lease',
  'later',
  'today',
  'monday',
  'friday',
  'sunday',
  'march',
  'month',
  'great',
  'thanks',
  'think',
  'thing',
  'maybe',
  'phone',
  'email',
  'meeting',
  'called',
  'calling',
  'speak',
  'spoke',
  'spoken',
  'number',
  'manager',
  'director',
  'sydney',
  'perth',
  'melbourne',
  'adelaide',
  'brisbane',
])

/** The distinctive words of the names on the call, as written in HubSpot. */
export function nameWords(names: readonly string[]): string[] {
  const words = new Map<string, string>()
  for (const name of names) {
    for (const word of name.split(/[^\p{L}'-]+/u)) {
      const clean = word.replace(/^['-]+|['-]+$/g, '')
      const key = clean.toLowerCase()
      if (clean.length < 4 || GENERIC.has(key)) continue
      if (!words.has(key)) words.set(key, clean)
    }
  }
  return [...words.values()]
}

/** How many letters apart two words are: an insert, a delete, a change or a swap each count 1. */
export function lettersApart(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const cost: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)),
  )
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const same = a[row - 1] === b[col - 1] ? 0 : 1
      const above = cost[row - 1]?.[col] ?? 0
      const left = cost[row]?.[col - 1] ?? 0
      const diagonal = cost[row - 1]?.[col - 1] ?? 0
      let best = Math.min(above + 1, left + 1, diagonal + same)
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        best = Math.min(best, (cost[row - 2]?.[col - 2] ?? 0) + 1)
      }
      const line = cost[row]
      if (line) line[col] = best
    }
  }
  return cost[a.length]?.[b.length] ?? 0
}

/** The name a heard word is a near miss of, or null. */
function nearName(word: string, names: readonly string[]): string | null {
  const key = word.toLowerCase()
  if (word.length < 4 || !/^\p{Lu}/u.test(word) || COMMON.has(key)) return null
  for (const name of names) {
    const target = name.toLowerCase()
    if (target === key) return null
    if (target[0] !== key[0]) continue
    const allowed = target.length >= 8 ? 2 : 1
    if (Math.abs(target.length - key.length) > allowed) continue
    if (lettersApart(key, target) <= allowed) return name
  }
  return null
}

/** The text with near misses of the names fixed, and the fixes made. */
export function fixNames(
  text: string,
  names: readonly string[],
): { text: string; fixes: NameFix[] } {
  const words = nameWords(names)
  if (words.length === 0) return { text, fixes: [] }
  const fixes: NameFix[] = []
  const fixed = text.replace(/[\p{L}][\p{L}'-]*/gu, (word) => {
    const name = nearName(word, words)
    if (!name) return word
    if (!fixes.some((fix) => fix.from === word && fix.to === name))
      fixes.push({ from: word, to: name })
    return name
  })
  return { text: fixed, fixes }
}
