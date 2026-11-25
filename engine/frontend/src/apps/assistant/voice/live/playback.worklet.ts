/**
 * The Assistant's voice (PLAN-V28 T2-2): it runs on the browser's audio thread (an AudioWorklet)
 * and plays Gemini's 24 kHz sound through a small buffer (`PlaybackCore` in `dsp.ts`). The page
 * sends it the sound as it comes, `flush` on `interrupted`, `duck` while the rep starts to talk
 * over it, and `end` when Gemini's turn is over. It tells the page when it starts speaking and
 * when it goes quiet. It keeps nothing: what has played is gone. `player.ts` loads it.
 */
import { fromPcm16, PlaybackCore, RATE_OUT, type FromPlayer, type ToPlayer } from './dsp'

// The audio thread's own names. TypeScript's DOM types don't have them.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
  },
): void

class LivePlayback extends AudioWorkletProcessor {
  private readonly core = new PlaybackCore({ rate: sampleRate, sourceRate: RATE_OUT })

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<ToPlayer>) => {
      const message = event.data
      switch (message.type) {
        case 'sound':
          this.core.push(fromPcm16(message.pcm))
          break
        case 'flush':
          this.core.flush()
          break
        case 'duck':
          this.core.duck(message.on)
          break
        case 'end':
          this.core.end()
          break
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0]
    const first = channels?.[0]
    if (!channels || !first) return true
    const change = this.core.pull(first)
    for (const other of channels.slice(1)) other.set(first)
    if (change) {
      const message: FromPlayer = { type: change }
      this.port.postMessage(message)
    }
    return true
  }
}

registerProcessor('contour-live-playback', LivePlayback)
