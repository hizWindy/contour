/**
 * Who got the pre-read, and when (PLAN-V17 "The screens", part 6), in plain words: "Sent to Jo
 * Sample and Mia Sample on 26 Nov 2026 at 9:12 am, by Al Sample.", then where its copy in HubSpot
 * stands, in the server's sentence. A pre-read changed after it went is a draft again: it says when
 * it was last sent, and that sending again shares the new words. T3-11 adds the tick and the rest.
 */
import { History, MailCheck } from 'lucide-react'
import type { MeetingFormOut } from '@/api/v17'
import { CHANGED_AFTER_SENT, CHANGED_SINCE_SENT, hubspotCopyWords, sentWords } from './words'

export function SentNote({ form }: { form: MeetingFormOut }) {
  if (!form.sent_at) return null
  const sent = form.status === 'sent'
  const Icon = sent ? MailCheck : History
  return (
    <div
      data-slot="sent-note"
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
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-foreground">{sentWords(form, !sent)}</p>
        {sent && form.hubspot_copy ? (
          <p className="text-muted-foreground">{hubspotCopyWords(form.hubspot_copy)}</p>
        ) : null}
        <p className="text-caption text-muted-foreground">
          {sent ? CHANGED_AFTER_SENT : CHANGED_SINCE_SENT}
        </p>
      </div>
    </div>
  )
}
