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
 * - **A reply or a sound alone** ("okay", "hmm", "great", "thank you") names nothing (PLAN-V24
 *   review): it never picks or searches, and the bar drops it as a short turn. The card hears a
 *   turn before the bar's short-turn filter, so one stray word would otherwise ask HubSpot.
 * - **A suggestion** (PLAN-V25 T1-2, choice 6): "yes", "use it" or "the first one" takes it;
 *   "no" or "not this one" turns it down, and the other choices show. A name picks as before.
 * - **A person found before their company** (T2-2): the question is the person, and each choice
 *   is known by their name and their company's. Taking one fills both. In the search list, a person
 *   shown with their company is picked the same way (choice 11).
 */
import type { CallNotePerson, TeamMember } from '@/api/types'
import { FILLERS } from '../voice/turns'
import type { ShownChoice } from './company'
import {
  isPersonFirst,
  pickCompany,
  pickPerson,
  turnDown,
  type CardDraft,
  type Company,
  type PersonChoice,
} from './draft'

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
  /**
   * A suggestion (PLAN-V25, likely): "yes" takes the first option, and "no" turns it down with
   * this draft. Null: no suggestion shows.
   */
  turnDown: (() => CardDraft) | null
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
function questionOf(draft: CardDraft, search: readonly ShownChoice[] | null): Question | null {
  if (draft.action !== 'email' && draft.company.found === null && search !== null) {
    // The search list on screen was found by hand (PLAN-V23). A person in it brings their company.
    const { company } = draft
    return {
      people: false,
      heard: company.heard,
      turnDown: null,
      options: search.map((one) => ({
        words: wordsIn(one.person ? `${one.person.name} ${one.name}` : one.name),
        pick: (): CardDraft => {
          const picked: Company = { key: one.key, name: one.name }
          if (draft.action === 'log_call' && one.person) {
            return pickPerson(
              draft,
              { ...one.person, company_key: one.key, company_name: one.name },
              'by_hand',
            )
          }
          return { ...draft, company: pickCompany(company, picked, 'by_hand'), edited: true }
        },
      })),
    }
  }
  if (draft.action === 'log_call' && isPersonFirst(draft)) {
    // A person found before their company (PLAN-V25 T2-2): taking one fills both.
    const { person } = draft
    return {
      people: true,
      heard: person.heard,
      turnDown:
        person.level === 'likely'
          ? () => ({ ...draft, person: turnDown(person), edited: true })
          : null,
      options: person.choices.map((one: PersonChoice) => ({
        words: wordsIn(`${one.name} ${one.company_name ?? ''}`),
        pick: () => pickPerson(draft, one),
      })),
    }
  }
  if (draft.action !== 'email' && draft.company.found === null) {
    const { company } = draft
    // The command's own choices teach nothing (PLAN-V23).
    return {
      people: false,
      heard: company.heard,
      turnDown:
        company.level === 'likely'
          ? () => ({ ...draft, company: turnDown(company), edited: true })
          : null,
      options: company.choices.map((one: Company) => ({
        words: wordsIn(one.name),
        pick: () => ({
          ...draft,
          company: pickCompany(company, { key: one.key, name: one.name }, 'choice'),
          edited: true,
        }),
      })),
    }
  }
  if (draft.action === 'log_call') {
    const { person } = draft
    if (person.found !== null || person.choices.length === 0) return null
    const pickOne = (found: CallNotePerson | null) => (): CardDraft => pickPerson(draft, found)
    return {
      people: true,
      heard: person.heard,
      turnDown:
        person.level === 'likely'
          ? () => ({ ...draft, person: turnDown(person), edited: true })
          : null,
      options: [
        ...person.choices.map((one) => ({
          words: wordsIn(`${one.name} ${one.title ?? ''}`),
          pick: pickOne(one),
        })),
        // "No one in particular", last on screen: picked by its place or its own words only.
        { words: [], pick: pickOne(null) },
      ],
    }
  }
  if (draft.action === 'task') {
    const { forWhom } = draft
    if (forWhom === null || forWhom.found !== null || forWhom.choices.length === 0) return null
    return {
      people: true,
      heard: forWhom.heard,
      turnDown:
        forWhom.level === 'likely'
          ? () => ({ ...draft, forWhom: turnDown(forWhom), edited: true })
          : null,
      options: forWhom.choices.map((member: TeamMember) => ({
        words: wordsIn(member.name),
        pick: () => ({
          ...draft,
          forWhom: { ...forWhom, found: member, choices: [], level: null },
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
      turnDown:
        open.level === 'likely'
          ? () => ({
              ...draft,
              to: draft.to.map((one) => (one.id === open.id ? turnDown(one) : one)),
              edited: true,
            })
          : null,
      options: open.choices.map((member) => ({
        words: wordsIn(member.name),
        pick: () => ({
          ...draft,
          to: draft.to.map((one) =>
            one.id === open.id ? { ...one, found: member, choices: [], level: null } : one,
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
  // Sounds and short replies no company's name starts or ends with (PLAN-V24 review).
  ...FILLERS,
  'huh',
  'yep',
  'yup',
  'nah',
  'nope',
  'alright',
])

/**
 * Everyday replies that name nothing on their own (PLAN-V24 review): a turn of only these, with
 * the words around a choice, is never a pick or a search. They are left in a name said with them,
 * so "Great Southern Freight" is still searched whole.
 */
const REPLIES: ReadonlySet<string> = new Set([
  'no',
  'right',
  'sure',
  'thing',
  'thanks',
  'thank',
  'you',
  'cheers',
  'ta',
  'cool',
  'great',
  'good',
  'fine',
  'nice',
  'perfect',
  'lovely',
  'awesome',
  'excellent',
  'all',
  'sorry',
  'hello',
  'hi',
  'hey',
  'wait',
  'hang',
  'on',
  'got',
  'sounds',
  'so',
  'well',
  'done',
  'correct',
  'exactly',
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

/** A yes to the one company the card asks about. */
const YES: ReadonlySet<string> = new Set(['yes', 'yeah', 'yep', 'yup'])

/** The whole turn is a yes: "yes", "yeah, please", "yes it is". */
function isYes(words: readonly string[]): boolean {
  return words.some((word) => YES.has(word)) && words.every((word) => AROUND.has(word))
}

/** The whole turn takes a suggestion: a yes, or "use it", "take it", "go with it" (PLAN-V25). */
function takesIt(words: readonly string[]): boolean {
  const take = (word: string): boolean => YES.has(word) || word === 'use' || word === 'take'
  return words.some(take) && words.every((word) => AROUND.has(word))
}

/** The whole turn turns a suggestion down: "no", "not this one", "nope, not that one" (PLAN-V25). */
const NOT_IT: ReadonlySet<string> = new Set([
  'no',
  'nope',
  'nah',
  'not',
  'this',
  'that',
  'one',
  'it',
  'the',
  'wrong',
  'other',
  'another',
  'thanks',
  'please',
])
function turnsItDown(words: readonly string[]): boolean {
  const no = (word: string): boolean => word === 'no' || word === 'nope' || word === 'nah'
  const notIt = words.includes('not') || words.includes('wrong') || words.some(no)
  return words.length > 0 && notIt && words.every((word) => NOT_IT.has(word))
}

/**
 * A whole turn that answers a yes-or-no question on the card (PLAN-V25 T3-2): "yes" or "use it",
 * "no" or "not that one". Null: other words.
 */
export function yesOrNo(said: string): 'yes' | 'no' | null {
  const words = wordsIn(said)
  if (takesIt(words)) return 'yes'
  return turnsItDown(words) ? 'no' : null
}

/**
 * What a turn picks on the card, with no AI, or null when it isn't an answer to the card's
 * question (it goes to the command step, as now). `search`: the companies the card's search list
 * shows now, or null when it shows none (PLAN-V24 choice 19). `asksOne`: the list is the one
 * company the card's find asks about, on a call that needs a company (the PLAN-V24 browser
 * check): then "yes" picks it too, and nowhere else does.
 */
export function pickByVoice(
  draft: CardDraft,
  said: string,
  search: readonly ShownChoice[] | null = null,
  asksOne = false,
): VoicePick | null {
  const question = questionOf(draft, search)
  if (!question) return null
  const words = wordsIn(said)
  const { options } = question
  // A suggestion: "yes" takes it, "not this one" turns it down (PLAN-V25 choice 6).
  if (question.turnDown) {
    const [suggested] = options
    if (suggested && takesIt(words)) return { kind: 'picked', draft: suggested.pick() }
    if (turnsItDown(words)) return { kind: 'picked', draft: question.turnDown() }
  }
  const place = placeOf(words, options.length)
  if (place !== null) {
    const option = options[place]
    return option ? { kind: 'picked', draft: option.pick() } : null
  }
  const [one] = options
  if (asksOne && one && options.length === 1 && isYes(words)) {
    return { kind: 'picked', draft: one.pick() }
  }
  // "The third one" of two companies: a place, not a name to search.
  if (!question.people && placeSaid(words) !== null) return null
  if (question.people && draft.action === 'log_call' && NO_ONE_SAID.has(words.join(' '))) {
    const noOne = options.at(-1)
    return noOne ? { kind: 'picked', draft: noOne.pick() } : null
  }
  const name = words.filter((word) => !AROUND.has(word))
  if (name.length === 0) return null
  // "Great", "sure thing", "thank you": a reply, not a name. Never picked, searched or said back.
  if (name.every((word) => REPLIES.has(word))) return null
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
