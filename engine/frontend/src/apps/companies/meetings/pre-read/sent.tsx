/**
 * Who got the pre-read, and when (PLAN-V17 "The screens", part 6): "Sent to Jo Sample and Mia
 * Sample on 26 Nov 2026 at 9:12 am, by Al Sample.", then where its copy in HubSpot stands, as an
 * icon and words for each state: saved, waiting (for HubSpot write access), off (the company isn't
 * in HubSpot) or failed, in the server's sentence when it sends one.
 *
 * - **The copy again** (T3-11): after a copy that failed, a quiet "Try the HubSpot copy again"
 *   sends it to the same people. On a pre-read that hasn't changed since it went, the server emails
 *   nobody then and only tries the copy, and the button says so. A copy that waits (for HubSpot
 *   write access) can't be tried yet: its line says what it waits for, with no button.
 * - **A pre-read changed after it went** is a draft again: it says when it was last sent, and that
 *   sending again shares the new words. Check and send comes back then. The server keeps the last
 *   send's copy state, but its line and "Try the HubSpot copy again" are left out: on a draft, Send
 *   emails the new words, so a retry that emails nobody no longer fits.
 *
 * It takes the focus after the send dialog closes, so a screen reader hears who got it.
 */
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  History,
  Hourglass,
  MailCheck,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { useId, useState } from 'react'
import { useSendMeetingForm } from '@/api/hooks/meetings'
import type { HubSpotCopy, MeetingFormOut } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CHANGED_AFTER_SENT,
  CHANGED_SINCE_SENT,
  copyNotTriedWords,
  hubspotCopyWords,
  NOBODY_EMAILED_AGAIN,
  sentWords,
  TRY_COPY_AGAIN,
  TRYING_COPY,
} from './words'

/** Each state of the copy in HubSpot: an icon and its ink, beside the words. */
const COPY_LOOK: Readonly<Record<HubSpotCopy['state'], { icon: LucideIcon; ink: string }>> = {
  saved: { icon: CircleCheck, ink: 'text-pass-ink' },
  waiting: { icon: Hourglass, ink: 'text-muted-foreground' },
  off: { icon: CircleMinus, ink: 'text-muted-foreground' },
  failed: { icon: CircleAlert, ink: 'text-destructive-ink' },
}

/**
 * Where the copy stands, and for one that failed, the way to try it again. One that waits for
 * write access says so, with no button: trying it again then can't work.
 */
function CopyLine({ form, copy }: { form: MeetingFormOut; copy: HubSpotCopy }) {
  const send = useSendMeetingForm(form.id)
  const [problem, setProblem] = useState<string | null>(null)
  const hintId = useId()
  const { icon: Icon, ink } = COPY_LOOK[copy.state]
  const again = copy.state === 'failed'
  const to = form.sent_to.map((person) => person.email)

  const tryAgain = (): void => {
    setProblem(null)
    send.mutate(to, {
      onError: (error) => {
        setProblem(copyNotTriedWords(error))
      },
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p data-slot="hubspot-copy" className={cn('flex items-start gap-2', ink)}>
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {hubspotCopyWords(copy)}
      </p>
      {again && to.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            disabled={send.isPending}
            aria-describedby={hintId}
            onClick={tryAgain}
          >
            <RefreshCw aria-hidden="true" />
            {TRY_COPY_AGAIN}
          </Button>
          <p id={hintId} role="status" className="text-caption text-muted-foreground">
            {send.isPending ? TRYING_COPY : NOBODY_EMAILED_AGAIN}
          </p>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-caption text-destructive-ink">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

export function SentNote({ form }: { form: MeetingFormOut }) {
  if (!form.sent_at) return null
  const sent = form.status === 'sent'
  const Icon = sent ? MailCheck : History
  return (
    <div
      data-slot="sent-note"
      // The send dialog puts the focus here when it closes.
      tabIndex={-1}
      className="flex items-start gap-3 rounded-lg border bg-card p-4 text-ui"
    >
      <Icon
        aria-hidden="true"
        className={
          sent
            ? 'mt-0.5 size-5 shrink-0 text-pass-ink'
            : 'mt-0.5 size-5 shrink-0 text-muted-foreground'
        }
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-foreground">{sentWords(form, !sent)}</p>
        {/* A draft again: the last send's copy is no longer the one to act on. */}
        {sent && form.hubspot_copy ? <CopyLine form={form} copy={form.hubspot_copy} /> : null}
        <p className="text-caption text-muted-foreground">
          {sent ? CHANGED_AFTER_SENT : CHANGED_SINCE_SENT}
        </p>
      </div>
    </div>
  )
}
