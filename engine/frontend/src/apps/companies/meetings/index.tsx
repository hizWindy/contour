/**
 * Meetings (PLAN-V17 T3-9, "The screens" part 5, and PLAN-V18 T2-3), at /companies/meetings: the
 * client meetings, each with where its pre-read stands, and one button to move it on.
 *
 * - **Upcoming** (grouped Today, Tomorrow, This week, Later, in Melbourne days, as the server
 *   groups them) and **Past**, picked with `Segmented`. **Whose meetings:** All (the default, so
 *   nobody opens an empty page), My meetings, or My team, in time order. On All and My team the
 *   rep's own rows carry a small "You" mark, and the others say whose they are. **Owner**
 *   (Improvements 1, #5): one person's meetings, the ones they own or are on, picked from the
 *   people the server names. It works with sign-in off too, where My meetings can't know who "my"
 *   is. A search finds a meeting by company, title or date words. All of it is in the address
 *   (`params.ts`).
 * - **A filter change** slides the highlight at once, and the new list fades in over 250ms, as a
 *   whole: the rows never move one by one.
 * - **Sync** (`sync.tsx`) reads HubSpot's meetings now. The line under the toolbar says when they
 *   were last read. Meetings that come with a read fade in once; the rest stay still.
 * - **One status and one button a row** (`meeting-row.tsx`): Needs pre-read (Draft it), Drafting
 *   (Open), Draft ready (Check and send), Sent (Open), Draft failed (Open). Past rows say whether
 *   what was said is logged, with "Log meeting" (T3-11) while call notes are on: it opens the
 *   transcript box (`log-meeting.tsx`).
 * - **New pre-read** in the header, for a meeting that isn't in HubSpot (`new-pre-read.tsx`).
 * - **The states:** loading (a still skeleton after 200ms), empty, and an error. While HubSpot's
 *   meetings can't be read yet, one quiet line says so in the server's words (`sentence`), the
 *   rows the server has still show, and New pre-read still works. My meetings and My team say why
 *   they are empty when they can't be filled (not linked to a HubSpot owner, in no team, or no
 *   teams in HubSpot), with "Show all meetings". With the pre-meeting forms switch off, the list
 *   answers 409 `meeting_forms_off`: the page says so, and stays in the menu (Al-khair, 15 Nov).
 *   There is no other way to read the switch.
 *
 * The quiet line, the choices and New pre-read keep what the last list said while the next one
 * loads, so the toolbar under the line never jumps up and back.
 *
 * The page has no Navy button of its own: the work is on the rows, and each row's button is
 * quiet, so a list of drafts ready never shows five Navy buttons. New pre-read's dialog has one.
 */
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Info } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useMe } from '@/api/hooks'
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { isMeetingFormsOff, useMeetings } from '@/api/hooks/meetings'
import type { MeetingItem, MeetingOwner, MeetingPage, MeetingWho, TeamState } from '@/api/types'
import { useCanWrite } from '@/auth/can'
import { FeatureGuard } from '@/auth/guard'
import type { SegmentedOption } from '@/components/motion'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { LogMeetingSheet } from './log-meeting'
import { MeetingList } from './meeting-list'
import { NewPreRead } from './new-pre-read'
import { meetingsQuery, readMeetings, writeMeetings, type MeetingsView } from './params'
import { warmOtherViews } from './prefetch'
import { rowKey } from './rows'
import { MeetingFormsOff, MeetingsPending, WaitingLine } from './states'
import { SyncLine } from './sync'
import { MeetingsToolbar } from './toolbar'
import { useMeetingsSync } from './use-sync'
import {
  EMPTY_WAITING,
  emptyWords,
  LOAD_FAILED,
  MEETINGS_DESCRIPTION,
  MEETINGS_TITLE,
  NO_TEAM,
  NO_TEAMS_IN_HUBSPOT,
  noMatchWords,
  NOT_LINKED_MINE,
  NOT_LINKED_TEAM,
  OWNER_UNKNOWN,
  ownerEmptyWords,
  SHOW_ALL,
  WHO_WORDS,
} from './words'

