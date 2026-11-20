/**
 * Hears the mic's track for the on-device voice tool (PLAN-V24 T4-2): our own cleaned track, the one
 * the mic session opened. The sound goes into an AudioWorklet (capture.worklet.ts) and comes back
 * in chunks, which the tool hands to the Web Worker. Nothing is played, recorded or sent anywhere.
 */

import tapUrl from './capture.worklet.ts?worker&url'

/** Starts hearing a track. Gives the sound in chunks at the mic's own rate, and a way to stop. */
export async function captureSound(
  track: MediaStreamTrack,
  onSound: (samples: Float32Array, rate: number) => void,
): Promise<() => void> {
  // The mic's own rate: asking for 16 kHz here fails in Firefox, so the worker changes the rate.
  const context = new AudioContext()
  try {
    await context.audioWorklet.addModule(tapUrl)
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const tap = new AudioWorkletNode(context, 'contour-sound-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
    tap.port.onmessage = (event: MessageEvent<Float32Array>) =>
      onSound(event.data, context.sampleRate)
    source.connect(tap)
    // Not awaited: a phone may hold the sound until a tap, and the tool shouldn't hang on it.
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    return () => {
      tap.port.onmessage = null
      source.disconnect()
      void context.close().catch(() => undefined)
    }
  } catch (error) {
    void context.close().catch(() => undefined)
    throw error
  }
}
