/**
 * Light or dark. The site opens light (index.html starts with `data-theme="light"`). A person can
 * pick dark, or follow the computer's setting, from the command menu: that sets or removes
 * `data-theme` on <html>, which the tokens and the `dark:` variant obey, and the choice is kept in
 * this browser.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'lead-finder-theme'

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** The saved choice, or "light". Storage that is blocked or holds junk counts as "light". */
export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return isChoice(saved) ? saved : 'light'
  } catch {
    return 'light'
  }
}

/**
 * The browser's own bar (a phone's, and the installed app's title bar) takes the page's colour
 * (Improvements 1, #9), so the app is one piece with it in light and in dark. The colour is read
 * from the page after the theme is set, so it is whatever the tokens say, written nowhere else.
 */
function matchBrowserBar(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const colour = getComputedStyle(document.body).backgroundColor
  // Before the styles are in, the page has no colour yet: leave the bar as it is.
  if (meta && colour && colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') {
    meta.content = colour
  }
}

/**
 * Uses the choice now and keeps it for the next visit. Where the browser can (Chrome, Edge and
 * Safari), the page cross-fades from the old colours to the new in 250ms, instead of flashing
 * (Improvements 1, #8). With reduced motion, or where it can't, the colours change at once.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  const change = (): void => {
    if (choice === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', choice)
    }
    matchBrowserBar()
  }
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof document.startViewTransition === 'function' && !calm) {
    document.startViewTransition(change)
  } else {
    change()
  }
  try {
    // "system" is saved too: with nothing saved, the site opens light.
    window.localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Storage can be blocked (a private window). The choice still holds for this visit.
  }
}
