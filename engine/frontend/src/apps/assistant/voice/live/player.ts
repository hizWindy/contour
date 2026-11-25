/**
 * The Assistant's voice, on the page (PLAN-V28 T2-2): Gemini's 24 kHz sound goes to the playback
 * worklet (`playback.worklet.ts`, its buffer is `PlaybackCore` in `dsp.ts`) and out of the
 * speakers. The page sends it the sound as it comes, `flush` on `interrupted`, `duck` while the rep
 * starts to talk over it, and `end` as Gemini's turn ends. It says when it is speaking, for the
 * pill: from the first sound out until its buffer is empty. Nothing is kept.
 */
import tapUrl from './playback.worklet.ts?worker&url'
import type { FromPlayer, ToPlayer } from './dsp'

/** The Assistant's voice out. */
export interface SoundOut {
  /** Gemini's sound: 16-bit little-endian PCM at 24 kHz. */
  push: (pcm: ArrayBuffer) => void
  /** `interrupted`: it empties within one 20 ms piece. */
  flush: () => void
  /** A third while the rep starts to talk over it, or back. */
  duck: (on: boolean) => void
  /** Gemini's turn ended: what is left plays out, then "speaking" ends. */
  end: () => void
  close: () => void
}

/** Opens the player. Tests give a fake one (`TalkEnv.player`). */
export type OpenPlayer = (
  context: AudioContext,
  onSpeaking: (speaking: boolean) => void,
) => Promise<SoundOut>

export const openPlayer: OpenPlayer = async (context, onSpeaking) => {
  await context.audioWorklet.addModule(tapUrl)
  const node = new AudioWorkletNode(context, 'contour-live-playback', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  node.port.onmessage = (event: MessageEvent<FromPlayer>) => {
    onSpeaking(event.data.type === 'speaking')
  }
  node.connect(context.destination)
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  const send = (message: ToPlayer, transfer: Transferable[] = []): void => {
    node.port.postMessage(message, transfer)
  }
  return {
    push: (pcm) => {
      send({ type: 'sound', pcm }, [pcm])
    },
    flush: () => {
      send({ type: 'flush' })
    },
    duck: (on) => {
      send({ type: 'duck', on })
    },
    end: () => {
      send({ type: 'end' })
    },
    close: () => {
      node.port.onmessage = null
      node.disconnect()
    },
  }
}
