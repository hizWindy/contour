/**
 * Which engine turns speech into words on this device (PLAN-V24 T4-3, choices 22 and 27): the
 * browser's own live speech service, or the free model on the device. The choice is pure code
 * (`engineFor`), so the tests prove it browser by browser. The browser is read in one place
 * (`browserFacts`).
 *
 * - **`browser_service`** (live now): the browser's service where it is strong, and the model where
 *   it is weak or missing.
 *   - The service: Google Chrome only, on a computer or Android. Its service (Google's) is the
 *     one proven on the team's laptops.
 *   - The model: every other browser (23 Nov 2026: Edge's service listened and heard nothing).
 *     So Edge, Opera, Samsung Internet, Safari on a Mac, Firefox, and any browser on an iPhone
 *     or iPad (the installed app too). An iPad can say it is a Mac, so its touch points tell it
 *     apart.
 *   - The model too, anywhere the service didn't start within 5 seconds, refused before a word,
 *     or heard a clear voice for 6 seconds and gave no word: the mic session remembers that on
 *     this device (`rememberModel`). That catches a Chromium browser that says it is Chrome,
 *     like Brave.
 * - **`browser_model`:** the model on every device, for anyone who wants the voice never to leave
 *   it.
 * - **`typing`:** no mic, as before.
 *
 * S2 (the iPhone test) can change the list. Nothing here loads the model: see `voice-ready.ts`.
 *
 * **Live voice** (PLAN-V28 T2-3, choices 16 and 25): the voice bar's own engine, `live`, comes
 * first where it may start for this person (`MeOut.live_voice`) and the browser can run it (an
 * AudioWorklet and WebSockets): Gemini listens and talks back through our relay. Only the bar's
 * conversation uses it (`barEngineFor`): the mic session, the card's own 5 seconds and Log call's
 * dictation keep today's engines (`engineFor`), unchanged. Without live voice, the bar's choice is
 * today's, unchanged. The setting `typing` still means no mic at all. With `browser_model`, live
 * voice still comes first for a person the Platform admin turned it on for (TBC with Al-khair).
 */
import type { VoiceToolKind } from '@/api/types'

/** The browser's live speech service, or the model on the device. */
export type Engine = 'service' | 'model'

/** The voice bar's engines: live voice (PLAN-V28), then today's. */
export type BarEngine = Engine | 'live'

/** What the choice needs to know about the browser. Tests give made-up ones. */
export interface BrowserFacts {
  userAgent: string
  /** How many touch points the screen has: an iPad that says it is a Mac has several. */
  touchPoints: number
  /** The model can run here: a Web Worker, WebAssembly and the sound tap (an AudioWorklet). */
  model: boolean
  /**
   * Live voice can run here (PLAN-V28 T2-3): an AudioWorklet and WebSockets. Left out: it can't,
   * so a browser described before PLAN-V28 keeps today's choice.
   */
  live?: boolean
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
/** Chrome's own mark. Other browsers built on Chromium carry it too, so they are taken out below. */
const CHROME = /\bChrome\//
/** Browsers built on Chromium that say "Chrome" but have another speech service, or none. */
const NOT_GOOGLE_CHROME =
  /\b(Edg|EdgA|EdgiOS|OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi|UCBrowser)\//

/** An iPhone or an iPad, the installed app too. iPadOS can show a Mac's user agent. */
export function isAppleMobile({ userAgent, touchPoints }: BrowserFacts): boolean {
  return IOS.test(userAgent) || (MAC.test(userAgent) && touchPoints > 1)
}

/** Google Chrome on a computer or Android: the one browser whose service is proven here. */
export function isGoogleChrome({ userAgent }: BrowserFacts): boolean {
  return CHROME.test(userAgent) && !NOT_GOOGLE_CHROME.test(userAgent)
}

/** The browser's service is weak or missing here (choice 22): the model does better. */
export function serviceIsWeak(here: Here): boolean {
  return !here.speech || isAppleMobile(here) || !isGoogleChrome(here)
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

/**
 * The voice bar's engine (PLAN-V28 T2-3): live voice where it may start for this person
 * (`liveVoice`, from `MeOut.live_voice`) and this browser can run it; else today's choice
 * (`engineFor`), unchanged. Null for no mic: typing, or a browser that can run nothing.
 */
export function barEngineFor(
  setting: VoiceToolKind,
  here: Here,
  liveVoice: boolean,
): BarEngine | null {
  if (setting === 'typing') return null
  if (liveVoice && here.live === true) return 'live'
  return engineFor(setting, here)
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
    live: typeof AudioWorkletNode === 'function' && typeof WebSocket === 'function',
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

/** The voice bar's engine for the setting on this device (PLAN-V28 T2-3). */
export function pickBarEngine(
  setting: VoiceToolKind,
  liveVoice: boolean,
  env: EngineEnv = BROWSER,
): BarEngine | null {
  return barEngineFor(setting, hereOf(env), liveVoice)
}
