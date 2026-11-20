/**
 * The review card's draft (PLAN-V22 T3-3, choices 19, 21 and 24): what a command would do, as the
 * card shows it and the rep changes it. Plain code, so the rules are tested without a screen.
 *
 * - **Made from the command step's answer** (the contract part 1): the company, the person and the
 *   teammates come as `found` (one match), `choices` (two or more, best first) or neither (the
 *   words as heard). A call keeps its note word for word (choice 16).
 * - **What blocks a send** (`missingOf`), in the card's order: a choice still to make ("Which
 *   James?"), or an empty required box. Enter jumps there instead of sending (choice 19).
 * - **A change by voice** (`applyChange`): the command step names one of the card's boxes and the
 *   new value, and a day when it reads as one. A call's parts live on the server's note, so its
 *   changes go as a PATCH (`callPatchOf`).
 * - **The read-back** (choice 21) is the server's sentence until the rep changes something; then
 *   the card says it in its own words, from the boxes.
 * - **How the company was found** (PLAN-V23): by HubSpot's own search (`fromHubspot`), nowhere
 *   (`canAdd`: the card offers "Add to HubSpot"), or by the rep after the command found nothing
 *   (`byHand`). A company found by hand teaches the mic the words heard, once the card is sent
 *   (`learnedOf`, T1-5). A pick from the command's own choices doesn't: the command found it.
 */
import { newIdempotencyKey } from '@/api/client'
import type {
  AssistantChange,
  AssistantCommand,
  AssistantEmailIn,
  AssistantRecipient,
  AssistantTaskIn,
  CallNoteIn,
  CallNoteOut,
  CallNotePatch,
  CallNotePerson,
  CommandSource,
  LearnedNameIn,
  TaskKind,
  TeamMember,
} from '@/api/types'
import { dueDateText, readDueDate, type DueDate } from '@/lib/due-date'

/** The actions that open a review card. A pre-read's card is its own page (choice 24). */
export type CardAction = 'log_call' | 'task' | 'email'

export interface Company {
  key: string
  name: string
}

/** What the command found: one, two or more to pick from, or none (the words as heard). */
export interface Find<T> {
  found: T | null
  choices: readonly T[]
  heard: string
}

/** The company a call or a task is for, and how it was found (PLAN-V23 T1-5, T1-6). */
export interface CompanyFind extends Find<Company> {
  /** Our copy didn't have it, and HubSpot's own search found it: the card says so. */
  fromHubspot: boolean
  /** Neither our copy nor HubSpot has it: the card offers "Add to HubSpot". */
  canAdd: boolean
  /** The rep found it, after the command found nothing: the words heard teach the mic. */
  byHand: boolean
  /** The rep added it to HubSpot from the card. */
  added: boolean
}

/** The longest words a learned name takes (the contract part 2). */
export const LEARNED_MAX = 80

/** A teammate or a Contour address, as the command named them, or as the rep added them. */
export interface Recipient {
  /** Its place on the card. */
  id: string
  heard: string
  found: TeamMember | null
  choices: readonly TeamMember[]
  address: string | null
  /** Why it can't be sent to yet, in the server's words, or null. */
  problem: string | null
}

interface Base {
  /** The Idempotency-Key of the send (a task, an email) or of the save (a call), made once. */
  key: string
  /** Whose draft it is: the signed-in person, or null with sign-in off. */
  by: string | null
  /** The server's read-back (choice 21). */
  readBack: string
  unsure: string | null
  /** The command was said, not typed: the card listens for "send it" (choice 23). */
  spoken: boolean
  /** The rep has changed something since the command: the card says the read-back itself. */
  edited: boolean
  startedAt: string
}

export interface CallDraft extends Base {
  action: 'log_call'
  company: CompanyFind
  person: Find<CallNotePerson>
  /** The note, word for word as said (choice 16). */
  text: string
  source: CommandSource
  calledAt: string
  /** The note's id, once it is saved (`POST /call-notes`). */
  noteId: string | null
}

