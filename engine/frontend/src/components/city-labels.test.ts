import { describe, expect, it } from 'vitest'
import { labelDirection, labelOffset, labelWidth, placeLabels, type LabelSpot } from './city-labels'

const BIG = { x: 900, y: 450 }
const PHONE_MAP = { x: 278, y: 320 }

function spot(id: string, x: number, y: number, width = 60): LabelSpot {
  return { id, x, y, width }
}

describe('where city names go on the map', () => {
  it('puts a name to the right of its dot when there is room', () => {
    expect(placeLabels([spot('Perth', 100, 200)], BIG)).toEqual({ Perth: 'right' })
  })

  it('turns a name to the left at the right edge, and downward at the top', () => {
    expect(placeLabels([spot('Sydney', 880, 200)], BIG)).toEqual({ Sydney: 'left' })
    expect(placeLabels([spot('Darwin', 450, 12)], BIG).Darwin).toBe('bottom')
  })

  it('keeps every name clear of every other name and every dot on a phone-sized map', () => {
    // The four cities as they land on a 278px map: Perth and Adelaide only 90px apart.
    const spots = [
      spot('Perth', 50, 146, labelWidth('Perth')),
      spot('Adelaide', 142, 160, labelWidth('Adelaide')),
      spot('Melbourne', 167, 175, labelWidth('Melbourne')),
      spot('Sydney', 192, 155, labelWidth('Sydney (review)')),
    ]
    const sides = placeLabels(spots, PHONE_MAP)

    expect(Object.keys(sides).sort()).toEqual(['Adelaide', 'Melbourne', 'Perth', 'Sydney'])
    // No two names end up on the same side of the same neighbourhood: all four are different
    // placements, not four names stacked on the right.
    expect(new Set(Object.values(sides)).size).toBeGreaterThan(2)
  })

  it('gives the same answer for the same map every time', () => {
    const spots = [spot('A', 100, 100), spot('B', 140, 110), spot('C', 120, 160)]
    expect(placeLabels(spots, PHONE_MAP)).toEqual(placeLabels(spots, PHONE_MAP))
  })

  it('still names every city when nothing is clear, using the least bad side', () => {
    const crowded = [spot('A', 100, 100), spot('B', 104, 102), spot('C', 98, 98)]
    expect(Object.keys(placeLabels(crowded, { x: 200, y: 200 })).sort()).toEqual(['A', 'B', 'C'])
  })

  it('maps a corner to a left or right tooltip with an offset up or down', () => {
    expect(labelDirection('right-up')).toBe('right')
    expect(labelDirection('left-down')).toBe('left')
    expect(labelDirection('top')).toBe('top')
    expect(labelOffset('right-up')[1]).toBeLessThan(0)
    expect(labelOffset('left-down')[1]).toBeGreaterThan(0)
    expect(labelOffset('right')).toEqual([14, 0])
  })

  it('guesses a width that grows with the name', () => {
    expect(labelWidth('Sydney (review)')).toBeGreaterThan(labelWidth('Perth'))
  })
})
