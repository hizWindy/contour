/**
 * Who got the pre-read, and when (PLAN-V17 "The screens", part 6; PLAN-V19 T2-4):
 * "Sent to Jo Sample and Mia Sample on 26 Nov 2026 at 9:12 am, by Al Sample.", each person
 * with what they got (HubSpot task, Email, when), Try again for a failed task (no email),
 * where the copy on the company in HubSpot stands, and "Send to more people" on a sent
 * pre-read.
 *
 * - **A failed HubSpot task** shows its error line and a quiet "Try again" button that runs the
 *   tasks endpoint only ("Tries the task only. Nobody is emailed.").
 * - **A failed company note copy** shows "Try the HubSpot copy again", as before.
 * - **A pre-read changed after it went** is a draft again: it says when it was last sent, without
 *   retry buttons or "Send to more people" (Check and send comes back in the footer).
 *
 * Takes focus when the send dialog closes after sending so a screen reader hears who got it.
 */
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  History,
  Hourglass,
  MailCheck,
  RefreshCw,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { useId, useState } from 'react'
import { useRetryMeetingTasks, useSendMeetingForm } from '@/api/hooks/meetings'
import type { FormRecipient, HubSpotCopy, MeetingFormOut } from '@/api/types'
import { useCanWrite } from '@/auth/can'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { recipientKey } from './rules'
import {
  CHANGED_AFTER_SENT,
  CHANGED_SINCE_SENT,
  copyNotTriedWords,
  hubspotCopyWords,
  NOBODY_EMAILED_AGAIN,
  recipientLabel,
  recipientStatusWords,
  SEND_TO_MORE,
  sentWords,
  TASK_RETRY_HINT,
  tasksFailedWords,
  tasksNotTriedWords,
  tasksWaitingWords,
  TRY_AGAIN,
  TRY_COPY_AGAIN,
  TRYING_COPY,
  TRYING_TASKS,
} from './words'

/** Each state of the copy in HubSpot: an icon and its ink, beside the words. */
const COPY_LOOK: Readonly<Record<HubSpotCopy['state'], { icon: LucideIcon; ink: string }>> = {
  saved: { icon: CircleCheck, ink: 'text-pass-ink' },
  waiting: { icon: Hourglass, ink: 'text-muted-foreground' },
  off: { icon: CircleMinus, ink: 'text-muted-foreground' },
  failed: { icon: CircleAlert, ink: 'text-destructive-ink' },
}

function recipientLook(recipient: FormRecipient): { icon: LucideIcon; ink: string } {
  if (recipient.task === 'failed') return { icon: CircleAlert, ink: 'text-destructive-ink' }
  if (recipient.task === 'waiting') return { icon: Hourglass, ink: 'text-muted-foreground' }
  return { icon: CircleCheck, ink: 'text-pass-ink' }
}

/**
 * Where the company note copy in HubSpot stands, and for one that failed, the way to try it
 * again without emailing anyone new.
 */
function CopyLine({
  form,
  copy,
  canWrite,
}: {
  form: MeetingFormOut
  copy: HubSpotCopy
  canWrite: boolean
}) {
  const send = useSendMeetingForm(form.id)
  const [problem, setProblem] = useState<string | null>(null)
  const hintId = useId()
  const { icon: Icon, ink } = COPY_LOOK[copy.state]
  const ownerIds = form.sent_to
    .map((person) => person.owner_id)
    .filter((id): id is string => id !== null && id !== '')
  const emails = form.sent_to
    .filter((person) => person.owner_id === null && person.address)
    .map((person) => person.address as string)
  const hasTargets = ownerIds.length > 0 || emails.length > 0

  const tryAgain = (): void => {
    setProblem(null)
    send.mutate(
      { ownerIds, emails, emailThem: false },
      {
        onError: (error) => {
          setProblem(copyNotTriedWords(error))
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p data-slot="hubspot-copy" className={cn('flex items-start gap-2', ink)}>
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{hubspotCopyWords(copy)}</span>
      </p>
      {canWrite && copy.state === 'failed' && hasTargets ? (
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

/**
 * When one or more recipients' HubSpot tasks didn't go, names them cleanly and offers "Try again"
 * (tries the task endpoint only, never emails).
 */
function TasksLine({
  form,
  canWrite,
}: {
  form: MeetingFormOut
  canWrite: boolean
}) {
  const retry = useRetryMeetingTasks(form.id)
  const [problem, setProblem] = useState<string | null>(null)
  const hintId = useId()
  const failed = form.sent_to.filter((person) => person.task === 'failed')
  const waiting = form.sent_to.filter((person) => person.task === 'waiting')
  const emailedAny = form.sent_to.some((person) => person.email)

  if (failed.length === 0 && waiting.length === 0) return null

  const tryAgain = (): void => {
    setProblem(null)
    retry.mutate(undefined, {
      onError: (error) => {
        setProblem(tasksNotTriedWords(error))
      },
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {failed.length > 0 ? (
        <>
          <p data-slot="hubspot-tasks-failed" className="flex items-start gap-2 text-destructive-ink">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{tasksFailedWords(failed, emailedAny)}</span>
          </p>
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                disabled={retry.isPending}
                aria-describedby={hintId}
                onClick={tryAgain}
              >
                <RefreshCw aria-hidden="true" />
                {TRY_AGAIN}
              </Button>
              <p id={hintId} role="status" className="text-caption text-muted-foreground">
                {retry.isPending ? TRYING_TASKS : TASK_RETRY_HINT}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      {waiting.length > 0 ? (
        <p data-slot="hubspot-tasks-waiting" className="flex items-start gap-2 text-muted-foreground">
          <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{tasksWaitingWords(waiting)}</span>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-caption text-destructive-ink">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

export function SentNote({
  form,
  onSendToMore,
}: {
  form: MeetingFormOut
  onSendToMore?: () => void
}) {
  const canWrite = useCanWrite('companies.meetings')
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
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-foreground">{sentWords(form, !sent)}</p>
        {sent && form.sent_to.length > 0 ? (
          <ul data-slot="sent-recipients" className="flex flex-col gap-1.5">
            {form.sent_to.map((recipient, index) => {
              const { icon: RowIcon, ink } = recipientLook(recipient)
              const status = recipientStatusWords(recipient)
              return (
                <li
                  key={`${recipientKey(recipient)}:${String(index)}`}
                  data-slot="sent-recipient"
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption"
                >
                  <span className={cn('flex items-center gap-1.5 font-semibold text-foreground')}>
                    <RowIcon aria-hidden="true" className={cn('size-3.5 shrink-0', ink)} />
                    <span>{recipientLabel(recipient)}</span>
                  </span>
                  {status ? <span className="text-muted-foreground">{status}</span> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
        {sent ? <TasksLine form={form} canWrite={canWrite} /> : null}
        {sent && form.hubspot_copy ? (
          <CopyLine form={form} copy={form.hubspot_copy} canWrite={canWrite} />
        ) : null}
        {sent && canWrite && onSendToMore ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              onClick={onSendToMore}
            >
              <UserPlus aria-hidden="true" />
              {SEND_TO_MORE}
            </Button>
          </div>
        ) : null}
        <p className="text-caption text-muted-foreground">
          {sent ? CHANGED_AFTER_SENT : CHANGED_SINCE_SENT}
        </p>
      </div>
    </div>
  )
}
