/**
 * The note being written for a call, kept in the browser until the server has it (PLAN-V17
 * "Nothing is ever lost"). A refresh, a closed panel or a failed save keeps it, and Log call for
 * the same call (the company and the person) shows it again. It goes only when the server has
 * the note, or when the rep empties it.
 *
 * The draft holds the save's Idempotency-Key, made when the draft starts, so Try again after a
 * failure can never make two notes.
 *
 * **Each person's drafts are their own** (T3-8). A signed-in person has a localStorage entry of
 * their own, so on a shared browser the next rep never sees, or saves, the last rep's note. With
 * sign-in off there is no one to tell apart, and every draft shares one entry, as before. A draft
 * knows whose it is (`owner`), so a save that answers after a sign-out still finds it.
 *
 * **Signing out** (`forgetDrafts`) drops this page's own copy of the person's drafts, but never a
 * note that isn't saved yet: those stay in the person's entry, and Log call shows them when they
 * sign in again.
 *
 * An entry keeps the newest 50 drafts. A browser that blocks storage keeps drafts only while the
 * page is open, still apart by person: every read and write is in try/catch.
 */
import { newIdempotencyKey } from '@/api/client'
import { onSignOut, type SignIn } from '@/api/hooks/auth'
import type { CallNoteSource } from '@/api/v17'

/** The entry with sign-in off. A signed-in person's entry adds their id to it. */
const STORAGE_KEY = 'companies.call-note-drafts'
const MAX_DRAFTS = 50

/** Whose drafts: the signed-in person's id, or null with sign-in off. */
export type DraftOwner = string | null

export interface FollowUpDraft {
  /** What to do, as typed. */
  subject: string
  /** When, as typed ("next tue"). Read by `readDueDate` when the note is saved. */
  when: string
}

export interface NoteDraft {
  /** Whose draft it is: it is kept in that person's entry. */
  owner: DraftOwner
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

/** Each entry's drafts, kept here too, for a browser that blocks storage. By entry. */
const inMemory = new Map<string, Drafts>()
/** Entries whose storage refused the last write: this page's own copy is newer. */
const behind = new Set<string>()

/** Whose drafts Log call works with: the signed-in person's, or the shared ones with sign-in off. */
export function draftOwner(signIn: SignIn | undefined): DraftOwner {
  return signIn?.state === 'signed_in' ? signIn.user.id : null
}

function entryOf(owner: DraftOwner): string {
  return owner === null ? STORAGE_KEY : `${STORAGE_KEY}.${owner}`
}

/** The call a draft belongs to: the company and the person. */
export function callId(companyKey: string, contactId: string | null): string {
  return `${companyKey}|${contactId ?? ''}`
}

/** A new, empty draft for a call, with its own key. */
export function startDraft(
  owner: DraftOwner,
  companyKey: string,
  person: { id: string; name: string } | null,
  now: Date = new Date(),
): NoteDraft {
  const at = now.toISOString()
  return {
    owner,
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

/**
 * A stored draft, checked field by field. Anything else (an old shape, a hand edit) is dropped.
 * Whose it is comes from the entry it was read from, never from the draft itself, so a draft
 * kept before people had their own entries reads as the shared one it is.
 */
function asDraft(value: unknown, owner: DraftOwner): NoteDraft | null {
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
    owner,
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

function readAll(owner: DraftOwner): Drafts {
  const entry = entryOf(owner)
  // Storage that refused the last write is behind: this page's own copy is newer.
  if (behind.has(entry)) return { ...inMemory.get(entry) }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(entry)
  } catch {
    return { ...inMemory.get(entry) }
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
      const draft = asDraft(value, owner)
      if (draft) drafts[callId(draft.companyKey, draft.contactId)] = draft
    }
  }
  return drafts
}

function writeAll(owner: DraftOwner, drafts: Drafts): void {
  const entry = entryOf(owner)
  const newest = Object.values(drafts)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_DRAFTS)
  const kept: Drafts = {}
  for (const draft of newest) kept[callId(draft.companyKey, draft.contactId)] = draft
  inMemory.set(entry, kept)
  try {
    window.localStorage.setItem(entry, JSON.stringify(kept))
    behind.delete(entry)
  } catch {
    // A browser that blocks storage keeps the drafts while the page is open.
    behind.add(entry)
  }
}

/** The person's draft for this call, or null. */
export function readDraft(
  owner: DraftOwner,
  companyKey: string,
  contactId: string | null,
): NoteDraft | null {
  return readAll(owner)[callId(companyKey, contactId)] ?? null
}

/** The person's newest draft for the company, whoever the call was with, or null. */
export function newestDraft(owner: DraftOwner, companyKey: string): NoteDraft | null {
  return (
    Object.values(readAll(owner))
      .filter((draft) => draft.companyKey === companyKey)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  )
}

/** The person's stored draft that holds this key, wherever it is now (the call may have moved). */
export function draftWithKey(owner: DraftOwner, key: string): NoteDraft | null {
  return Object.values(readAll(owner)).find((draft) => draft.key === key) ?? null
}

/** Keeps the draft for its call, in its owner's entry. An empty draft is removed instead. */
export function keepDraft(draft: NoteDraft): void {
  const drafts = readAll(draft.owner)
  const id = callId(draft.companyKey, draft.contactId)
  if (isEmptyDraft(draft)) {
    if (drafts[id]?.key !== draft.key) return
    // Removing the call's own draft, not a newer one that replaced it.
    delete drafts[id]
  } else {
    drafts[id] = draft
  }
  writeAll(draft.owner, drafts)
}

/**
 * Removes the person's draft for this call. With `key`, only if the stored draft still holds that
 * key, so a newer draft for the same call is never lost.
 */
export function dropDraft(
  owner: DraftOwner,
  companyKey: string,
  contactId: string | null,
  key?: string,
): void {
  const drafts = readAll(owner)
  const id = callId(companyKey, contactId)
  const stored = drafts[id]
  if (!stored || (key !== undefined && stored.key !== key)) return
  delete drafts[id]
  writeAll(owner, drafts)
}

/**
 * The person signed out: this page drops its own copy of their drafts. The drafts themselves stay
 * in the person's entry, so Log call shows them when they sign in again. Where storage refused
 * the last write, this page's copy is the only one, and dropping it would lose a note that isn't
 * saved yet: it stays, under the person, until the page closes.
 */
export function forgetDrafts(owner: string): void {
  const entry = entryOf(owner)
  if (!behind.has(entry)) inMemory.delete(entry)
}

onSignOut(forgetDrafts)
