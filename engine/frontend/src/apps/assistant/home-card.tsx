/**
 * The Assistant's card on Home (PLAN-V22 T2-3, choice 5): today's counts, each opening where the
 * work is (the tasks due, today's meetings, the calls to confirm and those that need a look), and
 * "Press V to speak". It takes over Call logs' quick buttons, which sat on the Companies card, and
 * the "Upcoming meetings" card, whose place it takes.
 *
 * - **The counts** come from Today's own answer (`GET /today`), the server's 5-minute copy of the
 *   tasks: Home never asks HubSpot again (never `fresh`), and Today opens with them at once. Only
 *   the parts this person sees (`parts`).
 * - **Tasks that can't show:** the server's sentence, in a quiet line, where the count would be.
 * - **Speak:** "Press V to speak" on a laptop, and a Speak button on a touch screen. Not for a
 *   Viewer, who has no V (choice 18).
 * - **It comes late** (`HomeCard.late`), after the other cards, so its coming moves none of them,
 *   and it fades and rises once as it comes. Its code loads late too, so the first visit doesn't
 *   carry it.
 *
 * **The first visit:** as the "Upcoming meetings" card did (PLAN-V17 T3-11), this card draws the
 * Card part's own classes and takes Reveal from the motion kit's index: importing those by their
 * own files from a late file split small parts of the first visit into files of their own.
 */
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  Headset,
  ListTodo,
  Mic,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { useToday } from '@/api/hooks/assistant'
import type { Today } from '@/api/types'
import { callLogsHref } from '@/apps/companies/call-logs/params'
import { useIsViewer } from '@/auth/can'
import { Reveal } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
import { TODAY_PATH } from './paths'
import { sees } from './today/rows'
import {
  callsWaitingWords,
  COUNTS_FAILED,
  LOADING_COUNTS,
  meetingsTodayWords,
  needLookWords,
  OPEN_TODAY,
  PRESS,
  SPEAK,
  tasksDueWords,
  TO_SPEAK,
} from './today/words'
import { openVoiceBar } from './voice/store'
import { ASSISTANT_NAME } from './words'

const TITLE_ID = 'home-assistant'

/** The Card part's own classes (`components/ui/card.tsx`): see "The first visit" above. */
const CARD =
  'flex h-full flex-col gap-4 overflow-hidden rounded-lg border bg-card py-6 text-ui text-card-foreground'

/** A link to another page, which ends in an arrow (DESIGN.md "Home"). */
const LINK =
  'inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline'

/** One count, as a row that opens where its work is. */
function CountRow({
  to,
  icon: Icon,
  words,
  ink,
}: {
  to: string
  icon: LucideIcon
  words: string
  ink?: string
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 items-center gap-3 px-6 py-2.5 transition-colors duration-150 hover:bg-muted focus-visible:-outline-offset-2 touch:min-h-12"
      >
        <Icon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', ink)} />
        <span className="min-w-0 flex-1 font-semibold text-foreground">{words}</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

/** The counts, for the parts this person sees. */
function Counts({ today }: { today: Today }) {
  const due = today.tasks.filter((task) => task.group !== 'soon')
  const overdue = due.filter((task) => task.overdue).length
  const meetings = today.meetings.filter((meeting) => meeting.day === 'today').length
  const sentence = today.tasks_state === 'ok' ? null : today.tasks_sentence?.trim() || null
  return (
    <>
      {sees(today, 'tasks') && sentence ? (
        <p data-slot="tasks-sentence" className="px-6 text-ui text-muted-foreground">
          {sentence}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y border-y">
        {sees(today, 'tasks') && today.tasks_state === 'ok' ? (
          <CountRow
            to={TODAY_PATH}
            icon={ListTodo}
            words={tasksDueWords(due.length, overdue)}
            ink={overdue > 0 ? 'text-review-ink' : undefined}
          />
        ) : null}
        {sees(today, 'meetings') ? (
          <CountRow to={TODAY_PATH} icon={CalendarCheck} words={meetingsTodayWords(meetings)} />
        ) : null}
        {sees(today, 'calls') ? (
          <CountRow
            to={callLogsHref('to_confirm')}
            icon={ClipboardCheck}
            words={callsWaitingWords(today.calls.to_confirm)}
          />
        ) : null}
        {sees(today, 'calls') && today.calls.needs_look > 0 ? (
          <CountRow
            to={callLogsHref('needs_look')}
            icon={TriangleAlert}
            words={needLookWords(today.calls.needs_look)}
            ink="text-review-ink"
          />
        ) : null}
      </ul>
    </>
  )
}

/** The rows' room while the counts are on their way: still, and grey only after 200ms. */
function CountsPending() {
  const shown = useAfter()
  return (
    <div role="status" className="flex flex-col gap-3 border-y px-6 py-3">
      <span className="sr-only">{LOADING_COUNTS}</span>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn('block h-5 w-2/3 rounded-sm', shown ? 'bg-muted' : 'invisible')}
        />
      ))}
    </div>
  )
}

/** "Press V to speak" on a laptop, and the Speak button on a touch screen. */
function Speak() {
  return (
    <div className="px-6">
      <p className="flex items-center gap-1.5 text-ui text-muted-foreground touch:hidden">
        {PRESS}
        <Kbd>V</Kbd>
        {TO_SPEAK}
      </p>
      <Button
        type="button"
        variant="outline"
        className="hidden touch:inline-flex touch:h-11"
        onClick={openVoiceBar}
      >
        <Mic aria-hidden="true" />
        {SPEAK}
      </Button>
    </div>
  )
}

export function AssistantHomeCard() {
  const today = useToday()
  const viewer = useIsViewer()
  let body
  if (today.data) {
    body = <Counts today={today.data} />
  } else if (today.isError) {
    body = <p className="px-6 text-ui text-muted-foreground">{COUNTS_FAILED}</p>
  } else {
    body = <CountsPending />
  }
  return (
    <Reveal className="h-full">
      <section data-slot="card" aria-labelledby={TITLE_ID} className={CARD}>
        <div className="flex items-center gap-3 px-6">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              TONE_CLASSES.companies.tile,
            )}
          >
            <Headset className="size-5" />
          </span>
          <h2 id={TITLE_ID} className="flex-1 text-section font-semibold text-foreground">
            {ASSISTANT_NAME}
          </h2>
          <Link to={TODAY_PATH} aria-label={OPEN_TODAY} className={LINK}>
            Open
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {body}
        {viewer ? null : <Speak />}
      </section>
    </Reveal>
  )
}
