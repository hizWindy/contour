/**
 * The mics on this computer, by the names people know (PLAN-V18 T3-4, "Which mic"), and the one
 * the rep picked, remembered in this browser.
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

/**
 * The real mics, each once: the browser's "default" and "communications" entries are another
 * name for one of them, so they are left out. A mic with no name yet (before the mic is allowed)
 * is called "Mic 1", "Mic 2".
 */
export function micsOf(devices: readonly MediaDeviceInfo[]): MicDevice[] {
  const mics = devices.filter(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications',
  )
  return mics.map((device, index) => ({
    id: device.deviceId,
    name: micName(device.label) || `Mic ${String(index + 1)}`,
  }))
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
