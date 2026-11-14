/**
 * The note being written for a call, kept in the browser until the server has it (PLAN-V17
 * "Nothing is ever lost"). A refresh, a closed panel or a failed save keeps it, and Log call for
 * the same call (the company and the person) shows it again. It goes only when the server has
 * the note, or when the rep empties it.
 *
 * The draft holds the save's Idempotency-Key, made when the draft starts, so Try again after a
 * failure can never make two notes.
 *
 * One localStorage entry holds every draft, newest kept, at most 50. A browser that blocks
 * storage keeps drafts only while the page is open: every read and write is in try/catch.
 */
import { newIdempotencyKey } from '@/api/client'
import type { CallNoteSource } from '@/api/v17'

const STORAGE_KEY = 'companies.call-note-drafts'
const MAX_DRAFTS = 50

export interface FollowUpDraft {
  /** What to do, as typed. */
  subject: string
  /** When, as typed ("next tue"). Read by `readDueDate` when the note is saved. */
  when: string
}

export interface NoteDraft {
  /** The save's Idempotency-Key. */
  key: string
  companyKey: string
  /** The person the call was with, or null for no one in particular. */
  contactId: string | null
  /** Their name, so the draft can show who it was with before the company's people load. */
  contactName: string | null
  text: string
  /** `typed` for now; the mic (T3-4) makes it `mic`. */
  source: Extract<CallNoteSource, 'typed' | 'mic'>
  outcome: string | null
  /** When the note view first opened for this call, sent as `called_at`. */
  calledAt: string
  /** The follow-up typed by hand while the AI is off, or null. */
  followUp: FollowUpDraft | null
  /** When it last changed, so the newest draft for a company can be found. */
  updatedAt: string
}

type Drafts = Record<string, NoteDraft>

/** Drafts kept here too, for a browser that blocks storage. */
let inMemory: Drafts = {}
let storageBroken = false

/** The call a draft belongs to: the company and the person. */
export function callId(companyKey: string, contactId: string | null): string {
  return `${companyKey}|${contactId ?? ''}`
}

/** A new, empty draft for a call, with its own key. */
export function startDraft(
  companyKey: string,
  person: { id: string; name: string } | null,
  now: Date = new Date(),
): NoteDraft {
  const at = now.toISOString()
  return {
    key: newIdempotencyKey(),
    companyKey,
    contactId: person?.id ?? null,
    contactName: person?.name ?? null,
    text: '',
    source: 'typed',
    outcome: null,
    calledAt: at,
    followUp: null,
    updatedAt: at,
  }
}

/** Nothing worth keeping: no text, no outcome and no follow-up. */
export function isEmptyDraft(draft: NoteDraft): boolean {
  const followUp = draft.followUp
  return (
    draft.text.trim() === '' &&
    draft.outcome === null &&
    (followUp === null || (followUp.subject.trim() === '' && followUp.when.trim() === ''))
  )
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function asFollowUp(value: unknown): FollowUpDraft | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object') return undefined
  const { subject, when } = value as Record<string, unknown>
  return isText(subject) && isText(when) ? { subject, when } : undefined
}

/** A stored draft, checked field by field. Anything else (an old shape, a hand edit) is dropped. */
function asDraft(value: unknown): NoteDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  const followUp = asFollowUp(item.followUp)
  if (
    !isText(item.key) ||
    !isText(item.companyKey) ||
    !isTextOrNull(item.contactId) ||
    !isText(item.text) ||
    (item.source !== 'typed' && item.source !== 'mic') ||
    !isTextOrNull(item.outcome) ||
    !isText(item.calledAt) ||
    followUp === undefined ||
    !isText(item.updatedAt)
  ) {
    return null
  }
  return {
    key: item.key,
    companyKey: item.companyKey,
    contactId: item.contactId,
    contactName: isText(item.contactName) ? item.contactName : null,
    text: item.text,
    source: item.source,
    outcome: item.outcome,
    calledAt: item.calledAt,
    followUp,
    updatedAt: item.updatedAt,
  }
}

function readAll(): Drafts {
  // Storage that refused the last write is behind: this page's own copy is newer.
  if (storageBroken) return { ...inMemory }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return { ...inMemory }
  }
  let parsed: unknown = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    // Text that isn't ours: start again.
  }
  const drafts: Drafts = {}
  if (typeof parsed === 'object' && parsed !== null) {
    for (const value of Object.values(parsed)) {
      const draft = asDraft(value)
      if (draft) drafts[callId(draft.companyKey, draft.contactId)] = draft
    }
  }
  return drafts
}

function writeAll(drafts: Drafts): void {
  const newest = Object.values(drafts)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_DRAFTS)
  const kept: Drafts = {}
  for (const draft of newest) kept[callId(draft.companyKey, draft.contactId)] = draft
  inMemory = kept
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
    storageBroken = false
  } catch {
    // A browser that blocks storage keeps the drafts while the page is open.
    storageBroken = true
  }
}

/** The draft for this call, or null. */
export function readDraft(companyKey: string, contactId: string | null): NoteDraft | null {
  return readAll()[callId(companyKey, contactId)] ?? null
}

/** The newest draft for the company, whoever the call was with, or null. */
export function newestDraft(companyKey: string): NoteDraft | null {
  return (
    Object.values(readAll())
      .filter((draft) => draft.companyKey === companyKey)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  )
}

/** The stored draft that holds this key, wherever it is now (the person may have changed). */
export function draftWithKey(key: string): NoteDraft | null {
  return Object.values(readAll()).find((draft) => draft.key === key) ?? null
}

/** Keeps the draft for its call. An empty draft is removed instead. */
export function keepDraft(draft: NoteDraft): void {
  const drafts = readAll()
  const id = callId(draft.companyKey, draft.contactId)
  if (isEmptyDraft(draft)) {
    if (drafts[id]?.key !== draft.key) return
    // Removing the call's own draft, not a newer one that replaced it.
    delete drafts[id]
  } else {
    drafts[id] = draft
  }
  writeAll(drafts)
}

/**
 * Removes the draft for this call. With `key`, only if the stored draft still holds that key, so a
 * newer draft for the same call is never lost.
 */
export function dropDraft(companyKey: string, contactId: string | null, key?: string): void {
  const drafts = readAll()
  const id = callId(companyKey, contactId)
  const stored = drafts[id]
  if (!stored || (key !== undefined && stored.key !== key)) return
  delete drafts[id]
  writeAll(drafts)
}
