/**
 * "Keep listening" (PLAN-V24 choice 6, T2-5): on by default, kept in this browser so it stays
 * after a reload, and on when storage is blocked or holds junk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isKeepListeningOn, setKeepListening } from './keep-listening'

afterEach(() => {
  setKeepListening(true)
  window.localStorage.clear()
})

describe('the "Keep listening" switch', () => {
  it('is on by default, with nothing kept', () => {
    expect(isKeepListeningOn()).toBe(true)
  })

  it('off is kept in this browser, so it stays after a reload', async () => {
    setKeepListening(false)
    expect(isKeepListeningOn()).toBe(false)
    expect(window.localStorage.getItem('assistant.keep-listening')).toBe('off')
    // A reload: the file is read again from scratch, and reads the browser's own copy.
    vi.resetModules()
    const reloaded = await import('./keep-listening')
    expect(reloaded.isKeepListeningOn()).toBe(false)
    reloaded.setKeepListening(true)
    expect(window.localStorage.getItem('assistant.keep-listening')).toBeNull()
    expect(isKeepListeningOn()).toBe(true)
  })

  it('junk in storage counts as on', () => {
    window.localStorage.setItem('assistant.keep-listening', 'maybe')
    expect(isKeepListeningOn()).toBe(true)
  })

  it('blocked storage counts as on, and a choice still holds for this visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isKeepListeningOn()).toBe(true)
    setKeepListening(false)
    expect(isKeepListeningOn()).toBe(false)
  })
})
