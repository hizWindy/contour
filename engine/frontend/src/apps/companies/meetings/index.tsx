/**
 * Meetings (PLAN-V17 T3-9, "The screens" part 5), at /companies/meetings: the client meetings,
 * each with where its pre-read stands, and one button to move it on.
 *
 * - **Upcoming** (grouped Today, Tomorrow, This week, Later, in Melbourne days) and **Past**,
 *   picked with `Segmented`. The rep's own meetings first, with a switch for the team's. A search
 *   finds a meeting by company, title or date words. All of it is in the address (`params.ts`).
 * - **One status and one button a row** (`meeting-row.tsx`): Needs pre-read (Draft it), Drafting
 *   (Open), Draft ready (Check and send), Sent (Open), Draft failed (Open). Past rows say whether
 *   what was said is logged; T3-11 adds "Log meeting" there.
 * - **New pre-read** in the header, for a meeting that isn't in HubSpot (`new-pre-read.tsx`).
 * - **The states:** loading (a still skeleton after 200ms), empty, and an error. Two different
 *   "offs" stay apart. While meetings can't be read from HubSpot (`status` waiting, or off when
 *   HubSpot isn't connected), one quiet line says so in the server's words, the rows the server
 *   has still show, and New pre-read still works. With the pre-meeting forms switch off
 *   (`enabled`), the page says so, and stays in the menu (Al-khair, 15 Nov).
 *
 * The page has no Navy button of its own: the work is on the rows, and each row's button is
 * quiet, so a list of drafts ready never shows five Navy buttons. New pre-read's dialog has one.
 */
import { CalendarCheck } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { isMeetingFormsOff, useMeetingOptions, useMeetings } from '@/api/hooks/meetings'
import type { MeetingOptions } from '@/api/v17'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { MeetingList } from './meeting-list'
import { NewPreRead } from './new-pre-read'
import { meetingsQuery, readMeetings, writeMeetings, type MeetingsView } from './params'
import { MeetingFormsOff, MeetingsPending, WaitingLine } from './states'
import { MeetingsToolbar } from './toolbar'
import {
  EMPTY_WAITING,
  emptyWords,
  LOAD_FAILED,
  MEETINGS_DESCRIPTION,
  MEETINGS_TITLE,
  noMatchWords,
} from './words'

function MeetingsBody({
  view,
  options,
  today,
  onChange,
}: {
  view: MeetingsView
  options: MeetingOptions
  today: string
  onChange: (changes: Partial<MeetingsView>) => void
}) {
  const list = useMeetings(meetingsQuery(view))
  // The list's own word on HubSpot is the newer; the switches' stands in until it comes.
  const status = list.data?.status ?? options.status
  const waitingFor = list.data ? list.data.waiting_for : options.waiting_for
  const waiting = status !== 'ready'

  if (isMeetingFormsOff(list.error)) return <MeetingFormsOff />

  let content
  if (list.error && !list.data) {
    content = (
      <ErrorState error={list.error} context={LOAD_FAILED} onRetry={() => void list.refetch()} />
    )
  } else if (!list.data) {
    content = <MeetingsPending />
  } else if (list.data.items.length === 0 && view.page === 0) {
    const words =
      view.q.trim() !== ''
        ? noMatchWords(view.q, view.when)
        : waiting
          ? EMPTY_WAITING
          : emptyWords(view.when, view.team)
    content = (
      <EmptyState
        title={words.title}
        description={words.description}
        headingLevel={2}
        className={list.isPlaceholderData ? 'opacity-60' : undefined}
      />
    )
  } else {
    content = (
      <MeetingList
        page={list.data}
        view={view}
        today={today}
        dimmed={list.isPlaceholderData}
        onPage={(page) => {
          onChange({ page })
        }}
      />
    )
  }

  return (
    <>
      {waiting ? <WaitingLine sentence={waitingFor} /> : null}
      <MeetingsToolbar view={view} onChange={onChange} />
      {content}
    </>
  )
}

export default function MeetingsPage() {
  const [params, setParams] = useSearchParams()
  const view = readMeetings(params)
  const options = useMeetingOptions()
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const on = options.data?.enabled === true

  const change = (changes: Partial<MeetingsView>): void => {
    setParams((current) => writeMeetings(current, changes), {
      replace: true,
      preventScrollReset: true,
    })
  }

  let body
  if (options.error) {
    body = (
      <ErrorState
        error={options.error}
        context={LOAD_FAILED}
        onRetry={() => void options.refetch()}
      />
    )
  } else if (!options.data) {
    body = <MeetingsPending />
  } else if (!options.data.enabled) {
    body = <MeetingFormsOff />
  } else {
    body = <MeetingsBody view={view} options={options.data} today={today} onChange={change} />
  }

  return (
    <>
      <PageHeader
        icon={CalendarCheck}
        tone="companies"
        title={MEETINGS_TITLE}
        description={onPhone ? undefined : MEETINGS_DESCRIPTION}
        actions={on ? <NewPreRead /> : undefined}
      />
      {body}
    </>
  )
}
