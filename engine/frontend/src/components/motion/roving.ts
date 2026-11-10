import type { KeyboardEvent } from 'react'

/**
 * Keyboard for a group that works like radio buttons (a segmented control, chips that pick one):
 * the arrows move the choice and the focus, Home and End jump to the ends, and only the chosen
 * item is in the Tab order. Returns the index to pick, or null when the key is not one of these.
 */
export function rovingTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The next enabled index from `from` in `step`s of +1 or -1, wrapping. If every item is
 * disabled, `from` comes back.
 */
export function nextEnabled(from: number, step: 1 | -1, disabled: readonly boolean[]): number {
  const count = disabled.length
  let index = from
  for (let i = 0; i < count; i += 1) {
    index = (index + step + count) % count
    if (!disabled[index]) {
      return index
    }
  }
  return from
}

/** Focuses the `index`th radio inside `root` (a segmented control or a chip group). */
export function focusRadio(root: HTMLElement | null, index: number): void {
  root?.querySelectorAll<HTMLElement>('[role=radio]')[index]?.focus()
}

/** Moves the choice and the focus on an arrow, Home or End key. */
export function handleRovingKey(
  event: KeyboardEvent<HTMLElement>,
  index: number,
  disabled: readonly boolean[],
  pick: (index: number) => void,
): void {
  const target = rovingTarget(event.key, index, disabled.length)
  if (target === null) {
    return
  }
  event.preventDefault()
  // An arrow lands on the next enabled item, in its direction. Home and End look forward from
  // the end they start at.
  const step: 1 | -1 =
    event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
  const landing = disabled[target] ? nextEnabled(target, step, disabled) : target
  if (!disabled[landing]) {
    pick(landing)
  }
}
