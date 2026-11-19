/**
 * "Use V to speak" (PLAN-V23 T4-1): on by default, kept in this browser, and safe when storage is
 * blocked or holds junk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isVKeyOn, setVKeyOn } from './v-switch'

afterEach(() => {
  setVKeyOn(true)
  window.localStorage.clear()
})

describe('the V switch', () => {
  it('is on with nothing kept', () => {
    expect(isVKeyOn()).toBe(true)
  })

  it('off is kept in this browser, so it stays after a reload', () => {
    setVKeyOn(false)
    expect(isVKeyOn()).toBe(false)
    // A reload reads the browser's own copy.
    expect(window.localStorage.getItem('assistant.v-key')).toBe('off')
    setVKeyOn(true)
    expect(isVKeyOn()).toBe(true)
    expect(window.localStorage.getItem('assistant.v-key')).toBeNull()
  })

  it('junk in storage counts as on', () => {
    window.localStorage.setItem('assistant.v-key', 'maybe')
    expect(isVKeyOn()).toBe(true)
  })

  it('blocked storage counts as on, and a choice still holds for this visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isVKeyOn()).toBe(true)
    setVKeyOn(false)
    expect(isVKeyOn()).toBe(false)
  })
})
