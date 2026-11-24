/**
 * Research in the background (PLAN-V27 T4-2, choice 19): each research the card started, as it
 * goes, on every page, while the Assistant takes the next command.
 *
 * - **It holds nothing:** a quiet panel in the corner, not a dialog. The page, the voice bar and
 *   the review card all work while it shows. It sits under the dialogs (z-40), so a card or the
 *   send preview covers it.
 * - **Each finding as it arrives,** one line with its source's link, from the run's events
 *   (`useRunEvents`: `finding`, then `company_done` with the tier, then `run_finished`). New lines
 *   join at the end, and the list scrolls inside its own box, so nothing jumps while it is read.
 * - **The end:** "Done: Northwind is a B lead.", with "Open the lead card" and "Add to HubSpot",
 *   which opens the same preview a lead card's send does (`SendToHubSpotDialog`), for people who may
 *   send leads. A failure, a stop or a limit says so plainly, with "Open the run".
 * - **Status:** a still dot and what it has cost so far while it runs (DESIGN.md: nothing pulses).
 * - **A screen reader** hears one polite line as a research starts and one as it ends, from the
 *   panel's one live region, never each finding.
 * - **Hide** takes one away. The run goes on, and it is on the Runs page.
 * - **On a phone** it spans the screen's width at the bottom, above the safe area.
 */
