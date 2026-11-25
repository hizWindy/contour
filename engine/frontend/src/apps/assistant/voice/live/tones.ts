/**
 * Tones made in code, and how strong one frequency is in a sound, for the tests of live voice's
 * sound (PLAN-V28 T2-1, T2-2). Only tests import it; the app never does. No sound is recorded.
 */

/** A sine tone. */
export function tone(hz: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const sound = new Float32Array(Math.round(rate * seconds))
  for (let index = 0; index < sound.length; index += 1) {
    sound[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / rate)
  }
  return sound
}

/** How strong one frequency is in a sound, as the amplitude of a sine (the Goertzel algorithm). */
export function strength(sound: Float32Array, hz: number, rate: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / rate)
  let one = 0
  let two = 0
  for (const sample of sound) {
    const next = sample + coefficient * one - two
    two = one
    one = next
  }
  const power = one * one + two * two - coefficient * one * two
  return (2 * Math.sqrt(Math.max(0, power))) / sound.length
}