export interface TaskDraft extends Base {
  action: 'task'
  company: CompanyFind
  subject: string
  /** The "When" box, as said or typed ("Friday"). */
  when: string
  /** The box's words when the server read them, and the day it read. Kept while the box is. */
  whenStart: string
  due: string | null
  kind: TaskKind
  /** For whom. Null: the rep. */
  forWhom: Recipient | null
  body: string
}

export interface EmailDraft extends Base {
  action: 'email'
  to: readonly Recipient[]
  subject: string
  body: string
  company: Company | null
}

export type CardDraft = CallDraft | TaskDraft | EmailDraft

/** The boxes the card has, by name, as `card.boxes` sends them to the command step. */
export const BOXES: Readonly<Record<CardAction, readonly string[]>> = {
  log_call: ['follow-up', 'outcome', 'summary'],
  task: ['subject', 'due', 'kind', 'body'],
  email: ['subject', 'body'],
}

/** Where a send is blocked, as the card marks it (`data-box`). */
export type Box = 'company' | 'person' | 'subject' | 'due' | 'for-whom' | 'to' | 'body'

export const SUBJECT_MAX: Readonly<Record<'task' | 'email', number>> = { task: 200, email: 120 }
export const BODY_MAX: Readonly<Record<'task' | 'email', number>> = { task: 2000, email: 4000 }
export const MOST_PEOPLE = 20

// --- From the command ------------------------------------------------------------------------------

function companyOf(command: AssistantCommand): CompanyFind {
  const company = command.company
  const pick = (hit: { key: string; name: string }): Company => ({ key: hit.key, name: hit.name })
  return {
    found: company?.found ? pick(company.found) : null,
    choices: (company?.choices ?? []).map(pick),
    heard: company?.heard ?? '',
    fromHubspot: company?.from_hubspot === true,
    canAdd: company?.can_add === true,
    byHand: false,
    added: false,
  }
}

/** No company yet: an empty card's, before the rep picks one. */
export const NO_COMPANY: CompanyFind = {
  found: null,
  choices: [],
  heard: '',
  fromHubspot: false,
  canAdd: false,
  byHand: false,
  added: false,
}

/**
 * The company picked on the card. From the command's own choices it was found by the command;
 * anywhere else (the search list, a company like it, one added) the rep found it by hand.
 */
export function pickCompany(
  company: CompanyFind,
  picked: Company,
  how: 'choice' | 'by_hand' | 'added',
): CompanyFind {
  return {
    ...company,
    found: picked,
    choices: [],
    byHand: how !== 'choice',
    added: how === 'added',
  }
}

let nextRecipient = 0

/** A recipient as the command named them. One that is the rep counts as found. */
export function recipientOf(said: AssistantRecipient): Recipient {
  nextRecipient += 1
  return {
    id: `r${nextRecipient}`,
    heard: said.heard,
    found: said.found,
    choices: said.choices,
    address: said.address,
    problem: said.problem,
  }
}

interface Heard {
  command: AssistantCommand
  words: string
  source: CommandSource
}

