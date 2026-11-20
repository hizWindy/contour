/**
 * Which engine turns speech into words on this device (PLAN-V24 T4-3, choices 22 and 27): the
 * browser's own live speech service, or the free model on the device. The choice is pure code
 * (`engineFor`), so the tests prove it browser by browser. The browser is read in one place
 * (`browserFacts`).
 *
 * - **`browser_service`** (live now): the browser's service where it is strong, and the model where
 *   it is weak or missing.
 *   - The service: Chrome or Edge on a laptop, and Chrome on Android.
 *   - The model: any browser on an iPhone or iPad (the installed app too), Safari on a Mac, and
 *     Firefox. An iPad can say it is a Mac, so its touch points tell it apart.
 *   - The model too, anywhere the service didn't start within 5 seconds once: the mic session
 *     remembers that on this device (`rememberModel`).
 * - **`browser_model`:** the model on every device, for anyone who wants the voice never to leave
 *   it.
 * - **`typing`:** no mic, as before.
 *
 * S2 (the iPhone test) can change the list. Nothing here loads the model: see `voice-ready.ts`.
 */
import type { VoiceToolKind } from '@/api/types'

/** The browser's live speech service, or the model on the device. */
export type Engine = 'service' | 'model'

/** What the choice needs to know about the browser. Tests give made-up ones. */
export interface BrowserFacts {
  userAgent: string
  /** How many touch points the screen has: an iPad that says it is a Mac has several. */
  touchPoints: number
  /** The model can run here: a Web Worker, WebAssembly and the sound tap (an AudioWorklet). */
  model: boolean
}

/** Everything the choice reads: the browser, its speech service, and this device's memory. */
export interface Here extends BrowserFacts {
  /** The browser has a speech service (the Web Speech API). */
  speech: boolean
  /** The service didn't start here once, so this device uses the model (choice 22). */
  movedToModel: boolean
}

/** A phone, a tablet or a computer: for "Getting voice ready on this phone". */
export type DeviceKind = 'phone' | 'tablet' | 'computer'

const IOS = /\b(iPhone|iPad|iPod)\b/
const MAC = /\bMacintosh\b/
const FIREFOX = /\b(Firefox|FxiOS)\//
/** Chrome, Edge, and the other browsers built on Chromium, on any system. */
const CHROMIUM = /\b(Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS)\//

/** An iPhone or an iPad, the installed app too. iPadOS can show a Mac's user agent. */
export function isAppleMobile({ userAgent, touchPoints }: BrowserFacts): boolean {
  return IOS.test(userAgent) || (MAC.test(userAgent) && touchPoints > 1)
}

/** The browser's service is weak or missing here (choice 22): the model does better. */
export function serviceIsWeak(here: Here): boolean {
  const { userAgent } = here
  const safariOnMac = MAC.test(userAgent) && !CHROMIUM.test(userAgent) && !FIREFOX.test(userAgent)
  return !here.speech || isAppleMobile(here) || FIREFOX.test(userAgent) || safariOnMac
}

/**
 * The engine for the setting on this device, or null for no mic: typing, or a browser that can run
 * neither. `browser_model` never falls back to the service, so the voice never leaves the device.
 */
export function engineFor(setting: VoiceToolKind, here: Here): Engine | null {
  if (setting === 'typing') return null
  const model = setting === 'browser_model' || here.movedToModel || serviceIsWeak(here)
  if (model && here.model) return 'model'
  return setting === 'browser_service' && here.speech ? 'service' : null
}

/** A phone, a tablet or a computer, from the user agent. */
export function deviceKind(facts: BrowserFacts): DeviceKind {
  const { userAgent } = facts
  if (/\b(iPhone|iPod)\b/.test(userAgent)) return 'phone'
  if (isAppleMobile(facts)) return 'tablet'
  if (/\bAndroid\b/.test(userAgent)) return /\bMobile\b/.test(userAgent) ? 'phone' : 'tablet'
  return 'computer'
}

// --- The browser and this device's memory --------------------------------------------------------

/** This browser. */
export function browserFacts(): BrowserFacts {
  if (typeof navigator === 'undefined') return { userAgent: '', touchPoints: 0, model: false }
  return {
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints || 0,
    model:
      typeof Worker === 'function' &&
      typeof WebAssembly === 'object' &&
      typeof AudioWorkletNode === 'function',
  }
}

/** True when the browser has a speech service (the Web Speech API), like `voice-tool.ts` reads it. */
function hasSpeechService(): boolean {
  if (typeof window === 'undefined') return false
  const found = window as unknown as {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  }
  return Boolean(found.SpeechRecognition ?? found.webkitSpeechRecognition)
}

/** Where this device keeps that the service didn't start here. Only the word "model". */
export const ENGINE_KEY = 'contour-voice-engine'
const MODEL = 'model'

/** The service didn't start on this device once (choice 22). Blocked storage says no. */
export function movedToModel(storage: Storage | null): boolean {
  try {
    return storage?.getItem(ENGINE_KEY) === MODEL
  } catch {
    return false
  }
}

/** Remembers that the service didn't start here: this device uses the model from now on. */
export function rememberModel(storage: Storage | null): void {
  try {
    storage?.setItem(ENGINE_KEY, MODEL)
  } catch {
    // Storage is blocked or full: the move holds for this opening only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** What `pickEngine` reads. The mic session's `MicEnv` has the same parts, so it fits. */
export interface EngineEnv {
  speech: () => boolean
  storage: () => Storage | null
  /** The browser. Left out: this one. */
  browser?: () => BrowserFacts
}

const BROWSER: EngineEnv = { speech: hasSpeechService, storage: safeStorage, browser: browserFacts }

/** Everything about this device the choice reads, through `env`. */
export function hereOf(env: EngineEnv = BROWSER): Here {
  return {
    ...(env.browser ?? browserFacts)(),
    speech: env.speech(),
    movedToModel: movedToModel(env.storage()),
  }
}

/** The engine for the setting on this device. */
export function pickEngine(setting: VoiceToolKind, env: EngineEnv = BROWSER): Engine | null {
  return engineFor(setting, hereOf(env))
}