/** What the last list said about HubSpot: whether it waits, and the server's sentence. */
interface HubSpotLine {
  waiting: boolean
  sentence: string | null
}

function ownerKey(owner: MeetingOwner): string {
  return `${owner.id}:${owner.name}`
}

function lineOf(page: MeetingPage): HubSpotLine {
  return { waiting: page.meetings_state !== 'ready', sentence: page.sentence }
}

interface Empty {
  title: string
  description: string
}

/**
 * Why My meetings or My team can't be filled: the rep's account isn't linked to a HubSpot owner,
 * they are in no team, or HubSpot has no teams. The server's own sentence is the description when
 * it sends one. Null when the list can be filled.
 */
function whoWords(who: MeetingWho, page: MeetingPage): Empty | null {
  let words: Empty | null = null
  if (who === 'mine' && page.linked === false) words = NOT_LINKED_MINE
  if (who === 'team') {
    if (page.team_state === 'not_linked') words = NOT_LINKED_TEAM
    if (page.team_state === 'no_team') words = NO_TEAM
    if (page.team_state === 'none_in_hubspot') words = NO_TEAMS_IN_HUBSPOT
  }
  const sentence = page.sentence?.trim()
  return words && sentence ? { ...words, description: sentence } : words
}

/**
 * The serif words of an empty list: no match, HubSpot not read, a filter that can't fill, one
 * person with none, or none. "Show all meetings" clears Whose and Owner both.
 */
function emptyOf(view: MeetingsView, page: MeetingPage): Empty & { showAll: boolean } {
  if (view.q.trim() !== '') return { ...noMatchWords(view.q, view.when), showAll: false }
  if (page.meetings_state !== 'ready') return { ...EMPTY_WAITING, showAll: false }
  const why = whoWords(view.who, page)
  if (why) return { ...why, showAll: true }
  if (view.owner !== null) {
    const name = page.owners?.find((owner) => owner.id === view.owner)?.name ?? OWNER_UNKNOWN
    return { ...ownerEmptyWords(name, view.when), showAll: true }
  }
  return { ...emptyWords(view.when, view.who), showAll: false }
}

/** The choices of whose meetings, in order. "My team" only when it can mean something. */
function whosFor(withTeam: boolean): MeetingWho[] {
  return withTeam ? ['all', 'mine', 'team'] : ['all', 'mine']
}

function whoOptions(withTeam: boolean): SegmentedOption<MeetingWho>[] {
  return whosFor(withTeam).map((value) => ({ value, label: WHO_WORDS[value] }))
}

/**
 * The list of one view (Upcoming or Past, and whose): a new view fades in over 250ms, as a whole,
 * and the old one goes at once, so a list never waits on an animation to show (the company dialog
 * does the same). With reduced motion the list simply swaps (the base CSS).
 */
function ListFade({ view, children }: { view: string; children: ReactNode }) {
  return (
    <div key={view} data-slot="meetings-view" className="animate-in duration-250 fade-in-0">
      {children}
    </div>
  )
}

/** A quiet line over a list that holds rows, though its filter can't show all it would. */
function NoteLine({ words }: { words: string }) {
  return (
    <p className="flex items-start gap-2 text-ui text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {words}
    </p>
  )
}

