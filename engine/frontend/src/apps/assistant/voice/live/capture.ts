/**
 * Live voice's sound in, on the page (PLAN-V28 T2-1): the mic's stream goes into the capture
 * worklet (`capture.worklet.ts`), on an audio context at the device's own rate, and its 20 ms
 * pieces come back here, each with its loudness. The bars read the same sound through an analyser,
 * as the mic card's do. Nothing is played or kept: the pieces go to the silence gate, and from it
 * to the relay.
 */
import { barSource } from '@/apps/companies/call-notes/mic/session'
import type { BarSource } from '@/components/motion/bar-levels'
import tapUrl from './capture.worklet.ts?worker&url'
import type { Frame } from './dsp'

/** The mic's sound, cut into pieces: its bars, a move to another mic, and the end. */
export interface SoundIn {
  bars: BarSource | null
  /** Hears another mic's stream (a headset plugged in): its pieces carry on in the same tap. */
  swap: (stream: MediaStream) => void
  close: () => void
}

/** Opens the tap. Tests give a fake one (`TalkEnv.capture`). */
export type OpenCapture = (
  context: AudioContext,
  stream: MediaStream,
  onFrame: (frame: Frame) => void,
) => Promise<SoundIn>

/** The bars' analyser, as the mic card sets its own (`MicSession`). */
function analyserOn(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.minDecibels = -80
  analyser.maxDecibels = -20
  analyser.smoothingTimeConstant = 0.5
  return analyser
}

export const openCapture: OpenCapture = async (context, stream, onFrame) => {
  await context.audioWorklet.addModule(tapUrl)
  const tap = new AudioWorkletNode(context, 'contour-live-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  tap.port.onmessage = (event: MessageEvent<Frame>) => {
    onFrame(event.data)
  }
  const analyser = analyserOn(context)
  let source = context.createMediaStreamSource(stream)
  source.connect(tap)
  source.connect(analyser)
  // Not awaited: a phone may hold the sound until a tap, and the talk shouldn't hang on it.
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  return {
    bars: barSource(analyser),
    swap: (next) => {
      source.disconnect()
      source = context.createMediaStreamSource(next)
      source.connect(tap)
      source.connect(analyser)
    },
    close: () => {
      tap.port.onmessage = null
      source.disconnect()
      tap.disconnect()
    },
  }
}
