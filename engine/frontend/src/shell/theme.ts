/**
 * Light or dark. The colours follow the computer's setting by themselves (tokens.css). A person
 * can also pick one from the command menu: that sets `data-theme` on <html>, which the tokens and
 * the `dark:` variant obey, and the choice is kept in this browser.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'lead-finder-theme'

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** The saved choice, or "system". Storage that is blocked or holds junk counts as "system". */
export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return isChoice(saved) ? saved : 'system'
  } catch {
    return 'system'
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
    if (choice === 'system') {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, choice)
    }
  } catch {
    // Storage can be blocked (a private window). The choice still holds for this visit.
  }
}
