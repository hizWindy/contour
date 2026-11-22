/**
 * Which keys the review card leaves to its boxes (PLAN-V22 choice 19): a key typed into one of its
 * own boxes, or through an input method building a word.
 */

/** Inputs that take no typed text: none is on the card today, but a key there isn't typing. */
const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'reset', 'submit'])

/**
 * A key typed into one of the card's own boxes (its inputs and text areas), not one the card takes.
 * The card's own rule, kept here rather than the shared `isTyping` (`lib/is-typing.ts`): reaching
 * into the first visit's files from the card's code splits them into files of their own, which
 * makes the first visit bigger (PLAN-V22 T3-6, as T3-1 found for the bar). A test checks the two
 * agree on every part the card has.
 */
export function inTextBox(element: EventTarget | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLInputElement && !NOT_TEXT.has(element.type)
}

/** A key that types: into a box, or through an input method building a word. */
export function typingKey(event: globalThis.KeyboardEvent): boolean {
  return event.isComposing || event.key === 'Process' || inTextBox(event.target)
}

// --- The suggestion part's keys (PLAN-V25 T1-2, choice 6) ----------------------------------------

/** The most choices shown at once (choice 4): Search finds the rest. */
export const MOST_CHOICES = 3

/**
 * The keys 1, 2 and 3 on the card (choice 6): the first open question's choice of that number,
 * in the card's order. True: one was picked.
 */
export function pickByKey(root: HTMLElement | null, key: string): boolean {
  if (!/^[1-3]$/.test(key)) return false
  const open = root?.querySelector('[data-slot=suggest][data-level=unsure]')
  const choice = open?.querySelector<HTMLButtonElement>(`[data-slot=card-choice][data-n="${key}"]`)
  if (!choice) return false
  choice.click()
  return true
}

/** The "Use it" of a suggestion open where a send waits, for Enter (choice 6), or null. */
export function suggestionIn(root: HTMLElement | null, box: string): HTMLButtonElement | null {
  return (
    root?.querySelector<HTMLButtonElement>(`[data-box="${box}"] [data-slot=suggest-use]`) ?? null
  )
}
