/**
 * The edit layers of a call script (PLAN-V14, "The edit layers"): a person's own line edits sit over
 * the draft (Claude's script, or the free one). Style notes change the draft itself, so they are not
 * here; this is only the top layer, "Yours".
 *
 * A line edit belongs to a slot: `opener.0`, `why_now.1`, `question.2`, `if_they_say.0` or `goal`.
 * An edited line has no sources and is never removed: if the draft has fewer lines after Research
 * again, the edit is shown after the draft's lines. A follow-up question isn't editable; it follows
 * its question. Pure code, so the card, "Copy script" and the tests all see the same script.
 */
import type { CallGuide, GuideLine, GuideObjection, GuideQuestion } from './playbook'

/** The parts of a script whose lines can be edited, by the name used in a slot. */
export type ScriptSection = 'opener' | 'why_now' | 'question' | 'if_they_say'

export const GOAL_SLOT = 'goal'

/** One saved line edit, as the API gives it (`GET /script-edits`). */
export interface LineEdit {
  slot: string
  text: string
}

interface Place {
  section: ScriptSection | 'goal'
  index: number
}

const SECTIONS: readonly ScriptSection[] = ['opener', 'why_now', 'question', 'if_they_say']
const SLOT = /^(opener|why_now|question|if_they_say)\.(\d{1,3})$/

/** Where a slot points, or null for a slot this script doesn't have (it is ignored). */
export function parseSlot(slot: string): Place | null {
  if (slot === GOAL_SLOT) return { section: 'goal', index: 0 }
  const match = SLOT.exec(slot)
  if (!match) return null
  const section = SECTIONS.find((name) => name === match[1])
  return section ? { section, index: Number(match[2]) } : null
}

/** The slot of a line shown at `index` in a section: its own when it was edited, else its place. */
export function lineSlot(section: ScriptSection, index: number, line: GuideLine): string {
  return line.edited?.slot ?? `${section}.${String(index)}`
}

/**
 * The draft under a guide, as one string: it changes when a new script is made (Research again),
 * but not when the person edits or resets a line, because an edited line keeps the draft's words.
 */
export function draftKey(guide: CallGuide): string {
  // An edit past the draft's end has no draft words, so it adds nothing.
  const words = (line: GuideLine): string | null => (line.edited ? line.edited.draft : line.text)
  return [
    guide.madeFrom,
    ...guide.opener.map(words),
    ...guide.whyNow.map(words),
    ...guide.questions.map(words),
    ...guide.ifTheySay.map((item) => words(item.answer)),
    guide.goal ? words(guide.goal) : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n')
}

/** The person's line over the draft's: their text, no sources, marked Yours. */
function yours(slot: string, text: string, draft: GuideLine | undefined): GuideLine {
  return {
    text,
    why: null,
    sources: [],
    icon: draft?.icon ?? 'standard',
    edited: { slot, draft: draft?.text ?? null },
  }
}

/**
 * Lays the edits of one section over its draft lines. An edit in a slot the draft has replaces that
 * line in place; an edit past the draft's end comes after the draft's lines, in slot order.
 */
function layer<T>(
  section: ScriptSection,
  draft: T[],
  edits: ReadonlyMap<string, string>,
  lineOf: (item: T) => GuideLine,
  over: (item: T | undefined, line: GuideLine) => T,
): T[] {
  const mine = [...edits].flatMap(([slot, text]) => {
    const place = parseSlot(slot)
    return place?.section === section ? [{ slot, text, index: place.index }] : []
  })
  if (mine.length === 0) return draft
  const byIndex = new Map(mine.map((edit) => [edit.index, edit]))
  const placed = draft.map((item, index) => {
    const edit = byIndex.get(index)
    return edit ? over(item, yours(edit.slot, edit.text, lineOf(item))) : item
  })
  const past = mine
    .filter((edit) => edit.index >= draft.length)
    .sort((a, b) => a.index - b.index)
    .map((edit) => over(undefined, yours(edit.slot, edit.text, undefined)))
  return [...placed, ...past]
}

/**
 * The script a person sees: their line edits over the draft, by slot. With no edits, the draft
 * itself comes back unchanged. An empty or blank edit is ignored, so the draft line shows.
 */
export function applyEdits(guide: CallGuide, edits: readonly LineEdit[]): CallGuide {
  // One edit per slot; a later one wins (the API keeps one row per slot anyway).
  const bySlot = new Map<string, string>()
  for (const edit of edits) {
    const text = edit.text.trim()
    if (text && parseSlot(edit.slot)) bySlot.set(edit.slot, text)
  }
  if (bySlot.size === 0) return guide

  const goalText = bySlot.get(GOAL_SLOT)
  return {
    ...guide,
    opener: layer(
      'opener',
      guide.opener,
      bySlot,
      (item) => item,
      (_, line) => line,
    ),
    whyNow: layer(
      'why_now',
      guide.whyNow,
      bySlot,
      (item) => item,
      (_, line) => line,
    ),
    questions: layer(
      'question',
      guide.questions,
      bySlot,
      (item) => item,
      // A follow-up stays with its question: the draft's, or none past the end.
      (item, line): GuideQuestion => ({ ...line, followUps: item?.followUps ?? [] }),
    ),
    ifTheySay: layer(
      'if_they_say',
      guide.ifTheySay,
      bySlot,
      (item) => item.answer,
      // Past the end there is no pushback to answer, so `theySay` is empty.
      (item, line): GuideObjection => ({ theySay: item?.theySay ?? '', answer: line }),
    ),
    goal: goalText ? yours(GOAL_SLOT, goalText, guide.goal ?? undefined) : guide.goal,
  }
}