function MeetingsContent() {
  const [params, setParams] = useSearchParams()
  const asked = readMeetings(params)
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const canWriteMeetings = useCanWrite('companies.meetings')
  const canLogNotes = useCanWrite('companies.call_logs')
  // Whose meetings needs a "me": with sign-in off there is none, so the choice is left out and
  // the list is everyone's.
  const signIn = useMe().data
  const signedIn = signIn?.state === 'signed_in'
  const view: MeetingsView = signIn?.state === 'off' ? { ...asked, who: 'all' } : asked
  const list = useMeetings(meetingsQuery(view))
  const off = isMeetingFormsOff(list.error)
  // "Log meeting" makes a call note, so it is there only while call notes are on and writable.
  const notesOn = useCallNoteOptions(canLogNotes).data?.enabled === true && canLogNotes
  const [logging, setLogging] = useState<MeetingItem | null>(null)
  const sync = useMeetingsSync(list.data, today)

  // Kept from the last list that answered, while the next one loads.
  const [formsOn, setFormsOn] = useState(false)
  const [line, setLine] = useState<HubSpotLine | null>(null)
  const [teamState, setTeamState] = useState<TeamState | null>(null)
  const [owners, setOwners] = useState<readonly MeetingOwner[]>([])
  if (list.data && !formsOn) setFormsOn(true)
  if (off && formsOn) setFormsOn(false)
  if (list.data) {
    const next = lineOf(list.data)
    if (line?.waiting !== next.waiting || line.sentence !== next.sentence) setLine(next)
    if (list.data.team_state !== teamState) setTeamState(list.data.team_state)
    // The people the Owner filter offers: kept while the next list loads, so it never blinks.
    const offered = list.data.owners ?? []
    if (offered.map(ownerKey).join('|') !== owners.map(ownerKey).join('|')) setOwners(offered)
  }

  // The rows on screen when a read of HubSpot's meetings started: rows that come with it fade in.
  const reading = list.data?.syncing === true
  const [wasReading, setWasReading] = useState(reading)
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null)
  if (reading !== wasReading) {
    setWasReading(reading)
    if (reading && list.data) setBefore(new Set(list.data.items.map(rowKey)))
  }

  const change = (changes: Partial<MeetingsView>): void => {
    // Another view: nothing in it is new from a read.
    setBefore(null)
    setParams((current) => writeMeetings(current, changes), {
      replace: true,
      preventScrollReset: true,
    })
  }

  const withTeam = teamState !== 'none_in_hubspot' || view.who === 'team'
  const who = signedIn ? whoOptions(withTeam) : null
  const why = list.data && view.who !== 'all' ? whoWords(view.who, list.data) : null

  // Once this list is in, the lists a click on the toolbar shows next are asked for quietly
  // (Improvements 1, #10): the other of Upcoming and Past, and the other choices of whose. So they
  // open at once, not as grey blocks. Not while a search is typed, and not on one more owner.
  const client = useQueryClient()
  const answered = list.data !== undefined && !list.isPlaceholderData
  const searching = view.q.trim() !== ''
  useEffect(() => {
    if (!answered || searching) return undefined
    const here: MeetingsView = { when: view.when, who: view.who, owner: view.owner, q: '', page: 0 }
    return warmOtherViews(client, here, signedIn ? whosFor(withTeam) : [])
  }, [client, answered, searching, signedIn, withTeam, view.when, view.who, view.owner])

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
        action={
          words.showAll ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                change({ who: 'all', owner: null })
              }}
            >
              {SHOW_ALL}
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    content = (
      <div className="flex flex-col gap-3">
        {why && list.data.meetings_state === 'ready' ? <NoteLine words={why.description} /> : null}
        <MeetingList
          page={list.data}
          view={view}
          today={today}
          dimmed={list.isPlaceholderData}
          fadeInAfter={before}
          onPage={(page) => {
            change({ page })
          }}
          onLogMeeting={notesOn ? setLogging : undefined}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        icon={CalendarCheck}
        tone="companies"
        title={MEETINGS_TITLE}
        description={onPhone ? undefined : MEETINGS_DESCRIPTION}
        actions={canWriteMeetings && formsOn && !off ? <NewPreRead /> : undefined}
      />
      {off ? (
        <MeetingFormsOff />
      ) : (
        <>
          {line?.waiting ? <WaitingLine sentence={line.sentence} /> : null}
          <div className="flex flex-col gap-2">
            <MeetingsToolbar
              view={view}
              onChange={change}
              who={who}
              owners={owners}
              sync={canWriteMeetings ? sync : undefined}
            />
            {canWriteMeetings ? <SyncLine line={sync.line} /> : null}
          </div>
          <ListFade view={`${view.when}-${view.who}-${view.owner ?? ''}`}>{content}</ListFade>
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

export default function MeetingsPage() {
  return (
    <FeatureGuard feature="companies.meetings" page="Meetings">
      <MeetingsContent />
    </FeatureGuard>
  )
}
