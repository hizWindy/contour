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

/**
 * How a voice tool writes names (PLAN-V24 choice 28).
 * - `capitals`: with capitals, as the browser's speech service does. A word with a capital may be a
 *   name, so only such a word is fixed (the rules at the top).
 * - `any`: in any case, as the model on the device does ("sample logistics"), so a capital says
 *   nothing. There a name is found only by its whole run of words (`fixRuns`).
 */
export type NameCase = 'capitals' | 'any'

/**
 * Everyday words, for `any`. A speller can't tell them from a name, so a heard one is never changed
 * into a name ("shall" never becomes "Shell", "parts" never "Ports"), and a run made only of them
 * and the `GENERIC` words is never taken for one ("office space" stays as said).
 */
const EVERYDAY = new Set(
  `able about above account after again against agent ahead also always amount another answer
  anyone anything apple area areas around asked away back bank base basic been before being below
  best better between bill bills black block blue board body book booked both bottom box boxes
  brand break bright bring broad brown budget build building built busy call calls came card cards
  care cars case cases cash cause centre center chair chance change charge charges check checks
  chief city claim class clean clear close cloud coast code cold come comes coming common contact
  copy corner cost costs could count course cover create cross current data date dates days deal
  deals dear desk desks detail details does done door doors down draft drive early earth east easy
  edge else empty energy enough even event events every exact face fact fair fall farm fast field
  fields figure file files fill final find fine finish fire first five fixed flat floor floors flow
  fold follow food form forms forward four frame free fresh from front full fund funds future gain
  game garden gate gave general give given glad glass goal going gold good grand great green ground
  group grow guide guys hall hand hands happy harbour hard have head heard heart help here high hill
  hills hold home hope hour hours house hundred idea ideas inside items just keep kind king know
  land large last late later lead leads lease least leave left less letter level life light like
  line lines link list little live local long look lost lots love made mail main make many maple
  march mark market marks match matter maybe mean meet member metro middle might mind minute mobile
  model money month months more most mount move moved much must name names near need needs never
  news next nice night none north note notes number offer office often open order orders other
  others over owner pack page pages paid paper park parks part parts party pass past path pause
  peak people pick piece pine place plan plans plant plants plate play please plus point points
  pool port ports post posts power press price prices prime print profit proof pull push quick
  quite rain range rate rates read ready real reason record rest result return right ring rise
  river road rock role room rooms rose round rule rules safe said sale sales same sample samples
  save says scale search seat second send sense sent serve service session set shall share sheet
  shell shift ship shop short show side sign signed silver simple since single site sites size
  skills small smart soft some soon sort sound south space spaces spare spark speed spend split
  sport spot spring square stage stand standard star start started state station stay step stock
  stone stop store storm story street strong stuff summer supply sure system table take taken talk
  tank team teams tell term terms test text than thank that them then they thing things think
  third this three through time times title told took total touch tour tower town track trade
  train tree trial trip truck trust turn type under unit units upper used user value very view
  wall want wanted warm watch water wave week weeks well were west what wheel when white whole wide
  wind window with wood word words work works world worth write yard yards year years young`.split(
    /\s+/,
  ),
)

const everyday = (key: string): boolean => COMMON.has(key) || EVERYDAY.has(key) || GENERIC.has(key)

/** A name's words, as written: "Sample Logistics Pty Ltd" has four. */
function wordsOf(name: string): string[] {
  return name
    .split(/[^\p{L}'-]+/u)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean)
}

/**
 * The runs of words to look for in `any`, longest first: each whole name, and each name without
 * the `GENERIC` words at its ends ("Sample Logistics" for "Sample Logistics Pty Ltd"). One word
 * alone is never a run ("sample" in "send a sample" is not "Sample"), and neither is a run made
 * only of everyday words.
 */
function runsOf(names: readonly string[]): string[][] {
  const runs = new Map<string, string[]>()
  for (const name of names) {
    const words = wordsOf(name)
    const generic = words.map((word) => GENERIC.has(word.toLowerCase()))
    const first = generic.indexOf(false)
    const last = generic.lastIndexOf(false)
    for (const run of [words, first < 0 ? [] : words.slice(first, last + 1)]) {
      if (run.length < 2 || run.every((word) => everyday(word.toLowerCase()))) continue
      runs.set(run.join(' ').toLowerCase(), run)
    }
  }
  return [...runs.values()].sort((a, b) => b.length - a.length)
}

/** Whether a heard word, in any case, is a near miss of a name's word, and never an everyday one. */
function nearMiss(heard: string, word: string): boolean {
  const key = heard.toLowerCase()
  const target = word.toLowerCase()
  if (key.length < 4 || target.length < 4 || everyday(key) || GENERIC.has(target)) return false
  if (key[0] !== target[0]) return false
  const allowed = target.length >= 8 ? 2 : 1
  return Math.abs(target.length - key.length) <= allowed && lettersApart(key, target) <= allowed
}

interface Heard {
  word: string
  at: number
}

/**
 * `any`: each run of heard words that is one of the names gets the name's own capitals ("sample
 * logistics" becomes "Sample Logistics"). That isn't a fix: the words didn't change. One near miss
 * in a run is fixed, and shown, when the rest of the run is the name ("sample logistix"). A word
 * alone never changes, and nor does anything across a comma or a full stop.
 */
function fixRuns(text: string, names: readonly string[]): { text: string; fixes: NameFix[] } {
  const runs = runsOf(names)
  const heard: Heard[] = [...text.matchAll(/[\p{L}][\p{L}'-]*/gu)].map((match) => ({
    word: match[0],
    at: match.index,
  }))
  const out = heard.map(({ word }) => word)
  const fixes: NameFix[] = []

  /** The run at `start`: false if it isn't there, else its one near miss, if any. */
  const runAt = (start: number, run: readonly string[]): NameFix | null | false => {
    let fix: NameFix | null = null
    for (const [offset, word] of run.entries()) {
      const here = heard[start + offset]
      if (!here) return false
      const before = heard[start + offset - 1]
      if (
        offset > 0 &&
        before &&
        !/^\s+$/.test(text.slice(before.at + before.word.length, here.at))
      )
        return false
      if (here.word.toLowerCase() === word.toLowerCase()) continue
      if (fix || !nearMiss(here.word, word)) return false
      fix = { from: here.word, to: word }
    }
    return fix
  }

  for (let start = 0; start < heard.length;) {
    let found: { run: readonly string[]; fix: NameFix | null } | null = null
    for (const run of runs) {
      const fix = runAt(start, run)
      if (fix !== false) {
        found = { run, fix }
        break
      }
    }
    if (!found) {
      start += 1
      continue
    }
    for (const [offset, word] of found.run.entries()) out[start + offset] = word
    const fix = found.fix
    if (fix && !fixes.some((kept) => kept.from === fix.from && kept.to === fix.to)) fixes.push(fix)
    start += found.run.length
  }

  let fixed = ''
  let from = 0
  for (const [index, { word, at }] of heard.entries()) {
    fixed += `${text.slice(from, at)}${out[index] ?? word}`
    from = at + word.length
  }
  return { text: fixed + text.slice(from), fixes }
}

/**
 * The text with near misses of the names fixed, and the fixes made. `nameCase` is how the voice
 * tool writes names: with capitals (the browser's service, as before) or in any case (the model on
 * the device).
 */
export function fixNames(
  text: string,
  names: readonly string[],
  nameCase: NameCase = 'capitals',
): { text: string; fixes: NameFix[] } {
  if (nameCase === 'any') return fixRuns(text, names)
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