import { Check, CircleAlert, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
// From the hooks' index, which the first visit has: a direct import splits a file out of it.
import { refreshLeads, usePreviewLeadHubSpot, useSendLeadHubSpot } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import { useCanWrite } from '@/auth/can'
import { SendToHubSpotDialog } from '@/components/hubspot/send-to-hubspot-dialog'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import { useRunEvents, type FeedItem } from '@/hooks/useRunEvents'
import { isTerminalRunStatus } from '@/lib/labels'
import { formatMoney } from '@/lib/money'
import { leadPath } from './research-flow'
import { hideResearch, sayResearch, type Research } from './research-store'
import {
  ADD_TO_HUBSPOT,
  ADDED_WORDS,
  CANT_FOLLOW,
  couldNotWords,
  doneWords,
  endedWords,
  hideWords,
  NOTHING_YET,
  OPEN_LEAD_CARD,
  OPEN_THE_RUN,
  RESEARCH_NAME,
  researchingWords,
  soFarWords,
  startedWords,
} from './research-words'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The lines a research shows: its findings, and what went wrong on the way. */
const SHOWN: ReadonlySet<string> = new Set(['finding', 'company_failed', 'cap_reached', 'problem'])

/** One finding: "Found: ... (news.example.com). Now checking: ...", its source a link. */
function Line({ item }: { item: FeedItem }) {
  const data = record(item.event.data)
  if (item.type !== 'finding') {
    return (
      <li className="flex gap-2 text-pretty text-foreground">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-review" />
        <span>
          {item.type === 'company_failed'
            ? couldNotWords(text(data.name), text(data.reason))
            : item.message}
        </span>
      </li>
    )
  }
  const found = text(data.text).replace(/[.\s]+$/, '')
  const next = text(data.next_question)
  const url = text(data.source_url)
  return (
    <li data-slot="research-finding" className="text-pretty text-foreground">
      {`Found: ${found}`}
      {url ? (
        <>
          {' ('}
          <SourceLink href={url} className="text-caption" />
          {').'}
        </>
      ) : (
        '.'
      )}
      {next ? <span className="text-muted-foreground">{` Now checking: ${next}`}</span> : null}
    </li>
  )
}

/** "Add to HubSpot": the lead card's own preview, then its send, by the lead's id. */
function AddToHubSpot({ leadId, name }: { leadId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const preview = usePreviewLeadHubSpot(leadId)
  const send = useSendLeadHubSpot(leadId)
  const write = send.data ?? preview.data ?? undefined
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="touch:h-11"
        onClick={() => {
          setOpen(true)
          if (!send.data) preview.mutate(undefined)
        }}
      >
        {ADD_TO_HUBSPOT}
      </Button>
      <SendToHubSpotDialog
        open={open}
        onOpenChange={setOpen}
        company={name}
        write={write}
        loading={preview.isPending}
        error={preview.error}
        sending={send.isPending}
        onConfirm={() => {
          if (!write) return
          send.mutate(write.id, {
            onSuccess: (result) => {
              const words =
                result.status in ADDED_WORDS
                  ? ADDED_WORDS[result.status as keyof typeof ADDED_WORDS]
                  : null
              if (words) toast(words)
            },
            onError: (error) => {
              toast(error.title, error.detail ? { description: error.detail } : undefined)
            },
          })
        }}
      />
    </>
  )
}

function ResearchItem({ research }: { research: Research }) {
  const { state, status, error } = useRunEvents(research.runId)
  const canSend = useCanWrite('lead_finder.send_to_hubspot')
  const titleId = useId()
  const name = research.name
  const done = state.feed.findLast((item) => item.type === 'company_done')
  const doneData = done ? record(done.event.data) : null
  const leadId = doneData ? text(doneData.lead_id) : ''
  const tier = doneData ? text(doneData.tier) || null : null
  const ended = state.finished || (status !== null && isTerminalRunStatus(status))
  const lines = state.feed.filter((item) => SHOWN.has(item.type))
  const lost = error !== null && error.status >= 400 && error.status < 500

  // The one line a screen reader hears at the end (and, below, at the start).
  const end = leadId
    ? doneWords(name, tier, doneData ? text(doneData.result) || null : null)
    : ended
      ? endedWords(name, status, state.stopReason)
      : lost
        ? CANT_FOLLOW
        : null
  useEffect(() => {
    sayResearch(startedWords(name))
  }, [name])
  useEffect(() => {
    if (end) sayResearch(end)
  }, [end])
  // Once it ends, its lead shows in Results, on Home and in the runs list, as after a run's page.
  // Any end counts, also one the stream can't follow to its last event (the flow trace).
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!end) return
    refreshLeads(queryClient)
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.lists() })
  }, [end, queryClient])

  return (
    <section
      aria-labelledby={titleId}
      data-slot="research"
      data-run={research.runId}
      className="flex flex-col gap-3 rounded-lg border bg-popover p-4 text-ui text-popover-foreground shadow-float"
    >
      <div className="flex items-start gap-3">
        {end ? (
          leadId ? (
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-pass" />
          ) : (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-review" />
          )
        ) : (
          // Live: a still dot in the progress colour. Nothing pulses (DESIGN.md "Motion").
          <span aria-hidden="true" className="mx-1 mt-1.5 size-2 shrink-0 rounded-xs bg-progress" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={titleId} className="font-semibold text-balance">
            {end ?? researchingWords(name)}
          </h2>
          {!end ? (
            <p className="text-caption text-muted-foreground">
              {soFarWords(formatMoney(state.costUsd))}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-2 touch:size-11"
          aria-label={hideWords(name)}
          onClick={() => {
            hideResearch(research.id)
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {lines.length > 0 ? (
        <ul
          data-slot="research-lines"
          className="flex max-h-48 flex-col gap-1.5 overflow-y-auto overscroll-contain"
        >
          {lines.map((item) => (
            <Line key={item.seq} item={item} />
          ))}
        </ul>
      ) : !end ? (
        <p className="text-muted-foreground">{NOTHING_YET}</p>
      ) : null}
      {leadId ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="touch:h-11">
            <Link to={leadPath(leadId)}>{OPEN_LEAD_CARD}</Link>
          </Button>
          {canSend && tier?.toLowerCase() !== 'discard' ? (
            <AddToHubSpot leadId={leadId} name={name} />
          ) : null}
        </div>
      ) : end ? (
        <div>
          <Button asChild variant="outline" size="sm" className="touch:h-11">
            <Link to={`/runs/${encodeURIComponent(research.runId)}`}>{OPEN_THE_RUN}</Link>
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The panel: every research started in this page, oldest first. Its code loads only once a research
 * starts (`host.tsx`), so the voice bar's own file stays small; the one live region is the host's.
 */
export default function ResearchTray({ researches }: { researches: readonly Research[] }) {
  return (
    <div
      role="region"
      aria-label={RESEARCH_NAME}
      data-slot="research-tray"
      className="fixed right-4 bottom-[calc(var(--bottom-bar,0px)+max(1rem,env(safe-area-inset-bottom)))] z-40 flex max-h-[calc(100dvh-6rem-var(--bottom-bar,0px))] w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto max-sm:right-2 max-sm:left-2 max-sm:w-auto"
    >
      {researches.map((research) => (
        <ResearchItem key={research.id} research={research} />
      ))}
    </div>
  )
}
