/**
 * The bar's store runs live voice's audio start inside the key press or tap that opens the bar
 * (PLAN-V28 T2-2): on an iPhone, sound may start only there. Plain code: no page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeVoiceBar,
  isVoiceBarOpen,
  openVoiceBar,
  openVoiceBarByKey,
  whenBarOpens,
} from '../store'

afterEach(() => {
  whenBarOpens(null)
  closeVoiceBar()
})

describe('the audio starts inside the tap that opens the bar', () => {
  it('runs inside the Speak tap and the V key press, in the same call that opens the bar', () => {
    const seen: boolean[] = []
    whenBarOpens(() => {
      seen.push(isVoiceBarOpen())
    })

    openVoiceBar()
    closeVoiceBar()
    openVoiceBarByKey()

    // Once for each opening, in the same call that opened it.
    expect(seen).toEqual([true, true])
  })

  it('runs once: a second press while it is open does nothing', () => {
    const run = vi.fn()
    whenBarOpens(run)
    openVoiceBar()
    openVoiceBar()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('never stops the bar opening, whatever goes wrong with the sound', () => {
    whenBarOpens(() => {
      throw new Error('No Web Audio here')
    })
    openVoiceBar()

    expect(isVoiceBarOpen()).toBe(true)
  })

  it('runs nothing once it is let go, as for a person without live voice', () => {
    const run = vi.fn()
    whenBarOpens(run)
    whenBarOpens(null)
    openVoiceBar()

    expect(run).not.toHaveBeenCalled()
  })
})
