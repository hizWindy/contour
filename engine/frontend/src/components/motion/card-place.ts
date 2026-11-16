/**
 * Where the mic card sits beside the button it grows from (PLAN-V18 T3-4, `MicSheet`), in a file
 * of its own: plain code, so the tests prove each case.
 */

/** The card's width, at most. On a narrow window it is the window less 16px each side. */
export const MIC_SHEET_WIDTH = 400

/** The room the card needs above its button to open there: its usual height. */
const ROOM_ABOVE = 320

const MARGIN = 16
const GAP = 8

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface CardPlace {
  left: number
  /** Below the button: the card's top edge. */
  top?: number
  /** Above the button: the card's bottom edge, from the window's bottom. */
  bottom?: number
  /** The most the card may be tall there. */
  maxHeight: number
  /** The button's middle, as the card's transform origin. */
  origin: string
}

/**
 * Where the card sits beside its button: its right edge lines up with the button's (the mic sits
 * in the corner of the note box), above it when there is room for the card, else below, and
 * always inside the window.
 */
export function placeCard(button: Box, view: { width: number; height: number }): CardPlace {
  const width = Math.min(MIC_SHEET_WIDTH, view.width - MARGIN * 2)
  const right = button.left + button.width
  const left = Math.max(MARGIN, Math.min(right - width, view.width - MARGIN - width))
  const middleX = Math.round(button.left + button.width / 2 - left)
  const reach = Math.round(GAP + button.height / 2)
  const above = button.top - GAP - MARGIN
  if (above >= ROOM_ABOVE) {
    return {
      left,
      bottom: Math.round(view.height - button.top + GAP),
      maxHeight: Math.round(above),
      origin: `${String(middleX)}px calc(100% + ${String(reach)}px)`,
    }
  }
  const top = Math.round(button.top + button.height + GAP)
  return {
    left,
    top,
    maxHeight: Math.max(160, Math.round(view.height - top - MARGIN)),
    origin: `${String(middleX)}px ${String(-reach)}px`,
  }
}
