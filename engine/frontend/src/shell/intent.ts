/**
 * Preloading on intent (PLAN-V7 C2, the data part). Someone who points at a link for a moment,
 * focuses it with the keyboard or presses on it is about to open that page. Its code and its first
 * data start loading then, so the click finds them already there, or nearly.
 *
 * One listener on the whole document covers every link in the app (the menu, the cards on Home,
 * the breadcrumbs, links in tables) and the ones added later. A touch screen has no pointing, so a
 * touch starts on the press. Nothing starts on a connection that asks to save data or is slow, and
 * starting the same page again costs nothing: its code is already there, and its data counts as
 * fresh for its cache time (PLAN-V7 C3), so it is not asked twice.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { RouteObject } from 'react-router'
import { POINT_MS } from '@/lib/pointing'
import { prefetchPage } from './prefetch'
import { loadCode, sparing } from './preload'

/** The link an event happened on, if it opens a page of this app in this tab. */
function pageLink(target: EventTarget | null): HTMLAnchorElement | null {
  const link = target instanceof Element ? target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement)) {
    return null
  }
  const elsewhere = link.origin !== window.location.origin
  const another = link.target !== '' && link.target !== '_self'
  return elsewhere || another || link.hasAttribute('download') ? null : link
}

/** Starts watching. Returns a function that stops it. */
export function preloadOnIntent(
  routes: RouteObject[],
  client: QueryClient,
  root: Document = document,
): () => void {
  let resting: { link: HTMLAnchorElement; timer: number } | null = null

  const stopResting = (): void => {
    if (resting) {
      window.clearTimeout(resting.timer)
      resting = null
    }
  }
  const start = (link: HTMLAnchorElement): void => {
    stopResting()
    if (!sparing()) {
      prefetchPage(routes, link, client)
      void loadCode(routes, [link.pathname])
    }
  }

  const onOver = (event: PointerEvent): void => {
    const link = pageLink(event.target)
    if (event.pointerType === 'touch' || link === null || link === resting?.link) {
      return
    }
    stopResting()
    resting = {
      link,
      timer: window.setTimeout(() => {
        start(link)
      }, POINT_MS),
    }
  }
  const onOut = (event: PointerEvent): void => {
    const into = event.relatedTarget
    if (resting && !(into instanceof Node && resting.link.contains(into))) {
      stopResting()
    }
  }
  const onPress = (event: Event): void => {
    const link = pageLink(event.target)
    if (link) {
      start(link)
    }
  }

  root.addEventListener('pointerover', onOver)
  root.addEventListener('pointerout', onOut)
  root.addEventListener('pointerdown', onPress)
  root.addEventListener('focusin', onPress)
  return () => {
    root.removeEventListener('pointerover', onOver)
    root.removeEventListener('pointerout', onOut)
    root.removeEventListener('pointerdown', onPress)
    root.removeEventListener('focusin', onPress)
    stopResting()
  }
}
