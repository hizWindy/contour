/**
 * Where each city's name goes on the map. A name sits beside its dot, and on a narrow map (a
 * phone) names pile up on each other and on the neighbouring dots. This picks, for each name, the
 * side of its dot that is free: right first, then left, top, bottom, then the four corners (up and
 * right, and so on). It is pure arithmetic on pixel positions, so it can be tested without a map.
 */

export type Side =
  'right' | 'left' | 'top' | 'bottom' | 'right-up' | 'right-down' | 'left-up' | 'left-down'

export interface LabelSpot {
  /** A key for the city (its name). */
  id: string
  /** The dot's centre, in pixels from the map's top left. */
  x: number
  y: number
  /** How wide the name is, in pixels. */
  width: number
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The dot's radius on the map, and the label's height and its gap from the dot, in pixels. */
const DOT = 14
const LABEL_HEIGHT = 26
const GAP = 4
const EDGE = 4
/** How far a corner label's middle sits above or below its dot's middle. */
const CORNER_RISE = 22

/** How wide a city's name is likely to be at the map's text size. A guess, kept a little wide. */
export function labelWidth(text: string): number {
  return Math.round(text.length * 6.6 + 18)
}

function dotBox(spot: LabelSpot): Box {
  return { left: spot.x - DOT, top: spot.y - DOT, right: spot.x + DOT, bottom: spot.y + DOT }
}

function labelBox(spot: LabelSpot, side: Side): Box {
  const { x, y, width } = spot
  const near = DOT + GAP
  const beside = (rightward: boolean, shift: number): Box => ({
    left: rightward ? x + near : x - near - width,
    right: rightward ? x + near + width : x - near,
    top: y + shift - LABEL_HEIGHT / 2,
    bottom: y + shift + LABEL_HEIGHT / 2,
  })
  const above = (up: boolean): Box => ({
    left: x - width / 2,
    right: x + width / 2,
    top: up ? y - near - LABEL_HEIGHT : y + near,
    bottom: up ? y - near : y + near + LABEL_HEIGHT,
  })
  switch (side) {
    case 'right':
      return beside(true, 0)
    case 'left':
      return beside(false, 0)
    case 'top':
      return above(true)
    case 'bottom':
      return above(false)
    case 'right-up':
      return beside(true, -CORNER_RISE)
    case 'right-down':
      return beside(true, CORNER_RISE)
    case 'left-up':
      return beside(false, -CORNER_RISE)
    case 'left-down':
      return beside(false, CORNER_RISE)
  }
}

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

/** How much of the label sticks out past the map's edge, in square pixels. */
function outside(box: Box, size: { x: number; y: number }): number {
  const area = (box.right - box.left) * (box.bottom - box.top)
  const inner: Box = {
    left: Math.max(box.left, EDGE),
    top: Math.max(box.top, EDGE),
    right: Math.min(box.right, size.x - EDGE),
    bottom: Math.min(box.bottom, size.y - EDGE),
  }
  const visible = Math.max(0, inner.right - inner.left) * Math.max(0, inner.bottom - inner.top)
  return area - visible
}

const PREFERENCE: readonly Side[] = [
  'right',
  'left',
  'top',
  'bottom',
  'right-up',
  'right-down',
  'left-up',
  'left-down',
]

/**
 * The side for each name. The names closest to an edge choose first (they have the fewest
 * options), then the rest. A side that fits inside the map and touches no dot and no placed name
 * wins; when none is clear, the side with the least clash is used.
 */
export function placeLabels(
  spots: readonly LabelSpot[],
  size: { x: number; y: number },
): Record<string, Side> {
  const edgeDistance = (spot: LabelSpot): number =>
    Math.min(spot.x, size.x - spot.x, spot.y, size.y - spot.y)
  const order = [...spots].sort((a, b) => edgeDistance(a) - edgeDistance(b))
  const dots = new Map(spots.map((spot) => [spot.id, dotBox(spot)]))
  const placed: Box[] = []
  const sides: Record<string, Side> = {}
  for (const spot of order) {
    const others = [...dots.entries()].filter(([id]) => id !== spot.id).map(([, box]) => box)
    let best: { side: Side; cost: number; box: Box } | null = null
    for (const side of PREFERENCE) {
      const box = labelBox(spot, side)
      const clash =
        others.reduce((sum, other) => sum + overlap(box, other), 0) +
        placed.reduce((sum, other) => sum + overlap(box, other), 0)
      const cost = clash + outside(box, size) * 4
      if (best === null || cost < best.cost) {
        best = { side, cost, box }
      }
      if (cost === 0) {
        break
      }
    }
    if (best) {
      sides[spot.id] = best.side
      placed.push(best.box)
    }
  }
  return sides
}

/** The tooltip's direction on the map, for a side. A corner uses its left or right, and an offset. */
export function labelDirection(side: Side): 'right' | 'left' | 'top' | 'bottom' {
  if (side.startsWith('right')) {
    return 'right'
  }
  if (side.startsWith('left')) {
    return 'left'
  }
  return side as 'top' | 'bottom'
}

/** The tooltip offset that keeps a label clear of its dot, for a side. */
export function labelOffset(side: Side): [number, number] {
  switch (side) {
    case 'right':
      return [DOT, 0]
    case 'left':
      return [-DOT, 0]
    case 'top':
      return [0, -DOT]
    case 'bottom':
      return [0, DOT]
    case 'right-up':
      return [DOT, -CORNER_RISE]
    case 'right-down':
      return [DOT, CORNER_RISE]
    case 'left-up':
      return [-DOT, -CORNER_RISE]
    case 'left-down':
      return [-DOT, CORNER_RISE]
  }
}
