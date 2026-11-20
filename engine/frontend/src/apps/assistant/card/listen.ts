/**
 * After a spoken command, the card listens 5 seconds for "send it" or "cancel", and nothing else
 * (PLAN-V22 T3-4, choice 23). Any key or click on the card stops it (the card calls `stop`).
 *
 * It uses the mic card's own session (`MicSession`: the check, the voice tool and the name fix)
 * and reads what it heard at each change, so "send it" counts the moment it is heard. Words that
 * don't end on one of the two are ignored, and the listening goes on until the 5 seconds end. A
 * mic that fails ends it quietly: Enter still sends.
 *
 * The sound is never kept or sent: the session lets the mic go the moment it ends.
 *
 * It follows the voice tool setting (PLAN-V24 T4-3): the mic session picks the engine from it, the
 * browser's service or the model on the device, as the voice bar's session does.
 */
import type { VoiceToolKind } from '@/api/types'
import { MicSession, type MicEnv } from '@/apps/companies/call-notes/mic/session'
import type { VoiceToolMaker } from '@/apps/companies/call-notes/mic/voice-tool'
import { sendOrCancel } from './draft'

/** How long the card listens for "send it" (choice 23). */
export const LISTEN_MS = 5000

export interface ListenOptions {
  onSend: () => void
  onCancel: () => void
  /** The listening is over, whatever ended it. */
  onEnd: () => void
  /** The voice tool setting, which the engine follows. Left out: the browser's service. */
  tool?: VoiceToolKind
  env?: MicEnv
  makeTool?: VoiceToolMaker | null
  ms?: number
}

/**
 * Starts listening. The returned function stops it: any key or click (the listening is over, and
 * `onEnd` says so), or `quietly` as the card lets go of it, when nothing more is wanted.
 */
export function listenForSendIt({
  onSend,
  onCancel,
  onEnd,
  tool = 'browser_service',
  env,
  makeTool,
  ms = LISTEN_MS,
}: ListenOptions): (quietly?: boolean) => void {
  let over = false
  const mic = new MicSession({
    mode: 'note',
    tool,
    names: [],
    ...(env ? { env } : {}),
    ...(makeTool === undefined ? {} : { makeTool }),
  })
  const end = (quietly = false): void => {
    if (over) return
    over = true
    window.clearTimeout(timer)
    unsubscribe()
    mic.close()
    if (!quietly) onEnd()
  }
  const unsubscribe = mic.subscribe(() => {
    if (over) return
    const snapshot = mic.getSnapshot()
    // "Silent" only says no voice came yet: the words may still come.
    if (snapshot.phase === 'failed' && snapshot.problem !== 'silent') {
      end()
      return
    }
    const heard = sendOrCancel(mic.text())
    if (heard === null) return
    end()
    if (heard === 'send') onSend()
    else onCancel()
  })
  const timer = window.setTimeout(() => {
    end()
  }, ms)
  mic.start()
  return end
}