/** The draft for a command's card, or null when the action opens no card. */
export function draftOf(
  { command, words, source }: Heard,
  by: string | null,
  now: Date = new Date(),
): CardDraft | null {
  const base: Base = {
    key: newIdempotencyKey(),
    by,
    readBack: command.read_back,
    unsure: command.unsure,
    spoken: source === 'mic',
    edited: false,
    startedAt: now.toISOString(),
  }
  switch (command.action) {
    case 'log_call':
      return {
        ...base,
        action: 'log_call',
        company: companyOf(command),
        person: {
          found: command.person?.found ?? null,
          choices: command.person?.choices ?? [],
          heard: command.person?.heard ?? '',
        },
        // The note as said; with none, the whole words (choice 16's fallback).
        text: command.note_text?.trim() ? command.note_text : words,
        source,
        calledAt: now.toISOString(),
        noteId: null,
      }
    case 'task': {
      const task = command.task
      const when = task ? task.due_words.trim() || dueDateText(task.due) : ''
      const owner = task?.owner ?? null
      return {
        ...base,
        action: 'task',
        company: companyOf(command),
        subject: task?.subject ?? '',
        when,
        whenStart: when,
        due: task?.due ?? null,
        kind: task?.kind ?? 'todo',
        // A task for the rep themself is "You", not a teammate to check.
        forWhom: owner && !owner.found?.is_me ? recipientOf(owner) : null,
        body: '',
      }
    }
    case 'email':
      return {
        ...base,
        action: 'email',
        to: (command.email?.to ?? []).map(recipientOf),
        subject: command.email?.subject ?? '',
        body: command.email?.body ?? '',
        company: companyOf(command).found,
      }
    default:
      return null
  }
}

/**
 * An empty task or email card (PLAN-V23 T4-3), from Today's "Add task" and "Email the team" or
 * Ctrl+K. No AI read anything, so the card says its read-back from the boxes from the start.
 */
export function emptyDraftOf(
  action: 'task' | 'email',
  by: string | null,
  now: Date = new Date(),
): TaskDraft | EmailDraft {
  const base: Base = {
    key: newIdempotencyKey(),
    by,
    readBack: '',
    unsure: null,
    spoken: false,
    edited: true,
    startedAt: now.toISOString(),
  }
  if (action === 'email') {
    return { ...base, action: 'email', to: [], subject: '', body: '', company: null }
  }
  return {
    ...base,
    action: 'task',
    company: NO_COMPANY,
    subject: '',
    when: '',
    whenStart: '',
    due: null,
    kind: 'todo',
    forWhom: null,
    body: '',
  }
}

/**
 * The name the card teaches the mic once it is sent (PLAN-V23 T1-5): the words heard, and the
 * company the rep found by hand after the command found nothing. Null when there is nothing to
 * teach: an email, a company the command found, or no words heard.
 */
export function learnedOf(draft: CardDraft): LearnedNameIn | null {
  if (draft.action === 'email') return null
  const { company } = draft
  const heard = company.heard.trim()
  if (!company.byHand || company.found === null || heard === '' || heard.length > LEARNED_MAX) {
    return null
  }
  return { heard, company_key: company.found.key }
}

// --- What blocks a send ---------------------------------------------------------------------------

/** A choice is still to make: two or more matched, and none is picked yet. */
export function isPending<T>(find: Find<T>): boolean {
  return find.found === null && find.choices.length > 0
}

function recipientBlocked(one: Recipient): boolean {
  return one.problem !== null || (one.found === null && one.address === null)
}

/** The "When" box, read: the server's day while the box is as it was, else the words. */
export function dueOf(draft: TaskDraft, today: string): DueDate {
  if (draft.due !== null && draft.when.trim() === draft.whenStart.trim()) {
    return { kind: 'date', date: draft.due, moved: false }
  }
  return readDueDate(draft.when, today)
}

/** The first thing to do before the card can send, in the card's order, or null. */
export function missingOf(draft: CardDraft, today: string): Box | null {
  switch (draft.action) {
    case 'log_call':
      if (draft.company.found === null) return 'company'
      if (isPending(draft.person)) return 'person'
      return null
    case 'task': {
      if (draft.company.found === null) return 'company'
      if (draft.subject.trim() === '') return 'subject'
      if (dueOf(draft, today).kind !== 'date') return 'due'
      if (draft.forWhom && recipientBlocked(draft.forWhom)) return 'for-whom'
      return null
    }
    case 'email':
      if (draft.to.length === 0 || draft.to.length > MOST_PEOPLE) return 'to'
      if (draft.to.some(recipientBlocked)) return 'to'
      if (draft.subject.trim() === '') return 'subject'
      if (draft.body.trim() === '') return 'body'
      return null
  }
}

