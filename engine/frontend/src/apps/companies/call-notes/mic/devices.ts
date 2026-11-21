/**
 * The mics on this computer, by the names people know (PLAN-V18 T3-4, "Which mic"), the one the
 * rep picked, remembered in this browser, and the computer's default one (PLAN-V24 T1-2).
 */

export interface MicDevice {
  id: string
  name: string
}

/** Where the picked mic is kept in this browser. Only its id: nothing about the voice. */
export const MIC_KEY = 'contour-mic'

/** The name a browser gives a mic, made readable: no "Default - " and no USB code at the end. */
export function micName(label: string): string {
  const name = label
    .replace(/^(Default|Communications)\s*-\s*/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim()
  return name
}

/** Chrome's and Edge's other names for one of the real mics. */
function isAlias(device: MediaDeviceInfo): boolean {
  return device.deviceId === 'default' || device.deviceId === 'communications'
}

/** The real mics, as the browser lists them. */
function realMics(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((device) => device.kind === 'audioinput' && !isAlias(device))
}

/**
 * The real mics, each once: the browser's "default" and "communications" entries are another
 * name for one of them, so they are left out. A mic with no name yet (before the mic is allowed)
 * is called "Mic 1", "Mic 2".
 */
export function micsOf(devices: readonly MediaDeviceInfo[]): MicDevice[] {
  return realMics(devices).map((device, index) => ({
    id: device.deviceId,
    name: micName(device.label) || `Mic ${String(index + 1)}`,
  }))
}

/**
 * The mic the computer uses when none is picked (PLAN-V24 T1-2): browsers list it first. Chrome
 * and Edge list it as "default", another name for one of the real mics, which is found by its
 * name, then by its group (the headset it belongs to). Null when there is no mic.
 */
export function defaultMic(devices: readonly MediaDeviceInfo[]): MicDevice | null {
  const first = devices.find((device) => device.kind === 'audioinput')
  if (!first) return null
  const mics = micsOf(devices)
  if (!isAlias(first)) return mics.find((mic) => mic.id === first.deviceId) ?? null
  const name = micName(first.label)
  const real = realMics(devices)
  const same =
    (name === '' ? undefined : real.find((device) => micName(device.label) === name)) ??
    real.find((device) => device.groupId !== '' && device.groupId === first.groupId)
  return (
    mics.find((mic) => mic.id === same?.deviceId) ?? (name ? { id: first.deviceId, name } : null)
  )
}

/** True when there is at least one mic, the browser's own entries included. */
export function hasMic(devices: readonly MediaDeviceInfo[]): boolean {
  return devices.some((device) => device.kind === 'audioinput')
}

/** The mic the rep picked on this computer, or null. */
export function rememberedMic(storage: Storage | null = safeStorage()): string | null {
  try {
    return storage?.getItem(MIC_KEY) ?? null
  } catch {
    return null
  }
}

/** Remembers the picked mic (or forgets it, with null). */
export function rememberMic(id: string | null, storage: Storage | null = safeStorage()): void {
  try {
    if (id) storage?.setItem(MIC_KEY, id)
    else storage?.removeItem(MIC_KEY)
  } catch {
    // A browser that keeps nothing: the default mic is used next time.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
