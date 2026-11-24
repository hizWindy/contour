/**
 * The bar for the bulk add to HubSpot on Results (PLAN-V27 T3-2, choice 12): "3 selected", a way
 * to clear the selection, and "Add to HubSpot", which opens one preview for the batch
 * (`send-dialog.tsx`). Only people who may send a lead see it (`lead_finder.send_to_hubspot` with
 * write, as the lead card's Send).
 *
 * - **On a laptop** the bar sits above the table all the time, at one height, so ticking the first
 *   lead never moves the rows: with nothing ticked it says what ticking does.
 * - **On a phone** it is fixed at the bottom of the screen, and shows only while a lead is ticked
 *   (as Call logs' Send). A control the keyboard lands on scrolls up above it (`useBarRoom`).
 *
 * At most 25 a batch (choice 13, TBC): beyond that the button is off and the bar says why.
 * After the send, the leads that went (or were in HubSpot already) are unticked. A lead that
 * failed, or was left out, stays ticked, so it can go again.
 */
import { Send, X } from 'lucide-react'
import { useState } from 'react'
import { usePreviewManyHubSpot, useSendManyHubSpot } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { useBarRoom } from '@/lib/use-bar-room'
import { useIsMobile } from '@/lib/use-mobile'
import { cn } from '@/lib/utils'
import { SendDialog } from './send-dialog'
import { ADD, BATCH_MAX, CLEAR, IDLE, overCapWords, selectedWords } from './send-words'

export function SendBar({
  selected,
  onClear,
  onDone,
}: {
  selected: ReadonlySet<string>
  onClear: () => void
  /** Called with the leads that went or were there already, so they can be unticked. */
  onDone: (ids: string[]) => void
}) {
  const preview = usePreviewManyHubSpot()
  const send = useSendManyHubSpot()
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState<string[]>([])
  const count = selected.size
  const over = count > BATCH_MAX

  const start = (ids: string[]): void => {
    send.reset()
    preview.mutate(ids)
  }
  const close = (): void => {
    setOpen(false)
    const done = (send.data?.items ?? [])
      .filter((item) => item.result !== 'failed')
      .map((item) => item.lead_id)
    if (done.length > 0) onDone(done)
    preview.reset()
    send.reset()
  }

  const onPhone = useIsMobile()
  const shown = count > 0 || open
  const room = useBarRoom(onPhone && shown)
  if (onPhone && !shown) return null
  return (
    <section
      ref={room}
      aria-label="Selected leads"
      data-slot="send-many-bar"
      className={cn(
        'flex gap-x-4 gap-y-2 text-ui',
        onPhone
          ? 'fixed inset-x-0 bottom-0 z-20 flex-col items-stretch border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'min-h-14 flex-wrap items-center rounded-lg border bg-card px-4 py-2',
      )}
    >
      {shown ? (
        <>
          <span className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{selectedWords(count)}</span>
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              <X aria-hidden="true" />
              {CLEAR}
            </Button>
          </span>
          {over ? (
            <p id="send-many-cap" className="text-muted-foreground sm:flex-1">
              {overCapWords(count)}
            </p>
          ) : null}
          <Button
            type="button"
            className={onPhone ? 'w-full' : 'ml-auto'}
            disabled={over || count === 0}
            aria-describedby={over ? 'send-many-cap' : undefined}
            onClick={() => {
              const ids = [...selected]
              setAsked(ids)
              setOpen(true)
              start(ids)
            }}
          >
            <Send aria-hidden="true" />
            {ADD}
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">{IDLE}</p>
      )}
      <SendDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        count={asked.length}
        preview={{ data: preview.data, error: preview.error, pending: preview.isPending }}
        sent={{ data: send.data, error: send.error, pending: send.isPending }}
        onPreviewAgain={() => {
          start(asked)
        }}
        onSend={(pairs) => {
          send.mutate(pairs)
        }}
      />
    </section>
  )
}
