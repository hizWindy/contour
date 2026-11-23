import { describe, expect, it } from 'vitest'
import type { VoiceToolKind } from '@/api/types'
import {
  deviceKind,
  engineFor,
  ENGINE_KEY,
  movedToModel,
  pickEngine,
  rememberModel,
  type BrowserFacts,
  type Here,
} from './voice-engine'

/*
  The engine picks itself (PLAN-V24 T4-3, choice 22): what the browser is, plus the setting, in;
  the browser's speech service or the model on the device out. The user agents are real shapes
  with made-up version numbers.
*/

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  chromeAndroidTablet:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  // The app installed on the home screen: Safari's engine, without "Safari" in its name.
  installedIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/127.0.0.0',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/138.0.0.0 Mobile Safari/537.36',
}

/** A browser: a laptop with a mouse, with the speech service, that can run the model. */
function here(userAgent: string, change: Partial<Here> = {}): Here {
  return { userAgent, touchPoints: 0, model: true, speech: true, movedToModel: false, ...change }
}

/** An iPad on iPadOS, which shows a Mac's user agent: only its touch points tell. */
const IPAD_AS_MAC = here(UA.safariMac, { touchPoints: 5 })

describe('with browser_service, the setting live now (choice 22)', () => {
  it.each<[string, Here]>([
    ['Chrome on a Windows laptop', here(UA.chromeWindows)],
    ['Chrome on a Mac', here(UA.chromeMac)],
    ['Chrome on an Android phone', here(UA.chromeAndroid, { touchPoints: 5 })],
  ])('%s gets the browser’s speech service', (_, browser) => {
    expect(engineFor('browser_service', browser)).toBe('service')
  })

  it.each<[string, Here]>([
    ['Safari on an iPhone', here(UA.safariIphone, { touchPoints: 5 })],
    ['the installed app on an iPhone', here(UA.installedIphone, { touchPoints: 5 })],
    ['Chrome on an iPhone', here(UA.chromeIphone, { touchPoints: 5 })],
    ['an iPad that says it is a Mac', IPAD_AS_MAC],
    ['Safari on a Mac', here(UA.safariMac)],
    ['Firefox on Windows', here(UA.firefoxWindows, { speech: false })],
    ['Firefox on a Mac', here(UA.firefoxMac, { speech: false })],
    ['Firefox on Android', here(UA.firefoxAndroid, { speech: false, touchPoints: 5 })],
    // 23 Nov 2026: Edge's service listened and heard nothing. Only Google Chrome keeps its service.
    ['Edge on a Windows laptop', here(UA.edgeWindows)],
    ['Opera on a Windows laptop', here(UA.operaWindows)],
    ['Samsung Internet on Android', here(UA.samsungAndroid, { touchPoints: 5 })],
  ])('%s gets the model on the device', (_, browser) => {
    expect(engineFor('browser_service', browser)).toBe('model')
  })

  it('a laptop where the service didn’t start once gets the model from then on', () => {
    expect(engineFor('browser_service', here(UA.chromeWindows, { movedToModel: true }))).toBe(
      'model',
    )
  })

  it('a browser with no speech service gets the model, and one that can run neither, no mic', () => {
    const unknown = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)'
    expect(engineFor('browser_service', here(unknown, { speech: false }))).toBe('model')
    expect(engineFor('browser_service', here(unknown, { speech: false, model: false }))).toBeNull()
  })

  it('where the model can’t run, a weak service is still better than none', () => {
    expect(engineFor('browser_service', here(UA.safariIphone, { model: false }))).toBe('service')
  })
})

describe('with browser_model (choice 27)', () => {
  it.each<[string, Here]>([
    ['Chrome on a Windows laptop', here(UA.chromeWindows)],
    ['Edge on a Windows laptop', here(UA.edgeWindows)],
    ['Chrome on an Android phone', here(UA.chromeAndroid)],
    ['Safari on an iPhone', here(UA.safariIphone)],
    ['Firefox on Windows', here(UA.firefoxWindows, { speech: false })],
  ])('%s gets the model', (_, browser) => {
    expect(engineFor('browser_model', browser)).toBe('model')
  })

  it('never falls back to the service, so the voice never leaves the device', () => {
    expect(engineFor('browser_model', here(UA.chromeWindows, { model: false }))).toBeNull()
  })
})

describe('with typing', () => {
  it.each<[string, Here]>([
    ['Chrome on a laptop', here(UA.chromeWindows)],
    ['Safari on an iPhone', here(UA.safariIphone)],
  ])('%s has no mic', (_, browser) => {
    expect(engineFor('typing', browser)).toBeNull()
  })
})

describe('which device it is, for "Getting voice ready on this phone"', () => {
  it.each<[string, BrowserFacts, string]>([
    ['an iPhone', here(UA.safariIphone, { touchPoints: 5 }), 'phone'],
    ['the installed app on an iPhone', here(UA.installedIphone, { touchPoints: 5 }), 'phone'],
    ['an iPad that says it is a Mac', IPAD_AS_MAC, 'tablet'],
    ['an Android phone', here(UA.chromeAndroid), 'phone'],
    ['an Android tablet', here(UA.chromeAndroidTablet), 'tablet'],
    ['a Windows laptop', here(UA.firefoxWindows), 'computer'],
    ['a Mac', here(UA.safariMac), 'computer'],
  ])('%s is a %s', (_, facts, kind) => {
    expect(deviceKind(facts)).toBe(kind)
  })
})

describe('the move to the model, remembered on this device', () => {
  function storage(): Storage {
    const kept = new Map<string, string>()
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => {
        kept.set(key, value)
      },
      removeItem: (key: string) => {
        kept.delete(key)
      },
    } as unknown as Storage
  }

  it('is kept, and read back', () => {
    const kept = storage()
    expect(movedToModel(kept)).toBe(false)
    rememberModel(kept)
    expect(kept.getItem(ENGINE_KEY)).toBe('model')
    expect(movedToModel(kept)).toBe(true)
  })

  it('blocked storage counts as no move, and a write it refuses changes nothing', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    } as unknown as Storage
    expect(movedToModel(blocked)).toBe(false)
    expect(() => {
      rememberModel(blocked)
    }).not.toThrow()
    expect(movedToModel(null)).toBe(false)
  })

  it('is read with the browser and the setting, through the env', () => {
    const kept = storage()
    const env = {
      speech: () => true,
      storage: () => kept,
      browser: (): BrowserFacts => ({ userAgent: UA.chromeWindows, touchPoints: 0, model: true }),
    }
    const pick = (setting: VoiceToolKind) => pickEngine(setting, env)
    expect(pick('browser_service')).toBe('service')
    rememberModel(kept)
    expect(pick('browser_service')).toBe('model')
    expect(pick('typing')).toBeNull()
  })
})
