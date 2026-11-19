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
