/**
 * A choice by voice (PLAN-V24 choice 14, T2-4): while the card asks "Which Sample?", "Which
 * James?" or "Which Sam?", the rep says "the second one", or a name from its list, and the code
 * picks it, with no AI. Plain code, so the rules are tested without a screen.
 *
 * - **The question** is the card's first choice still to make, in its order: the company, then
 *   the person on a call, the teammate a task is for, or the first teammate an email can't go to
 *   yet. A call's person list ends on "No one in particular", as on screen.
 * - **"The second one"**, "number two" or "the last one" picks by place, as on screen.
 * - **A name** picks the one whose name (or a person's job title) has every word said: "Sample
 *   Logistics", "James the director". Two that fit pick neither, and the card asks again.
 * - **A person's or a teammate's name that isn't there** ("James Smith" for James Sample and James
 *   Example) changes nothing, and the card says so. Other words go to the command step, as now:
 *   "make the follow-up Monday" is a change.
 * - **The company said again** (PLAN-V24 choice 19, T3-2): while the card waits on its company,
 *   its question is the search list on screen, if there is one, else the command's own choices.
 *   A name that is in neither, like "Northwind", is searched: the card fills its search box with
 *   it. A place said ("the third one") or a change is never searched.
 */
import type { CallNotePerson, TeamMember } from '@/api/types'
import { pickCompany, type CardDraft, type Company } from './draft'

/** What a choice by voice did. */
export type VoicePick =
  /** One was picked: the card's draft with it. */
  | { kind: 'picked'; draft: CardDraft }
  /** A person or a teammate was named, and no one there has that name: nothing changes. */
  | { kind: 'none'; words: string }
  /** Two or more fit what was said: nothing changes, and the card asks again. */
  | { kind: 'which' }
  /** A company's name that isn't on screen (choice 19): the card searches these words. */
  | { kind: 'search'; words: string }

/** One option of the card's question, in its place on screen. */
interface Option {
  /** The words it is known by: a name, and a person's job title. */
  words: readonly string[]
  /** The card's draft with this option picked. */
  pick: () => CardDraft
}

interface Question {
  /** A person or a teammate: a name said that isn't there is said back. */
  people: boolean
  /** The name the command heard ("James"): words that share it are a name. */
  heard: string
  options: readonly Option[]
}

/** Small letters and digits, a word at a time: "It's James Example." is its, james, example. */
function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

/**
 * The card's first choice still to make, as a question with its options, or null. `search`: the
 * companies the card's search list shows now, or null when it shows none (choice 19).
 */
function questionOf(draft: CardDraft, search: readonly Company[] | null): Question | null {
  if (draft.action !== 'email' && draft.company.found === null) {
    const { company } = draft
    // The search list on screen was found by hand; the command's own choices weren't (PLAN-V23).
    const [list, how] =
      search !== null ? ([search, 'by_hand'] as const) : ([company.choices, 'choice'] as const)
    return {
      people: false,
      heard: company.heard,
      options: list.map((one: Company) => ({
        words: wordsIn(one.name),
        pick: () => ({ ...draft, company: pickCompany(company, one, how), edited: true }),
      })),
    }
  }
  if (draft.action === 'log_call') {
    const { person } = draft
    if (person.found !== null || person.choices.length === 0) return null
    const pickPerson = (found: CallNotePerson | null) => (): CardDraft => ({
      ...draft,
      person: { ...person, found, choices: [] },
      edited: true,
    })
    return {
      people: true,
      heard: person.heard,
      options: [
        ...person.choices.map((one) => ({
          words: wordsIn(`${one.name} ${one.title ?? ''}`),
          pick: pickPerson(one),
        })),
        // "No one in particular", last on screen: picked by its place or its own words only.
        { words: [], pick: pickPerson(null) },
      ],
    }
  }
  if (draft.action === 'task') {
    const { forWhom } = draft
    if (forWhom === null || forWhom.found !== null || forWhom.choices.length === 0) return null
    return {
      people: true,
      heard: forWhom.heard,
      options: forWhom.choices.map((member: TeamMember) => ({
        words: wordsIn(member.name),
        pick: () => ({
          ...draft,
          forWhom: { ...forWhom, found: member, choices: [] },
          edited: true,
        }),
      })),
    }
  }
  if (draft.action === 'email') {
    const open = draft.to.find((one) => one.found === null && one.choices.length > 0)
    if (!open) return null
    return {
      people: true,
      heard: open.heard,
      options: open.choices.map((member) => ({
        words: wordsIn(member.name),
        pick: () => ({
          ...draft,
          to: draft.to.map((one) =>
            one.id === open.id ? { ...one, found: member, choices: [] } : one,
          ),
          edited: true,
        }),
      })),
    }
  }
  return null
}

/** "No one in particular", and how else it is said. */
const NO_ONE_SAID: ReadonlySet<string> = new Set([
  'no one',
  'no one in particular',
  'nobody',
  'none',
  'neither',
  'neither of them',
])

/** Words around a choice that don't name it: "the second one, please", "pick Sample Logistics". */
const AROUND: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'its',
  'it',
  'is',
  'that',
  'this',
  'please',
  'pick',
  'choose',
  'use',
  'take',
  'go',
  'with',
  'at',
  'in',
  'from',
  'of',
  'for',
  'and',
  'i',
  'mean',
  'ok',
  'okay',
  'yes',
  'yeah',
  'oh',
  'um',
  'umm',
  'uh',
  'er',
  'erm',
  'number',
  'option',
])

