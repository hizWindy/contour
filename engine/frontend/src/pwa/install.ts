/**
 * Installing the website as an app (Improvements 1, #9). Once installed, Contour opens in a window
 * of its own, or from the home screen, with no browser bar around it.
 *
 * - **Chrome, Edge and Android's Chrome** say when the site can be installed (`beforeinstallprompt`,
 *   once, soon after the page loads). This keeps that event, so Ctrl+K can offer "Install Contour"
 *   and press the browser's own install dialog on request. The browser's menu offers it too.
 * - **iPhone and iPad (Safari)** have no such event and no install dialog: the person adds the site
 *   to the home screen by hand. There the same entry says how, in a notice.
 * - **Nothing is offered once it is installed,** or when this window already is the installed app.
 *
 * `watchInstall` must run early (main.tsx), because the browser says its piece only once.
 */
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How the person can install: with the browser's dialog, by hand with steps, or not at all. */
export type InstallWay = 'prompt' | 'steps' | null

let held: InstallPrompt | null = null
let installed = false
const listeners = new Set<() => void>()

function tell(): void {
  for (const listener of listeners) listener()
}

export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Kept for the person's own "Install Contour", instead of the browser's bar at its own moment.
    event.preventDefault()
    held = event as InstallPrompt
    tell()
  })
  window.addEventListener('appinstalled', () => {
    held = null
    installed = true
    tell()
  })
}

/** True when this window is the installed app (or Safari's home-screen app). */
function isInstalledApp(): boolean {
  const safari = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return safari || window.matchMedia('(display-mode: standalone)').matches
}

/** An iPhone or iPad (the iPad says it is a Mac, with a touch screen). */
function isApple(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** How this visit can install, now. A plain value, so a change is easy to see. */
export function installWay(): InstallWay {
  if (installed || isInstalledApp()) return null
  if (held) return 'prompt'
  return isApple() ? 'steps' : null
}

export const INSTALL_STEPS = 'Add Contour to your home screen'
export const INSTALL_STEPS_HINT = 'Tap the Share button in Safari, then Add to Home Screen.'

/** Installs: the browser's own dialog, or the steps where the browser has none. */
export async function install(): Promise<void> {
  const asking = held
  if (asking) {
    // The browser lets each event ask once. A "no" brings it back on a later visit.
    held = null
    tell()
    await asking.prompt()
    await asking.userChoice
    return
  }
  toast(INSTALL_STEPS, { description: INSTALL_STEPS_HINT })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** How this visit can install, and it changes when the browser says it can, or when it is done. */
export function useInstallWay(): InstallWay {
  return useSyncExternalStore(subscribe, installWay, () => null)
}
