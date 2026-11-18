/**
 * On a phone, Today's main button is "Speak", pinned at the bottom (PLAN-V22 choice 13): there is
 * no V key on a phone. It opens the voice bar, as V does. Not for a Viewer (choice 18). It looks
 * like the other bars pinned at the bottom of a phone (the company page's "Prep a call"), and what
 * the keyboard lands on scrolls above it.
 */
import { Mic } from 'lucide-react'
import { useIsViewer } from '@/auth/can'
import { Button } from '@/components/ui/button'
import { useBarRoom } from '@/lib/use-bar-room'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { openVoiceBar } from '../voice/store'
import { SPEAK } from './words'

export function SpeakBar() {
  const phone = useMediaQuery(PHONE)
  const viewer = useIsViewer()
  const shown = phone && !viewer
  const barRoom = useBarRoom(shown)
  if (!shown) return null
  return (
    <div
      ref={barRoom}
      data-slot="speak-bar"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <Button type="button" size="lg" className="flex-1" onClick={openVoiceBar}>
        <Mic aria-hidden="true" />
        {SPEAK}
      </Button>
    </div>
  )
}
