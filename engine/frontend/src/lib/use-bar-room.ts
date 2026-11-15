/**
 * Room above a bar fixed at the bottom of the screen (WCAG 2.2 2.4.11, Focus Not Obscured). While
 * the bar shows, the page's scroller (the document) keeps `scroll-padding-bottom` of the bar's
 * height plus 1rem. A control the keyboard lands on then scrolls up above the bar, instead of
 * stopping under it. Without the bar, the padding goes.
 *
 * The four bars use it: "Check and send" on the pre-read, Send on Activity, "Prep a call" on a
 * company's page, and "Start run" on a tablet or a phone. A bar that is fixed only on a phone
 * passes `active` for when it is.
 *
 * The height is measured, and measured again when the bar changes size (a reason line coming or
 * going). A bar that can't be measured, as in tests with no layout, gets 7rem.
 */
import { useEffect, useState } from 'react'

/** The room over the bar's own height. */
const ROOM_PX = 16

/** When the bar can't be measured: about a bar with a line of words and a 44px button. */
const UNMEASURED = '7rem'

/** Each bar showing now, by its own token, with its height. Usually one. */
const bars = new Map<object, number>()

function applyRoom(): void {
  const root = document.documentElement
  if (bars.size === 0) {
    root.style.removeProperty('scroll-padding-bottom')
    return
  }
  const tallest = Math.max(...bars.values())
  root.style.setProperty(
    'scroll-padding-bottom',
    tallest > 0 ? `${String(Math.ceil(tallest) + ROOM_PX)}px` : UNMEASURED,
  )
}

/** Keeps the room while the bar is there: the returned function gives it back. */
function holdRoom(bar: HTMLElement): () => void {
  const token = {}
  const measure = (): void => {
    bars.set(token, bar.getBoundingClientRect().height)
    applyRoom()
  }
  measure()
  const observer = new ResizeObserver(measure)
  observer.observe(bar, { box: 'border-box' })
  return () => {
    observer.disconnect()
    bars.delete(token)
    applyRoom()
  }
}

/**
 * Pass the result as the bar's `ref`. `active`: the bar is fixed at the bottom now (false on a
 * laptop, for a bar that sits in the page there).
 */
export function useBarRoom(active = true): (bar: HTMLElement | null) => void {
  const [bar, setBar] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!active || !bar) return undefined
    return holdRoom(bar)
  }, [active, bar])
  return setBar
}
