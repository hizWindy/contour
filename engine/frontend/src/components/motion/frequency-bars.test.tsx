import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION } from '@/lib/use-media-query'
import { BAR_COUNT, BAR_FLOOR, BAR_GATE, barTarget, stepBars, type BarSource } from './bar-levels'
import { FrequencyBars } from './frequency-bars'

/*
  The mic card's bars (PLAN-V18 T3-4): 24 bars that follow the mic's own sound as scaleY, at most
  30 times a second, still at silence, and one still bar with reduced motion.
*/

/** The screen's frames, run by the test: each `frame(ms)` is one frame at that time. */
function manualFrames() {
  let next: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    next = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    next = null
  })
  return {
    frame(ms: number) {
      const run = next
      next = null
      act(() => {
        run?.(ms)
      })
    },
    running: () => next !== null,
  }
}

/** A mic that says `level` in every band, and counts how often it was read. */
function source(level: () => number) {
  const reads = { count: 0 }
  const bars: BarSource = {
    read(levels) {
      reads.count += 1
      levels.fill(level())
    },
  }
  return { bars, reads }
}

function transforms(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot=frequency-bar]')).map(
    (bar) => bar.style.transform,
  )
}

describe('the bars’ numbers', () => {
  it('holds a level to the floor below the gate, and to 1 at most', () => {
    expect(barTarget(0)).toBe(BAR_FLOOR)
    expect(barTarget(BAR_GATE / 2)).toBe(BAR_FLOOR)
    expect(barTarget(1)).toBe(1)
    expect(barTarget(5)).toBe(1)
    expect(barTarget(Number.NaN)).toBe(BAR_FLOOR)
    expect(barTarget(0.5)).toBeGreaterThan(BAR_FLOOR)
  })

  it('moves only the bars that are not where they should be, and settles', () => {
    const scales = new Float32Array(3).fill(BAR_FLOOR)
    const levels = new Float32Array([0, 1, 0])
    expect(stepBars(scales, levels)).toEqual([1])
    // Up fast: most of the way in one draw.
    expect(scales[1]).toBeGreaterThan(0.6)
    for (let draw = 0; draw < 40; draw += 1) stepBars(scales, levels)
    expect(scales[1]).toBe(1)
    // Settled: nothing moves, so nothing is written.
    expect(stepBars(scales, levels)).toEqual([])
  })
})

describe('FrequencyBars', () => {
  it('draws 24 bars, hidden from screen readers, that grow as scaleY only', () => {
    const frames = manualFrames()
    const mic = source(() => 0.8)
    render(<FrequencyBars source={mic.bars} />)
    const holder = document.querySelector('[data-slot=frequency-bars]')
    expect(holder).toHaveAttribute('aria-hidden', 'true')
    expect(transforms()).toHaveLength(BAR_COUNT)
    expect(new Set(transforms())).toEqual(new Set([`scaleY(${BAR_FLOOR.toFixed(3)})`]))

    frames.frame(0)
    frames.frame(40)
    const grown = transforms()
    expect(grown.every((value) => /^scaleY\(0\.\d+|1\.000\)$/.test(value))).toBe(true)
    expect(grown[0]).not.toBe(`scaleY(${BAR_FLOOR.toFixed(3)})`)
    // Only the transform moves: no height, no width, no colour.
    for (const bar of document.querySelectorAll<HTMLElement>('[data-slot=frequency-bar]')) {
      expect(bar.style.height).toBe('')
      expect(bar.style.width).toBe('')
      expect(bar.style.backgroundColor).toBe('')
    }
  })

  it('reads the mic at most 30 times a second, though the screen draws 60', () => {
    const frames = manualFrames()
    const mic = source(() => 0.5)
    render(<FrequencyBars source={mic.bars} />)
    // One second of a 60 Hz screen.
    for (let frame = 0; frame <= 60; frame += 1) frames.frame(frame * (1000 / 60))
    expect(mic.reads.count).toBeLessThanOrEqual(31)
    expect(mic.reads.count).toBeGreaterThanOrEqual(29)
  })

  it('is still at silence: once settled, no bar is written again', () => {
    const frames = manualFrames()
    let level = 0.9
    const mic = source(() => level)
    render(<FrequencyBars source={mic.bars} />)
    frames.frame(0)
    level = 0
    for (let frame = 1; frame <= 60; frame += 1) frames.frame(frame * 40)
    const settled = transforms()
    expect(new Set(settled)).toEqual(new Set([`scaleY(${BAR_FLOOR.toFixed(3)})`]))
    // A quiet room's hum is under the gate: still nothing moves.
    level = BAR_GATE / 2
    const watcher = new MutationObserver(() => undefined)
    const holder = document.querySelector('[data-slot=frequency-bars]') as HTMLElement
    watcher.observe(holder, { attributes: true, attributeFilter: ['style'], subtree: true })
    for (let frame = 61; frame <= 90; frame += 1) frames.frame(frame * 40)
    expect(transforms()).toEqual(settled)
    expect(watcher.takeRecords()).toHaveLength(0)
    watcher.disconnect()
  })

  it('sits still at the floor with no mic, and stops its frames when the mic is let go', () => {
    const frames = manualFrames()
    const mic = source(() => 0.7)
    const { rerender } = render(<FrequencyBars source={null} />)
    expect(frames.running()).toBe(false)
    rerender(<FrequencyBars source={mic.bars} />)
    expect(frames.running()).toBe(true)
    frames.frame(0)
    rerender(<FrequencyBars source={null} />)
    expect(frames.running()).toBe(false)
    expect(new Set(transforms())).toEqual(new Set([`scaleY(${BAR_FLOOR.toFixed(3)})`]))
  })

  it('is one still bar and the word with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
      matches: query === REDUCED_MOTION,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))
    const frames = manualFrames()
    const mic = source(() => 0.7)
    render(<FrequencyBars source={mic.bars} label="Listening" />)
    expect(screen.getByText('Listening')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot=frequency-bar]')).toHaveLength(0)
    expect(frames.running()).toBe(false)
    expect(mic.reads.count).toBe(0)
  })
})
