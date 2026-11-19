/**
 * True when a key press is typing (PLAN-V22 T3-1): it goes into a text box, a select or editable
 * text, or through an input method (a keyboard that builds a word from several keys, like
 * Japanese or Chinese). A page's own letter keys, like V for the voice bar, stay out of the way
 * then, so V in a box types a "v".
 *
 * One shared check. Five older files keep their own copy (`EDITABLE`) for now: moving them is its
 * own task.
 */

/** Inputs that take no typed text: a key on one of them isn't typing. */
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Editable text that isn't a form field. */
const EDITABLE_TEXT = '[contenteditable]:not([contenteditable="false"])'

export function isTyping(event: Pick<KeyboardEvent, 'target' | 'isComposing' | 'key'>): boolean {
  // An input method is building a word: the browser says so, or names the key "Process".
  if (event.isComposing || event.key === 'Process') return true
  const target = event.target
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type)
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target.closest(EDITABLE_TEXT) !== null
}
