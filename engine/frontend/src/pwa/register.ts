/**
 * Registers the service worker (Improvements 1, #9) and tells the person when a new version waits.
 * The worker itself is `sw.js` (read its header for what it keeps and what it never touches).
 *
 * - **Only in the real build, only where the browser can.** The dev server never registers it:
 *   a worker that keeps files would hide every edit. A browser without service workers simply
 *   gets the website as it always was.
 * - **After the page has loaded,** so the worker's install (it fetches the shell again, fresh) never
 *   competes with the first screen.
 * - **A new version waits.** The new worker installs in the background and the old one keeps
 *   serving, so no tab ever holds half of each version. When it is ready the page says "A new
 *   version of Contour is ready", with a Reload button, and stays until it is pressed. Reload tells
 *   the waiting worker to take over, and the page reloads once it has. Nothing reloads by itself,
 *   so a note being written is never lost to an update.
 * - **It looks for a new version** every hour, and when the page comes back into view after 10
 *   minutes away (a laptop opened in the morning), so a long-open tab hears about a deploy.
 * - **The first install says nothing.** There was no version before it.
 *
 * It never throws: the website works without the worker, so a failed registration is not news.
 */
import { toast } from 'sonner'
import { browser } from '@/lib/reload'

const UPDATE_TOAST = 'contour-update'
const LOOK_EVERY_MS = 60 * 60 * 1000
const NOT_SOONER_THAN_MS = 10 * 60 * 1000

/**
 * What the page tells the worker when the person chooses to update. Written in lower case, with a
 * hyphen, so the test of the words on screen doesn't take it for a setting's own name.
 */
export const SKIP_WAITING = { type: 'skip-waiting' } as const

export const UPDATE_READY = 'A new version of Contour is ready'
export const UPDATE_HINT = 'Reload when you are ready to use it.'
export const RELOAD = 'Reload'

/** Registers the worker when this is the real build and the browser has service workers. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const start = (): void => {
    void register(navigator.serviceWorker)
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

export async function register(container: ServiceWorkerContainer): Promise<void> {
  try {
    // `updateViaCache: 'none'`: the browser never takes a copy of the worker, or of a file it
    // loads, from its own cache when it looks for a new version.
    const registration = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    watch(container, registration)
  } catch {
    // The website works without it.
  }
}

function watch(container: ServiceWorkerContainer, registration: ServiceWorkerRegistration): void {
  let asked = false
  let reloaded = false
  const waiting = (): void => {
    // With no worker in charge yet this is the first install, not an update.
    if (!container.controller) return
    announce(registration, () => {
      asked = true
    })
  }
  if (registration.waiting) waiting()
  registration.addEventListener('updatefound', () => {
    const next = registration.installing
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed') waiting()
    })
  })
  // The new worker took over because the person asked: this page was made for the old version, so
  // it reloads once to get the new. A takeover nobody asked for (the first install) changes nothing.
  container.addEventListener('controllerchange', () => {
    if (!asked || reloaded) return
    reloaded = true
    browser.reload()
  })

  let lastLook = Date.now()
  const look = (): void => {
    lastLook = Date.now()
    registration.update().catch(() => undefined)
  }
  window.setInterval(look, LOOK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLook > NOT_SOONER_THAN_MS) look()
  })
}

/** One notice that stays until it is used, however many times the worker says it is ready. */
function announce(registration: ServiceWorkerRegistration, asked: () => void): void {
  toast(UPDATE_READY, {
    id: UPDATE_TOAST,
    description: UPDATE_HINT,
    duration: Infinity,
    action: {
      label: RELOAD,
      onClick: () => {
        asked()
        const next = registration.waiting
        // No waiting worker (it took over by itself meanwhile): a plain reload gets the new version.
        if (next) next.postMessage(SKIP_WAITING)
        else browser.reload()
      },
    },
  })
}
