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

/** Uses the choice now and keeps it for the next visit. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
  try {
    // "system" is saved too: with nothing saved, the site opens light.
    window.localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Storage can be blocked (a private window). The choice still holds for this visit.
  }
}
