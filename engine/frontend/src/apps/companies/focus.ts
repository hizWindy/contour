/**
 * Where focus goes when the prep panel or the company's dialog closes, so the keyboard carries on
 * from the list (J, K, P and Enter).
 */

/** The attribute on a row's Prep button, so focus can go back to it when the panel closes. */
export const PREP_BUTTON = 'data-prep-for'

/**
 * True when focus has already moved on to another panel or dialog (the prep panel opening as the
 * company's dialog closes, or the other way round), so closing must not pull it back to the list.
 */
export function focusMovedOn(): boolean {
  const now = document.activeElement
  return now !== null && now !== document.body && now.closest('[role="dialog"]') !== null
}
