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

describe('changing colours smoothly (Improvements 1, #8)', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  /** A browser that can cross-fade: it runs the change inside the transition. */
  function canCrossFade() {
    const start = vi.fn((change: () => void) => {
      change()
      return {}
    })
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
    return start
  }

  function asks(reduced: boolean) {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: reduced && query === '(prefers-reduced-motion: reduce)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    )
  }

  it('cross-fades from the old colours to the new where the browser can, and still keeps the choice', () => {
    asks(false)
    const start = canCrossFade()
    applyTheme('dark')
    expect(start).toHaveBeenCalledTimes(1)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(readThemeChoice()).toBe('dark')
  })

  it('changes at once with reduced motion, even where the browser can cross-fade', () => {
    asks(true)
    const start = canCrossFade()
    applyTheme('dark')
    expect(start).not.toHaveBeenCalled()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('changes at once where the browser cannot cross-fade (jsdom, older browsers)', () => {
    asks(false)
    applyTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})

describe("the browser's own bar takes the page's colour (Improvements 1, #9)", () => {
  /** The tag the page head carries, with the light colour it starts with. */
  function barTag(): HTMLMetaElement {
    const tag = document.createElement('meta')
    tag.name = 'theme-color'
    tag.content = '#F4F5EF'
    document.head.append(tag)
    return tag
  }

  afterEach(() => {
    document.head.querySelector('meta[name="theme-color"]')?.remove()
    document.body.removeAttribute('style')
  })

  it("is set to the page's colour as the colours change, so dark mode is dark all the way up", () => {
    const tag = barTag()
    document.body.style.backgroundColor = 'rgb(20, 24, 33)'
    applyTheme('dark')
    expect(tag.content).toBe('rgb(20, 24, 33)')
  })

  it('is left as it was while the page has no colour yet (the styles are not in)', () => {
    const tag = barTag()
    applyTheme('dark')
    expect(tag.content).toBe('#F4F5EF')
  })

  it('does no harm on a page without the tag', () => {
    document.body.style.backgroundColor = 'rgb(20, 24, 33)'
    expect(() => {
      applyTheme('dark')
    }).not.toThrow()
  })
})
