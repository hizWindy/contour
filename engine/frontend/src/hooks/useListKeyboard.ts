/**
 * Keyboard for a list of rows (the results table): J and K move to the next and the previous row,
 * Enter opens the active row, and Escape closes whatever is open (a side panel).
 *
 *  - `scope: 'document'` listens everywhere on the page, so J and K work without first clicking
 *    the table. It stays out of the way: it ignores a key pressed in a text field or a select, with
 *    Ctrl, Alt or Meta held, while a dialog, menu or list box is open, and after anything else
 *    already handled the key (a Radix dialog handles Escape first). Enter only opens the row when
 *    nothing else has focus (not a button or a link, which keep their own Enter).
 *  - `scope: 'container'` listens only for keys pressed inside the element, and adds ArrowUp and
 *    ArrowDown. In `document` scope the arrow keys also work while focus is inside the element.
 */
import { useEffect, useEffectEvent, type RefObject } from 'react'

export interface ListKeyboardOptions {
  /** Turns the keys off (for example while the list is empty). */
  enabled?: boolean
  /** The ids of the rows in display order. */
  ids: readonly string[]
  /** The active row, or nothing. */
  activeId: string | null | undefined
  /** J, K, and the arrows call this with the id to make active. */
  onActiveChange: (id: string) => void
  /** Enter calls this with the active row's id. */
  onOpen?: (id: string) => void
  /** Escape calls this. */
  onEscape?: () => void
  scope?: 'document' | 'container'
  /** The element that holds the rows. Needed for `scope: 'container'`, and for arrows. */
  containerRef?: RefObject<HTMLElement | null>
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

/** True when a key pressed on this target belongs to something else (typing, an open menu). */
function belongsToSomethingElse(target: Element | null): boolean {
  return target !== null && target.closest(`${EDITABLE}, ${OVERLAY}`) !== null
}

/** True when Enter on this target should open a row: nothing focused, or the list itself. */
function isIdleTarget(target: Element | null, container: HTMLElement | null): boolean {
  return (
    target === null ||
    target === document.body ||
    target === document.documentElement ||
    (container !== null && target === container)
  )
}

export function useListKeyboard(options: ListKeyboardOptions): void {
  const { enabled = true, scope = 'document', containerRef } = options

  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing
    ) {
      return
    }
    const target = asElement(event.target)
    const container = containerRef?.current ?? null
    if (belongsToSomethingElse(target)) {
      return
    }
    const insideContainer = container !== null && target !== null && container.contains(target)
    const { ids, activeId, onActiveChange, onOpen, onEscape } = options
    const index = activeId ? ids.indexOf(activeId) : -1

    const move = (to: number): void => {
      const id = ids[Math.min(ids.length - 1, Math.max(0, to))]
      if (id !== undefined && id !== activeId) {
        onActiveChange(id)
      }
      event.preventDefault()
    }

    switch (event.key) {
      case 'j':
      case 'J':
        if (ids.length > 0) {
          move(index + 1)
        }
        break
      case 'k':
      case 'K':
        if (ids.length > 0) {
          move(index === -1 ? 0 : index - 1)
        }
        break
      case 'ArrowDown':
        if (ids.length > 0 && (scope === 'container' || insideContainer)) {
          move(index + 1)
        }
        break
      case 'ArrowUp':
        if (ids.length > 0 && (scope === 'container' || insideContainer)) {
          move(index === -1 ? 0 : index - 1)
        }
        break
      case 'Home':
        if (ids.length > 0 && (scope === 'container' || insideContainer)) {
          move(0)
        }
        break
      case 'End':
        if (ids.length > 0 && (scope === 'container' || insideContainer)) {
          move(ids.length - 1)
        }
        break
      case 'Enter':
        if (onOpen && activeId && isIdleTarget(target, container)) {
          event.preventDefault()
          onOpen(activeId)
        }
        break
      case 'Escape':
        if (onEscape) {
          onEscape()
        }
        break
    }
  })

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const listener = (event: KeyboardEvent): void => {
      handle(event)
    }
    if (scope === 'container') {
      const container = containerRef?.current
      if (!container) {
        return undefined
      }
      container.addEventListener('keydown', listener)
      return () => {
        container.removeEventListener('keydown', listener)
      }
    }
    document.addEventListener('keydown', listener)
    return () => {
      document.removeEventListener('keydown', listener)
    }
  }, [enabled, scope, containerRef])
}
