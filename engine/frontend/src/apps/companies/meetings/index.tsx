/**
 * Meetings (PLAN-V17 T3-9, "The screens" part 5), at /companies/meetings: the client meetings,
 * each with where its pre-read stands, and one button to move it on.
 *
 * - **Upcoming** (grouped Today, Tomorrow, This week, Later, in Melbourne days, as the server
 *   groups them) and **Past**, picked with `Segmented`. The rep's own meetings first, with a
 *   switch for the team's. A search finds a meeting by company, title or date words. All of it is
 *   in the address (`params.ts`).
 * - **One status and one button a row** (`meeting-row.tsx`): Needs pre-read (Draft it), Drafting
 *   (Open), Draft ready (Check and send), Sent (Open), Draft failed (Open). Past rows say whether
 *   what was said is logged, with "Log meeting" (T3-11) while call notes are on: it opens the
 *   transcript box (`log-meeting.tsx`). The team's rows say whose each meeting is.
 * - **New pre-read** in the header, for a meeting that isn't in HubSpot (`new-pre-read.tsx`).
 * - **The states:** loading (a still skeleton after 200ms), empty, and an error. Two different
 *   "offs" stay apart. While the list can't show what was asked (HubSpot's meetings aren't read
 *   yet, or the rep's own can't be picked out), one quiet line says so in the server's words
 *   (`sentence`), the rows the server has still show, and New pre-read still works. With the
 *   pre-meeting forms switch off, the list answers 409 `meeting_forms_off`: the page says so, and
 *   stays in the menu (Al-khair, 15 Nov). There is no other way to read the switch.
 *
 * The quiet line and New pre-read keep what the last list said while the next one loads, so the
 * toolbar under the line never jumps up and back.
 *
 * The page has no Navy button of its own: the work is on the rows, and each row's button is
 * quiet, so a list of drafts ready never shows five Navy buttons. New pre-read's dialog has one.
 */
import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { isMeetingFormsOff, useMeetings } from '@/api/hooks/meetings'
import type { MeetingItem, MeetingPage } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { LogMeetingSheet } from './log-meeting'
import { MeetingList } from './meeting-list'
import { NewPreRead } from './new-pre-read'
import { meetingsQuery, readMeetings, writeMeetings, type MeetingsView } from './params'
import { MeetingFormsOff, MeetingsPending, WaitingLine } from './states'
import { MeetingsToolbar } from './toolbar'
import {
  EMPTY_NOT_YOURS,
  EMPTY_WAITING,
  emptyWords,
  LOAD_FAILED,
  MEETINGS_DESCRIPTION,
  MEETINGS_TITLE,
  noMatchWords,
} from './words'

/** What the last list said about HubSpot: whether it waits, and the server's sentence. */
interface HubSpotLine {
  waiting: boolean
  sentence: string | null
}

function lineOf(page: MeetingPage): HubSpotLine {
  return { waiting: page.meetings_state !== 'ready', sentence: page.sentence }
}

/** The serif words of an empty list: no match, HubSpot not read, the rep's own not known, or none. */
function emptyOf(view: MeetingsView, page: MeetingPage) {
  if (view.q.trim() !== '') return noMatchWords(view.q, view.when)
  if (page.meetings_state !== 'ready') return EMPTY_WAITING
  if (page.sentence !== null) return EMPTY_NOT_YOURS
  return emptyWords(view.when, view.team)
}

export default function MeetingsPage() {
  const [params, setParams] = useSearchParams()
  const view = readMeetings(params)
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const list = useMeetings(meetingsQuery(view))
  const off = isMeetingFormsOff(list.error)
  // "Log meeting" makes a call note, so it is there only while call notes are on.
  const notesOn = useCallNoteOptions().data?.enabled === true
  const [logging, setLogging] = useState<MeetingItem | null>(null)

  // Kept from the last list that answered, while the next one loads.
  const [formsOn, setFormsOn] = useState(false)
  const [line, setLine] = useState<HubSpotLine | null>(null)
  if (list.data && !formsOn) setFormsOn(true)
  if (off && formsOn) setFormsOn(false)
  if (list.data) {
    const next = lineOf(list.data)
    if (line?.waiting !== next.waiting || line.sentence !== next.sentence) setLine(next)
  }

  const change = (changes: Partial<MeetingsView>): void => {
    setParams((current) => writeMeetings(current, changes), {
      replace: true,
      preventScrollReset: true,
    })
  }

  let content
  if (list.error && !list.data) {
    content = (
      <ErrorState error={list.error} context={LOAD_FAILED} onRetry={() => void list.refetch()} />
    )
  } else if (!list.data) {
    content = <MeetingsPending />
  } else if (list.data.items.length === 0 && view.page === 0) {
    const words = emptyOf(view, list.data)
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
          change({ page })
        }}
        onLogMeeting={notesOn ? setLogging : undefined}
      />
    )
  }

  return (
    <>
      <PageHeader
        icon={CalendarCheck}
        tone="companies"
        title={MEETINGS_TITLE}
        description={onPhone ? undefined : MEETINGS_DESCRIPTION}
        actions={formsOn && !off ? <NewPreRead /> : undefined}
      />
      {off ? (
        <MeetingFormsOff />
      ) : (
        <>
          {line && (line.waiting || line.sentence !== null) ? (
            <WaitingLine sentence={line.sentence} />
          ) : null}
          <MeetingsToolbar view={view} onChange={change} />
          {content}
        </>
      )}
      <LogMeetingSheet
        target={logging}
        onPhone={onPhone}
        onClose={() => {
          setLogging(null)
        }}
      />
    </>
  )
}
