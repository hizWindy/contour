/**
 * Hands the mic's sound to the page in chunks of about a tenth of a second (PLAN-V24 T4-2). It runs
 * on the browser's audio thread (an AudioWorklet), so no sound is lost while the page is busy.
 * capture.ts loads it from our own site. It keeps nothing, and plays nothing.
 */

// The audio thread's own names. TypeScript's DOM types don't have them.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & { process: (inputs: Float32Array[][]) => boolean },
): void

class SoundTap extends AudioWorkletProcessor {
  private chunk = new Float32Array(Math.round(sampleRate / 10))
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const sound = inputs[0]?.[0]
    if (!sound) return true
    let at = 0
    while (at < sound.length) {
      const count = Math.min(sound.length - at, this.chunk.length - this.filled)
      this.chunk.set(sound.subarray(at, at + count), this.filled)
      this.filled += count
      at += count
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk, [this.chunk.buffer])
        this.chunk = new Float32Array(this.chunk.length)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('contour-sound-tap', SoundTap)