// --- What each send asks the server -------------------------------------------------------------

/** The call note to save, once the company (and the person, if asked) is picked. */
export function noteBodyOf(draft: CallDraft): CallNoteIn | null {
  const company = draft.company.found
  if (company === null || isPending(draft.person)) return null
  return {
    company_key: company.key,
    contact_id: draft.person.found?.id ?? null,
    text: draft.text.trim(),
    source: draft.source,
    called_at: draft.calledAt,
  }
}

export function taskBodyOf(draft: TaskDraft, today: string): AssistantTaskIn | null {
  const company = draft.company.found
  const due = dueOf(draft, today)
  if (company === null || due.kind !== 'date' || missingOf(draft, today) !== null) return null
  return {
    company_key: company.key,
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    due: due.date,
    kind: draft.kind,
    owner_id: draft.forWhom?.found?.owner_id ?? null,
  }
}

export function emailBodyOf(draft: EmailDraft): AssistantEmailIn | null {
  if (missingOf(draft, '') !== null) return null
  const ownerIds = draft.to.flatMap((one) => (one.found ? [one.found.owner_id] : []))
  const emails = draft.to.flatMap((one) => (!one.found && one.address ? [one.address] : []))
  return {
    owner_ids: [...new Set(ownerIds)],
    emails: [...new Set(emails)],
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    company_key: draft.company?.key ?? null,
  }
}

// --- A change by voice ------------------------------------------------------------------------------

const KIND_WORDS: readonly [RegExp, TaskKind][] = [
  [/\bcall\b|\bphone\b|\bring\b/, 'call'],
  [/\bemail\b|\be-mail\b|\bmail\b/, 'email'],
  [/\bto ?do\b|\btask\b/, 'todo'],
]

function kindOf(value: string): TaskKind | null {
  const words = value.toLowerCase()
  return KIND_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? null
}

/**
 * A task's or an email's draft with the change made, or null when the card can't make it (a box
 * it hasn't, or a kind it can't read). A call's changes go to the server (`callPatchOf`).
 */
export function applyChange(draft: CardDraft, change: AssistantChange): CardDraft | null {
  const value = change.value.trim()
  if (draft.action === 'log_call') return null
  switch (change.box) {
    case 'subject':
      return value
        ? { ...draft, subject: value.slice(0, SUBJECT_MAX[draft.action]), edited: true }
        : null
    case 'body':
      return value ? { ...draft, body: value.slice(0, BODY_MAX[draft.action]), edited: true } : null
    case 'due':
      if (draft.action !== 'task' || !value) return null
      // The server's day for these words, when it read one: the box shows the words.
      return { ...draft, when: value, whenStart: value, due: change.day, edited: true }
    case 'kind': {
      const kind = draft.action === 'task' ? kindOf(value) : null
      return draft.action === 'task' && kind ? { ...draft, kind, edited: true } : null
    }
    default:
      return null
  }
}

/**
 * A change to a call, as a PATCH of its note: the first follow-up's day, how it went, or the
 * summary. Null when it can't be made (no day, an outcome HubSpot doesn't have).
 */
export function callPatchOf(
  note: CallNoteOut,
  change: AssistantChange,
  outcomes: readonly string[],
): CallNotePatch | null {
  const value = change.value.trim()
  switch (change.box) {
    case 'follow-up': {
      if (!change.day) return null
      const tasks = note.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        due: task.due,
        due_words: task.due_words,
        kind: task.kind,
      }))
      const [first, ...rest] = tasks
      return {
        tasks: first
          ? [{ ...first, due: change.day, due_words: value }, ...rest]
          : [{ subject: FOLLOW_UP_SUBJECT, due: change.day, due_words: value, kind: 'call' }],
      }
    }
    case 'outcome': {
      const outcome = outcomes.find((one) => one.toLowerCase() === value.toLowerCase())
      return outcome ? { outcome: outcome as CallNotePatch['outcome'] } : null
    }
    case 'summary':
      return value ? { summary: value } : null
    default:
      return null
  }
}

