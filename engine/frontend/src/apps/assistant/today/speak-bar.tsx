/**
 * On a phone, Today's main button is "Speak", pinned at the bottom (PLAN-V22 choice 13): there is
 * no V key on a phone. It opens the voice bar, as V does. Not for a Viewer (choice 18). It looks
 * like the other bars pinned at the bottom of a phone (the company page's "Prep a call"), and what
 * the keyboard lands on scrolls above it.
 *
 * While the voice bar is open it sits where this bar is, so this one steps aside (PLAN-V23 T4-4),
 * and comes back as the voice bar goes. Its room at the end of the page stays, so nothing jumps.
 */
import { Mic } from 'lucide-react'
import { useIsViewer } from '@/auth/can'
import { Button } from '@/components/ui/button'
import { useBarRoom } from '@/lib/use-bar-room'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { openVoiceBar, useVoiceBarOpen } from '../voice/store'
import { SPEAK } from './words'

export function SpeakBar() {
  const phone = useMediaQuery(PHONE)
  const viewer = useIsViewer()
  const voiceOpen = useVoiceBarOpen()
  const shown = phone && !viewer
  const barRoom = useBarRoom(shown && !voiceOpen)
  if (!shown) return null
  return (
    <>
      {/* The page ends above the bar, as the company page's does, with the phone's safe area. */}
      <div
        aria-hidden="true"
        data-slot="speak-room"
        className="h-[calc(5rem+env(safe-area-inset-bottom))]"
      />
      <div
        ref={barRoom}
        data-slot="speak-bar"
        // Stepped aside, not taken away: the voice bar gives the focus back to this button.
        hidden={voiceOpen}
        className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <Button type="button" size="lg" className="flex-1" onClick={openVoiceBar}>
          <Mic aria-hidden="true" />
          {SPEAK}
        </Button>
      </div>
    </>
  )
}
