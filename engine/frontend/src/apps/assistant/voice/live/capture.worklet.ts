/**
 * Live voice's sound tap (PLAN-V28 T2-1): it runs on the browser's audio thread (an AudioWorklet),
 * at the device's own rate, so no sound is lost while the page is busy. Each 20 ms piece at 16 kHz
 * (`CaptureCore` in `dsp.ts`: the low-pass filter, then the change of rate) goes to the page, with
 * its loudness, for the silence gate. It keeps nothing and plays nothing. `capture.ts` loads it
 * from our own site.
 */
import { CaptureCore, type Frame } from './dsp'

// The audio thread's own names. TypeScript's DOM types don't have them.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & { process: (inputs: Float32Array[][]) => boolean },
): void

class LiveCapture extends AudioWorkletProcessor {
  private readonly core = new CaptureCore(sampleRate)

  process(inputs: Float32Array[][]): boolean {
    const sound = inputs[0]?.[0]
    if (!sound) return true
    for (const frame of this.core.push(sound)) {
      const message: Frame = frame
      this.port.postMessage(message, [frame.pcm])
    }
    return true
  }
}

registerProcessor('contour-live-capture', LiveCapture)
