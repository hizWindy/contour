/**
 * The review card's drafts, kept in this browser (PLAN-V22 choice 22): a task or an email that
 * wasn't sent stays here, so nothing said is lost.
 *
 * - **Kept** when the rep cancels the card (Esc: "the draft is kept", choice 19), and when its
 *   5 second hold starts. **Dropped** once it is sent.
 * - **So a page closed in the 5 seconds** sends nothing, and the draft is still here: the hold's
 *   timer dies with the page, and the next page offers it once, in a toast with Open.
 * - **A call is kept here only before its note is saved** (its company not picked yet). Once saved,
 *   the note waits in Call logs' To confirm.
 * - **Each person's drafts are their own** (as call notes' are): a signed-in person has an entry of
 *   their own. The newest 10 are kept.
 * - **A browser that blocks storage** keeps them while the page is open: every read and write is in
 *   try/catch, and the card works without it.
 */
import type { CallDraft, CardDraft, EmailDraft, TaskDraft } from './draft'

const STORAGE_KEY = 'assistant.card-drafts'
const MOST = 10

export type KeptDraft = TaskDraft | EmailDraft | CallDraft

/** As stored: `holding` while its 5 second hold runs, so a page closed meanwhile is known. */
type Stored = KeptDraft & { holding?: boolean }

/** Each entry's drafts, for a browser that blocks storage. */
const inMemory = new Map<string, Stored[]>()
/** Entries whose storage refused the last write: this page's own copy is newer. */
const behind = new Set<string>()

function entryOf(by: string | null): string {
  return by === null ? STORAGE_KEY : `${STORAGE_KEY}.${by}`
}

/** A stored draft, checked enough to show it again. Anything else (an old shape) is dropped. */
function asKept(value: unknown, by: string | null): Stored | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  const text = (name: string): boolean => typeof item[name] === 'string'
  if (!text('key') || !text('readBack') || !text('startedAt')) return null
  const holding = item.holding === true
  if (item.action === 'log_call' && text('text') && item.noteId === null) {
    return { ...(item as unknown as CallDraft), by, holding }
  }
  if (!text('subject') || !text('body')) return null
  if (item.action === 'task' && text('when') && text('whenStart') && text('kind')) {
    return { ...(item as unknown as TaskDraft), by, holding }
  }
  if (item.action === 'email' && Array.isArray(item.to)) {
    return { ...(item as unknown as EmailDraft), by, holding }
  }
  return null
}

function readAll(by: string | null): Stored[] {
  const entry = entryOf(by)
  if (behind.has(entry)) return [...(inMemory.get(entry) ?? [])]
  let raw: string | null
  try {
    raw = window.localStorage.getItem(entry)
  } catch {
    return [...(inMemory.get(entry) ?? [])]
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.flatMap((value) => {
          const kept = asKept(value, by)
          return kept ? [kept] : []
        })
      : []
  } catch {
    return []
  }
}

function writeAll(by: string | null, drafts: readonly Stored[]): void {
  const entry = entryOf(by)
  const newest = [...drafts].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MOST)
  inMemory.set(entry, newest)
  try {
    if (newest.length === 0) window.localStorage.removeItem(entry)
    else window.localStorage.setItem(entry, JSON.stringify(newest))
    behind.delete(entry)
  } catch {
    // Storage is blocked or full: this page's own copy stands in.
    behind.add(entry)
  }
}

/**
 * Keeps a draft. A call whose note is saved isn't kept: it waits in Call logs. `holding`: its hold
 * has started, so if the page closes before it goes, the next page offers it (`cutHolds`).
 */
export function keepCardDraft(draft: CardDraft, holding = false): void {
  if (draft.action === 'log_call' && draft.noteId !== null) return
  const kept: Stored = { ...draft, holding }
  writeAll(draft.by, [kept, ...readAll(draft.by).filter((one) => one.key !== draft.key)])
}

/**
 * The drafts a closed page cut off in their hold (choice 22), each offered once: they stay kept,
 * no longer marked as holding.
 */
export function cutHolds(by: string | null): KeptDraft[] {
  const drafts = readAll(by)
  const cut = drafts.filter((one) => one.holding === true)
  if (cut.length > 0)
    writeAll(
      by,
      drafts.map((one) => ({ ...one, holding: false })),
    )
  return cut.map(({ holding: _holding, ...draft }) => draft)
}

/** The draft went, or the rep threw it away. */
export function dropCardDraft(by: string | null, key: string): void {
  const drafts = readAll(by)
  if (drafts.some((one) => one.key === key)) {
    writeAll(
      by,
      drafts.filter((one) => one.key !== key),
    )
  }
}

/** The person's kept drafts, newest first. */
export function cardDrafts(by: string | null): KeptDraft[] {
  return readAll(by).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
