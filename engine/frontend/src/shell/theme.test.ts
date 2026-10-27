import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, readThemeChoice } from './theme'

const KEY = 'lead-finder-theme'

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('the colour choice', () => {
  it('opens light when nothing was chosen, or the saved value is junk', () => {
    expect(readThemeChoice()).toBe('light')
    window.localStorage.setItem(KEY, 'purple')
    expect(readThemeChoice()).toBe('light')
  })

  it('opens light when the browser blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readThemeChoice()).toBe('light')
  })

  it('keeps dark, and following the computer, for the next visit', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(readThemeChoice()).toBe('dark')

    applyTheme('system')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(readThemeChoice()).toBe('system')

    applyTheme('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(readThemeChoice()).toBe('light')
  })
})
