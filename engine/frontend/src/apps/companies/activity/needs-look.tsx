/**
 * "Needs a look" (PLAN-V17 T3-6, "The screens" part 3): a save that failed or partly failed, or one
 * HubSpot may or may not have (uncertain). Each card says what happened, step by step in the
 * server's words, and what to do:
 *
 * - failed or partial: "Try again" (POST /call-notes/{note_id}/retry). What landed stays. The card says
 *   "Sending to HubSpot." until it lands, then gets its tick and leaves for Logged. While HubSpot
 *   isn't ready for writing, Try again is greyed with the reason beside it.
 * - uncertain: "Check HubSpot, then tell us:" with "It's there" and "It's not there" (POST
 *   /call-notes/{note_id}/resolve). "It's there" logs it; "It's not there" turns it into a failed save,
 *   with Try again.
 * - "Open in HubSpot" wherever the server gave a link.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  RotateCcw,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import type { ApiProblem } from '@/api/client'
import {
  bumpCounts,
  callNoteQueryOptions,
  dropNoteFromLists,
  putNoteInLists,
  refreshCallNoteLists,
  resolveCallNoteOptions,
  retryCallNoteOptions,
  SENDING_POLL_MS,
  useCallNotes,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteOut, CallNoteStep } from '@/api/v17'
import { ErrorState } from '@/components/error-state'
import { ListExit, ListExitItem, TickIn } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { changeDetail } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { isCallNotesOff } from './notes'
import { OpenInHubSpot } from './open-in-hubspot'
import { activityQuery } from './params'
import { CallNotesOff, CardsPending, TabEmpty } from './states'
import { HOLD_LOGGED_MS } from './use-batch'
import {
  callWhen,
  CHECK_HUBSPOT,
  firstOfWords,
  ITS_NOT_THERE,
  ITS_THERE,
  LOAD_FAILED,
  LOGGED,
  NO_OUTCOME,
  NOT_DONE,
  personLine,
  SEND_OFF,
  SENDING,
  STATUS_WORDS,
  stepName,
  TRY_AGAIN,
  TRY_AGAIN_HINT,
  WHAT_HAPPENED,
} from './words'

const LIST_LABEL = 'Calls that need a look'

const STEP_ICONS: Readonly<Record<CallNoteStep['status'], { icon: LucideIcon; tone: string }>> = {
  done: { icon: CircleCheck, tone: 'text-pass-ink' },
  failed: { icon: CircleX, tone: 'text-destructive-ink' },
  uncertain: { icon: CircleQuestionMark, tone: 'text-review-ink' },
  skipped: { icon: CircleMinus, tone: 'text-muted-foreground' },
  pending: { icon: CircleDashed, tone: 'text-muted-foreground' },
}

function Steps({ steps }: { steps: readonly CallNoteStep[] }) {
  if (steps.length === 0) return null
  return (
    <ul aria-label={WHAT_HAPPENED} className="flex flex-col gap-1.5">
      {steps.map((step) => {
        const { icon: Icon, tone } = STEP_ICONS[step.status]
        return (
          <li key={step.step} className="flex items-start gap-2">
            <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', tone)} />
            <span>
              <span className="font-semibold">{stepName(step.step)}:</span> {step.words}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function problemToast(error: ApiProblem): void {
  const detail = changeDetail(error)
  toast.error(NOT_DONE, detail ? { description: detail } : undefined)
}

function LookCard({
  note: listed,
  ready,
  today,
  onLeave,
}: {
  note: CallNoteOut
  ready: boolean
  today: string
  /** Logged at last: the card leaves the tab. */
  onLeave: (note: CallNoteOut) => void
}) {
  const client = useQueryClient()
  const titleId = useId()
  const reasonId = useId()
  // After Try again, the note is followed every second until it lands.
  const [watching, setWatching] = useState(false)
  const watched = useQuery({
    ...callNoteQueryOptions(listed.id),
    enabled: watching,
    refetchInterval: (query) => (query.state.data?.status === 'sending' ? SENDING_POLL_MS : false),
  })
  const note = (watching ? watched.data : undefined) ?? listed

  const show = (fresh: CallNoteOut): void => {
    client.setQueryData(queryKeys.companies.callNote(fresh.id), fresh)
    putNoteInLists(client, fresh)
    setWatching(true)
  }
  const retry = useMutation({
    ...retryCallNoteOptions(),
    onSuccess: show,
    onError: problemToast,
  })
  const resolve = useMutation({
    ...resolveCallNoteOptions(),
    onSuccess: show,
    onError: problemToast,
  })

  // Logged: the tick shows for a moment, then the card leaves for Logged.
  const leave = useEffectEvent(() => {
    onLeave(note)
  })
  const logged = note.status === 'logged'
  useEffect(() => {
    if (!logged) return undefined
    const timer = window.setTimeout(() => {
      leave()
    }, HOLD_LOGGED_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [logged])

  const uncertain = note.steps.find((step) => step.status === 'uncertain')
  const busy = retry.isPending || resolve.isPending
  const summary = note.call.summary.trim() || note.text
  const status =
    note.status === 'failed' || note.status === 'partial' || note.status === 'uncertain'
      ? note.status
      : null

  let actions
  if (logged) {
    actions = (
      <p className="flex items-center gap-2 font-semibold text-pass-ink">
        <TickIn />
        {LOGGED}
      </p>
    )
  } else if (note.status === 'sending' || retry.isPending) {
    actions = (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Send aria-hidden="true" className="size-4 shrink-0" />
        {SENDING}
      </p>
    )
  } else if (note.status === 'uncertain' && uncertain) {
    actions = (
      <>
        <span className="text-foreground">{CHECK_HUBSPOT}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          disabled={busy}
          onClick={() => {
            resolve.mutate({ id: note.id, step: uncertain.step, landed: true })
          }}
        >
          {ITS_THERE}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          disabled={busy}
          onClick={() => {
            resolve.mutate({ id: note.id, step: uncertain.step, landed: false })
          }}
        >
          {ITS_NOT_THERE}
        </Button>
        <span className="sm:ml-auto">
          <OpenInHubSpot href={note.hubspot_url} company={note.company_name} />
        </span>
      </>
    )
  } else {
    actions = (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          disabled={!ready || busy}
          aria-describedby={reasonId}
          onClick={() => {
            retry.mutate(note.id)
          }}
        >
          <RotateCcw aria-hidden="true" />
          {TRY_AGAIN}
        </Button>
        <span id={reasonId} className="text-caption text-muted-foreground">
          {ready ? TRY_AGAIN_HINT : SEND_OFF}
        </span>
        <span className="sm:ml-auto">
          <OpenInHubSpot href={note.hubspot_url} company={note.company_name} />
        </span>
      </>
    )
  }

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col overflow-hidden rounded-lg border bg-card text-ui"
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <header className="flex flex-col gap-0.5">
          <h2 id={titleId} className="text-section font-semibold text-balance text-foreground">
            {note.company_name}
          </h2>
          <p className="text-caption text-muted-foreground">
            {[
              personLine(note.person),
              callWhen(note.called_at, today),
              note.call.outcome ?? NO_OUTCOME,
            ].join(' · ')}
          </p>
        </header>
        {status ? (
          <p
            className={cn(
              'flex items-start gap-2 font-semibold',
              status === 'failed' ? 'text-destructive-ink' : 'text-review-ink',
            )}
          >
            {status === 'failed' ? (
              <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : status === 'partial' ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleQuestionMark aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            {STATUS_WORDS[status]}
          </p>
        ) : null}
        <p className="line-clamp-2 max-w-prose text-pretty break-words text-foreground">
          {summary}
        </p>
        <Steps steps={note.steps} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 sm:px-5">
        {actions}
      </div>
    </article>
  )
}

export function NeedsLook({ ready, today }: { ready: boolean; today: string }) {
  const client = useQueryClient()
  const list = useCallNotes(activityQuery('needs_look'))
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())

  if (isCallNotesOff(list.error)) return <CallNotesOff />
  if (list.error && !list.data) {
    return (
      <ErrorState error={list.error} context={LOAD_FAILED} onRetry={() => void list.refetch()} />
    )
  }
  if (!list.data) return <CardsPending cards={2} />
  const notes = list.data.items.filter((note) => !gone.has(note.id))
  if (notes.length === 0) return <TabEmpty tab="needs_look" />

  const leave = (note: CallNoteOut): void => {
    setGone((now) => new Set(now).add(note.id))
    dropNoteFromLists(client, note.id, 'needs_look')
    void bumpCounts(client, { needs_look: -1, logged_today: 1 })
    void refreshCallNoteLists(client)
  }

  return (
    <div className="flex flex-col gap-4">
      <ListExit aria-label={LIST_LABEL} className="flex flex-col gap-3">
        {notes.map((note) => (
          <ListExitItem key={note.id}>
            <LookCard note={note} ready={ready} today={today} onLeave={leave} />
          </ListExitItem>
        ))}
      </ListExit>
      {list.data.total > list.data.items.length ? (
        <p className="text-ui text-muted-foreground">
          {firstOfWords(list.data.items.length, list.data.total)}
        </p>
      ) : null}
    </div>
  )
}
