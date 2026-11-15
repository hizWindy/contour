/**
 * One meeting on Meetings (PLAN-V17 "The screens", part 5): when, the company, the title, Teams or
 * in person, then one status and one button. A list used all day barely moves (principles 02
 * #20), so a row never fades, slides or glides: a new status simply shows.
 *
 * - **Needs pre-read:** "Draft it" starts the form, then the pre-read's page opens. While the
 *   server answers, the row already says "Drafting". If it says no, the row goes back and a toast
 *   says why.
 * - **Drafting, Sent, Draft failed:** "Open". **Draft ready:** "Check and send". Both open the
 *   pre-read's page.
 * - **A past meeting** says whether what was said is logged. Its button, "Log meeting", comes with
 *   T3-11 (`PastAction`): its place is kept, so the rows don't move then.
 * - **A cancelled meeting** says "Cancelled", dimmed with the quieter text colour, never lower
 *   opacity, so every line stays readable (as a card left out of a batch is). It keeps "Open"
 *   while it has a pre-read.
 *
 * Each button's name ends with the meeting ("Draft it: Sample Logistics Pty Ltd, 10:00 am") for a
 * screen reader, which hears many such buttons in a list.
 */
import {
  Ban,
  CircleCheck,
  CircleX,
  FileCheck,
  FilePlus,
  Hourglass,
  MailCheck,
  MapPin,
  Notebook,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useStartMeetingForm } from '@/api/hooks/meetings'
import type { MeetingItem } from '@/api/v17'
import { Button } from '@/components/ui/button'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { preReadHref } from './params'
import { rowStatus, type RowStatus } from './rows'
import { CHECK_AND_SEND, DRAFT_IT, NO_OWNER, OPEN, STATUS_WORDS, WHERE_WORDS, YOURS } from './words'

/** Each status's icon and ink. Done is Olive and a failure Terracotta, as on Activity. */
const STATUS_LOOK: Readonly<Record<RowStatus, { icon: LucideIcon; ink: string }>> = {
  needs: { icon: FilePlus, ink: 'text-foreground' },
  drafting: { icon: Hourglass, ink: 'text-muted-foreground' },
  draft: { icon: FileCheck, ink: 'text-foreground' },
  sent: { icon: MailCheck, ink: 'text-pass-ink' },
  failed: { icon: CircleX, ink: 'text-destructive-ink' },
  notes_logged: { icon: CircleCheck, ink: 'text-pass-ink' },
  no_notes: { icon: Notebook, ink: 'text-muted-foreground' },
  cancelled: { icon: Ban, ink: 'text-muted-foreground' },
}

export interface MeetingRowProps {
  item: MeetingItem
  /** When it is, as its group writes it: "10:00 am", "Thu, 10:00 am", "Yesterday, 4:00 pm". */
  when: string
  past: boolean
  /** The team's list: each row says whose meeting it is. */
  team: boolean
}

/** A past meeting's button. "Log meeting" and its transcript box come with T3-11. */
function PastAction(): ReactNode {
  return null
}

export function MeetingRow({ item, when, past, team }: MeetingRowProps) {
  const start = useStartMeetingForm()
  const navigate = useNavigate()
  // "Draft it" shows its result at once: the row says Drafting while the server answers.
  const status: RowStatus = start.isPending ? 'drafting' : rowStatus(item, past)
  const cancelled = status === 'cancelled'
  const { icon: StatusIcon, ink } = STATUS_LOOK[status]
  const where = item.where === 'unknown' ? null : item.where
  const WhereIcon = where === 'online' ? Video : MapPin
  const owner = team ? (item.mine ? YOURS : (item.owner ?? NO_OWNER)) : null
  const context = <span className="sr-only">{`: ${item.company_name}, ${when}`}</span>
  const meetingId = item.id

  let action: ReactNode = null
  if (past) {
    action = <PastAction />
  } else if (item.form && !start.isPending) {
    action = (
      <Button asChild variant="outline" size="sm" className="touch:h-11">
        <Link to={preReadHref(item.form.id)}>
          {status === 'draft' ? CHECK_AND_SEND : OPEN}
          {context}
        </Link>
      </Button>
    )
  } else if (!cancelled && meetingId !== null) {
    action = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="touch:h-11"
        disabled={start.isPending}
        onClick={() => {
          start.mutate(
            { body: { meeting_id: meetingId } },
            {
              onSuccess: (form) => {
                void navigate(preReadHref(form.id))
              },
              onError: toastProblem,
            },
          )
        }}
      >
        {DRAFT_IT}
        {context}
      </Button>
    )
  }

  return (
    <li
      data-slot="meeting-row"
      data-status={status}
      className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
    >
      <p
        className={cn(
          'text-ui tabular-nums',
          cancelled ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {when}
      </p>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className={cn(
            'font-semibold break-words',
            cancelled ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {item.company_name}
        </p>
        {item.title.trim() ? (
          <p
            className={cn(
              'line-clamp-1 break-words',
              cancelled ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {item.title}
          </p>
        ) : null}
        {where || owner ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
            {where ? (
              <span className="flex items-center gap-1.5">
                <WhereIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {WHERE_WORDS[where]}
              </span>
            ) : null}
            {owner ? (
              <span className="flex items-center gap-1.5">
                <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
                {owner}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:w-72 sm:flex-nowrap">
        <p className={cn('flex items-center gap-1.5 text-caption', ink)}>
          <StatusIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {STATUS_WORDS[status]}
        </p>
        {action}
      </div>
    </li>
  )
}