/** A follow-up added by voice to a call that had none (TBC). */
export const FOLLOW_UP_SUBJECT = 'Follow up'

// --- "Send it" (choice 23) -------------------------------------------------------------------------

/** The words alone: lower case, no marks. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The whole of what was heard must be one of these (choice 23), the same as the server's
 * `SEND_WORDS` and `CANCEL_WORDS` (`assistant_form.py`). Words that merely end in "send it", like
 * "don't send it", never send, and talk nearby is ignored.
 */
const SEND_WORDS: ReadonlySet<string> = new Set([
  'send',
  'send it',
  'send it now',
  'send now',
  'yes send it',
  'ok send it',
  'okay send it',
])
const CANCEL_WORDS: ReadonlySet<string> = new Set(['cancel', 'cancel it', 'cancel that'])

export function sendOrCancel(text: string): 'send' | 'cancel' | null {
  const words = plain(text)
  if (SEND_WORDS.has(words)) return 'send'
  if (CANCEL_WORDS.has(words)) return 'cancel'
  return null
}

/**
 * "Later", as a whole turn (PLAN-V24 choice 13): what Later does on a call, and Cancel on a task
 * or an email. TBC at Al-khair's look.
 */
const LATER_WORDS: ReadonlySet<string> = new Set([
  'later',
  'later please',
  'do it later',
  'send it later',
  'send later',
  'keep it for later',
  'save it for later',
])

/**
 * The card's own words in a conversation (PLAN-V24 T2-3), read by the code with no AI: "send it"
 * sends; "later" and "cancel" both do what the card's Later or Cancel button does.
 */
export function cardWordsOf(text: string): 'send' | 'later' | null {
  const words = plain(text)
  if (SEND_WORDS.has(words)) return 'send'
  if (CANCEL_WORDS.has(words) || LATER_WORDS.has(words)) return 'later'
  return null
}

// --- The read-back once changed ------------------------------------------------------------------

function namesOf(to: readonly Recipient[]): string {
  return to.map((one) => one.found?.name ?? one.address ?? one.heard).join(', ')
}

/** "Mon 30 Nov", as the server's read-back says a day; with its year only when that isn't this one. */
function readBackDay(date: string, today: string): string {
  const text = dueDateText(date)
  return date.slice(0, 4) === today.slice(0, 4) ? text.replace(/ \d{4}$/, '') : text
}

/**
 * The card's first line: the server's, or the card's own once the rep has changed something. A
 * call's comes from the picks and, once sorted, the note's first follow-up (`note`).
 */
export function readBackOf(
  draft: CardDraft,
  today: string,
  note?: Pick<CallNoteOut, 'tasks'>,
): string {
  if (!draft.edited) return draft.readBack
  switch (draft.action) {
    case 'log_call': {
      const company = draft.company.found?.name ?? draft.company.heard
      const who = draft.person.found?.name
      const call = who ? `Log a call with ${who} at ${company}.` : `Log a call with ${company}.`
      const first = note?.tasks[0]
      return first ? `${call} Follow-up task on ${readBackDay(first.due, today)}.` : call
    }
    case 'task': {
      const due = dueOf(draft, today)
      const who = draft.forWhom?.found?.name ?? 'you'
      const day = due.kind === 'date' ? `, due ${readBackDay(due.date, today)}` : ''
      // An empty card (PLAN-V23 T4-3) has no words yet: "Add a task for you."
      const what = draft.subject.trim()
      return what ? `Add a task for ${who}: ${what}${day}.` : `Add a task for ${who}${day}.`
    }
    case 'email': {
      // An empty card has no one and no subject yet: "Email the team."
      const to = namesOf(draft.to) || 'the team'
      const about = draft.subject.trim()
      return about ? `Email ${to}: ${about}.` : `Email ${to}.`
    }
  }
}
