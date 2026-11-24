/**
 * The room above a bar fixed at the bottom of the screen (WCAG 2.2 2.4.11): the page's scroller
 * keeps `scroll-padding-bottom` while the bar shows, and loses it once the bar goes. jsdom has no
 * layout, so a bar here measures 0 and gets the 7rem kept for that; a measured one is faked.
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBarRoom } from './use-bar-room'

function Bar({ active = true, height }: { active?: boolean; height?: number }) {
  const room = useBarRoom(active)
  return (
    <div
      ref={(node) => {
        if (node && height !== undefined) {
          vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, height))
        }
        room(node)
      }}
      data-slot="bar"
    />
  )
}

function padding(): string {
  return document.documentElement.style.getPropertyValue('scroll-padding-bottom')
}

function barHeight(): string {
  return document.documentElement.style.getPropertyValue('--bottom-bar')
}

afterEach(() => {
  document.documentElement.style.removeProperty('scroll-padding-bottom')
  document.documentElement.style.removeProperty('--bottom-bar')
})

describe('the room above a bar at the bottom', () => {
  it('is kept while the bar shows, and goes with it', () => {
    const { rerender, unmount } = render(<Bar />)
    expect(padding()).toBe('7rem')
    // Not fixed now (a laptop, for a bar fixed only on a phone): no room.
    rerender(<Bar active={false} />)
    expect(padding()).toBe('')
    rerender(<Bar />)
    expect(padding()).toBe('7rem')
    unmount()
    expect(padding()).toBe('')
  })

  it("is the bar's own height and 16px more, when it can be measured", () => {
    render(<Bar height={92.5} />)
    expect(padding()).toBe('109px')
  })

  it('gives the bar its height as --bottom-bar, so the research tray sits above it', () => {
    const { unmount } = render(<Bar height={92.5} />)
    expect(barHeight()).toBe('93px')
    unmount()
    expect(barHeight()).toBe('')
  })

  it('makes room for the tallest bar while two show, and for the other once one goes', () => {
    const { rerender } = render(
      <>
        <Bar height={60} />
        <Bar height={120} />
      </>,
    )
    expect(padding()).toBe('136px')
    rerender(
      <>
        <Bar height={60} />
        <Bar height={120} active={false} />
      </>,
    )
    expect(padding()).toBe('76px')
  })
})