/** Places, as said: "the second one" is 1. */
const PLACES: Readonly<Record<string, number>> = {
  first: 0,
  '1st': 0,
  one: 0,
  '1': 0,
  top: 0,
  second: 1,
  '2nd': 1,
  two: 1,
  '2': 1,
  third: 2,
  '3rd': 2,
  three: 2,
  '3': 2,
  fourth: 3,
  '4th': 3,
  four: 3,
  '4': 3,
  fifth: 4,
  '5th': 4,
  five: 4,
  '5': 4,
}

/** The place said ("the second one", "number two", "the last one"), whatever the count, or null. */
function placeSaid(words: readonly string[]): number | 'last' | null {
  const left = words.filter((word) => !AROUND.has(word))
  // "The second one": the "one" after a place is no place of its own.
  const [place, after, ...more] = left
  if (place === undefined || more.length > 0 || (after !== undefined && after !== 'one')) {
    return null
  }
  if (place === 'last') return 'last'
  return PLACES[place] ?? null
}

/** The place said, among `count` options, or null. */
function placeOf(words: readonly string[], count: number): number | null {
  const place = placeSaid(words)
  if (place === null) return null
  const index = place === 'last' ? count - 1 : place
  return index >= 0 && index < count ? index : null
}

/**
 * Words that make a change, not a name: a short turn with one of them goes to the command step
 * ("make it Monday", "Friday").
 */
const CHANGE_WORDS: ReadonlySet<string> = new Set([
  'make',
  'change',
  'set',
  'move',
  'add',
  'remove',
  'delete',
  'send',
  'cancel',
  'later',
  'follow',
  'followup',
  'due',
  'outcome',
  'summary',
  'subject',
  'body',
  'note',
  'kind',
  'call',
  'email',
  'task',
  'log',
  'open',
  'today',
  'tomorrow',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'week',
  'next',
  'morning',
  'afternoon',
  'connected',
  'voicemail',
  'answer',
])

/** The most words a name said on its own has (TBC). */
const NAME_WORDS = 3

/** The most words a company's name said on its own has, "Sample Logistics Pty Ltd" (TBC). */
const COMPANY_WORDS = 5

/** One word said fits one of the option's: the same, or one starts the other ("logistic"). */
function fits(said: string, known: readonly string[]): boolean {
  return known.some(
    (word) =>
      word === said ||
      (said.length >= 4 && word.length >= 4 && (word.startsWith(said) || said.startsWith(word))),
  )
}

/**
 * A company's name as said, to search: without the words around it ("It's", "please") or the full
 * stop the speech service adds. "It's North Wind, please." is "North Wind".
 */
function searchWordsOf(said: string): string {
  const parts = said.trim().split(/\s+/)
  const around = (part: string | undefined): boolean => {
    const plain = wordsIn(part ?? '').join(' ')
    return plain === '' || AROUND.has(plain)
  }
  let start = 0
  let end = parts.length
  while (start < end && around(parts[start])) start += 1
  while (end > start && around(parts[end - 1])) end -= 1
  return parts
    .slice(start, end)
    .join(' ')
    .replace(/[.,!?;:]+$/, '')
    .trim()
}

/**
 * What a turn picks on the card, with no AI, or null when it isn't an answer to the card's
 * question (it goes to the command step, as now). `search`: the companies the card's search list
 * shows now, or null when it shows none (PLAN-V24 choice 19).
 */
export function pickByVoice(
  draft: CardDraft,
  said: string,
  search: readonly Company[] | null = null,
): VoicePick | null {
  const question = questionOf(draft, search)
  if (!question) return null
  const words = wordsIn(said)
  const { options } = question
  const place = placeOf(words, options.length)
  if (place !== null) {
    const option = options[place]
    return option ? { kind: 'picked', draft: option.pick() } : null
  }
  // "The third one" of two companies: a place, not a name to search.
  if (!question.people && placeSaid(words) !== null) return null
  if (question.people && draft.action === 'log_call' && NO_ONE_SAID.has(words.join(' '))) {
    const noOne = options.at(-1)
    return noOne ? { kind: 'picked', draft: noOne.pick() } : null
  }
  const name = words.filter((word) => !AROUND.has(word))
  if (name.length === 0) return null
  const fitting = options.filter((option) => name.every((word) => fits(word, option.words)))
  const [only] = fitting
  if (fitting.length === 1 && only) return { kind: 'picked', draft: only.pick() }
  if (fitting.length > 1) return { kind: 'which' }
  if (!question.people) {
    // A company's name that isn't on screen is searched (choice 19). Words of a change aren't.
    if (name.length > COMPANY_WORDS || name.some((word) => CHANGE_WORDS.has(word))) return null
    const found = searchWordsOf(said)
    return found.length >= 2 ? { kind: 'search', words: found } : null
  }
  // No one fits. A short name that shares a word with the question, or has no word of a change,
  // was meant as one: for a person or a teammate the card says so.
  if (name.length > NAME_WORDS) return null
  const heard = new Set(wordsIn(question.heard))
  const named =
    name.some((word) => heard.has(word) || options.some((option) => option.words.includes(word))) ||
    !name.some((word) => CHANGE_WORDS.has(word))
  return named ? { kind: 'none', words: said.trim().replace(/[.!?]+$/, '') } : null
}
