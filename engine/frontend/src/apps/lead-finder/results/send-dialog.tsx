/**
 * One preview for a batch of leads going to HubSpot (PLAN-V27 T3-2, choices 13 and 14).
 *
 * - **The preview** (`preview-many`): each lead with "New company" or "Fills 2 empty fields in
 *   Northwind", and once for the batch the owner (the sender's HubSpot user, or "No owner") and
 *   the list. A lead that couldn't be previewed says why on its row, and a lead sent before is
 *   marked. Both are left out of the send.
 * - **Send waits 5 seconds** with Undo, the same clock as the Assistant's send (`lib/hold.ts`):
 *   "Sending in 5 s." and Undo, which takes the focus. Undo, or Esc, sends nothing and comes back
 *   to the preview. Closing the dialog or the page in those 5 seconds sends nothing either.
 * - **Then each lead goes** (`send-many`) with the write its preview gave, and each row shows its
 *   own result. The batch is said in one line, in the dialog's one live region, so a screen reader
 *   hears it once: "2 added. 1 failed: HubSpot refused the website." No toast repeats it.
 * - While the leads are being sent the dialog stays open: Esc does nothing until they are done.
 */
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ApiProblem } from '@/api/client'
import type {
  HubSpotBatchPair,
  HubSpotBatchPreview,
  HubSpotBatchPreviewItem,
  HubSpotBatchSent,
  HubSpotBatchSentItem,
} from '@/api/types'
import { useOpensHubSpot } from '@/auth/hubspot-user'
import { Countdown } from '@/components/countdown'
import { ErrorState } from '@/components/error-state'
import { Pending } from '@/components/skeletons'
import { SourceLink } from '@/components/source-link'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { runHold, HOLD_MS, type HoldTimer } from '@/lib/hold'
import {
  confirmWords,
  NO_OWNER,
  planWords,
  previewTitle,
  sendingIn,
  summaryWords,
  UNDO,
} from './send-words'

type Phase = 'preview' | 'hold' | 'sending' | 'done'

export interface SendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** How many leads were ticked, for the title while the preview loads. */
  count: number
  preview: {
    data: HubSpotBatchPreview | undefined
    error: ApiProblem | null
    pending: boolean
  }
  sent: {
    data: HubSpotBatchSent | undefined
    error: ApiProblem | null
    pending: boolean
  }
  /** Works the preview out again (after a failed preview, or a refused send). */
  onPreviewAgain: () => void
  /** Runs once the hold is over: the previewed writes go. */
  onSend: (pairs: HubSpotBatchPair[]) => void
  /** The hold's length. Tests keep the 5 seconds. */
  holdMs?: number
}

/** The leads that go: previewed, not sent before, and with no problem. */
function sendable(preview: HubSpotBatchPreview | undefined): HubSpotBatchPair[] {
  return (preview?.items ?? []).flatMap((item) =>
    item.write && !item.already_sent && !item.problem
      ? [{ lead_id: item.lead_id, write_id: item.write.id }]
      : [],
  )
}

/** The list the batch goes to: the same for every lead, so it is said once. */
function listWords(preview: HubSpotBatchPreview): string | null {
  const plan = preview.items.find((item) => item.write?.plan.list_name)?.write?.plan
  if (!plan?.list_name) return null
  return plan.list_id ? plan.list_name : `${plan.list_name} (not ready, so it is skipped)`
}

function Line({
  icon: Icon,
  children,
  quiet = false,
}: {
  icon?: LucideIcon
  children: ReactNode
  quiet?: boolean
}) {
  return (
    <span
      className={quiet ? 'flex items-start gap-2 text-muted-foreground' : 'flex items-start gap-2'}
    >
      {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

function Result({ result }: { result: HubSpotBatchSentItem }) {
  const opens = useOpensHubSpot()
  if (result.result === 'sent') {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Line icon={CircleCheck}>Added.</Line>
        {result.write?.hubspot_url && opens ? (
          <SourceLink href={result.write.hubspot_url} label="Open in HubSpot" />
        ) : null}
      </span>
    )
  }
  if (result.result === 'already_sent') {
    return <Line icon={CircleMinus}>Already in HubSpot. Nothing was sent twice.</Line>
  }
  return <Line icon={CircleX}>Failed: {result.problem ?? "HubSpot didn't take it."}</Line>
}

function Row({
  item,
  result,
}: {
  item: HubSpotBatchPreviewItem
  result: HubSpotBatchSentItem | undefined
}) {
  const warnings = item.write?.plan.warnings ?? []
  return (
    <li data-lead-id={item.lead_id} className="flex flex-col gap-1 px-3 py-2">
      <span className="font-semibold break-words">{item.company ?? 'A removed lead'}</span>
      {result ? (
        <Result result={result} />
      ) : item.problem ? (
        <Line icon={TriangleAlert}>Left out: {item.problem}</Line>
      ) : item.already_sent ? (
        <Line icon={CircleMinus}>Already in HubSpot. Left out.</Line>
      ) : item.write ? (
        <>
          <Line quiet>{planWords(item.write)}</Line>
          {warnings.map((warning) => (
            <Line key={warning} icon={TriangleAlert}>
              {warning}
            </Line>
          ))}
        </>
      ) : null}
    </li>
  )
}

function Loading({ count }: { count: number }) {
  return (
    <Pending label="Reading HubSpot.">
      <div className="flex flex-col divide-y rounded-md border">
        {Array.from({ length: Math.min(count, 6) }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 px-3 py-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ))}
      </div>
    </Pending>
  )
}

export function SendDialog({
  open,
  onOpenChange,
  count,
  preview,
  sent,
  onPreviewAgain,
  onSend,
  holdMs = HOLD_MS,
}: SendDialogProps) {
  const [holding, setHolding] = useState(false)
  // The hold ended and the send was asked for: "sending" until its answer, with no gap between.
  const [fired, setFired] = useState(false)
  const hold = useRef<HoldTimer | null>(null)
  const sendRef = useRef<HTMLButtonElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const lastPhase = useRef<Phase>('preview')
  const data = preview.data
  const pairs = sendable(data)
  const phase: Phase = sent.data
    ? 'done'
    : sent.pending || (fired && !sent.error)
      ? 'sending'
      : holding
        ? 'hold'
        : 'preview'
  const canSend =
    phase === 'preview' && !preview.pending && Boolean(data?.can_write) && pairs.length > 0
  const results = new Map((sent.data?.items ?? []).map((item) => [item.lead_id, item]))
  const summary = sent.data ? summaryWords(sent.data) : ''
  const waiting = data && !data.can_write ? (data.waiting_for ?? 'HubSpot writing is off') : null

  // The focus follows the step: Undo while the hold runs, Send again after Undo, Close at the end.
  useEffect(() => {
    const before = lastPhase.current
    lastPhase.current = phase
    if (phase === before) return
    if (phase === 'hold') undoRef.current?.focus()
    else if (phase === 'done') closeRef.current?.focus()
    else if (phase === 'preview' && before !== 'preview') sendRef.current?.focus()
  }, [phase])

  // Closing the dialog, or the page, in the 5 seconds sends nothing.
  useEffect(
    () => () => {
      hold.current?.stop()
    },
    [],
  )

  const previewAgain = (): void => {
    setFired(false)
    onPreviewAgain()
  }

  const startHold = (): void => {
    const going = pairs
    setFired(false)
    setHolding(true)
    hold.current = runHold({
      ms: holdMs,
      send: () => {
        hold.current = null
        setFired(true)
        setHolding(false)
        onSend(going)
      },
      onUndo: () => {
        hold.current = null
        setHolding(false)
      },
    })
  }

  const title =
    phase === 'done'
      ? sent.data && sent.data.sent > 0
        ? 'Added to HubSpot'
        : 'Nothing added to HubSpot'
      : previewTitle(data ? data.items.length : count)
  const description = preview.pending
    ? 'Reading HubSpot. Nothing is written yet.'
    : phase === 'done'
      ? 'Each lead shows what happened.'
      : 'Check each lead. Nothing is written until you send.'

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Nothing closes the dialog while the leads are being sent. Closing it in the hold
        // sends nothing.
        if (!next && phase === 'sending') return
        if (!next) {
          hold.current?.stop()
          hold.current = null
          setHolding(false)
          setFired(false)
        }
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (phase === 'hold') {
            event.preventDefault()
            hold.current?.undo()
          } else if (phase === 'sending') {
            event.preventDefault()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {preview.error ? (
          <ErrorState
            error={preview.error}
            context="The preview couldn't be worked out. Nothing was sent."
            onRetry={previewAgain}
          />
        ) : null}
        {preview.pending ? <Loading count={count} /> : null}
        {data && !preview.pending ? (
          <div className="flex max-h-[55vh] min-h-0 flex-col gap-4 overflow-auto">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui">
              <dt className="text-muted-foreground">Owner</dt>
              <dd>{data.owner.hubspot_owner_id ? data.owner.name : NO_OWNER}</dd>
              {listWords(data) ? (
                <>
                  <dt className="text-muted-foreground">List</dt>
                  <dd>{listWords(data)}</dd>
                </>
              ) : null}
            </dl>
            <ul aria-label="The leads" className="flex flex-col divide-y rounded-md border text-ui">
              {data.items.map((item) => (
                <Row key={item.lead_id} item={item} result={results.get(item.lead_id)} />
              ))}
            </ul>
            {waiting && phase !== 'done' ? (
              <p id="send-many-waiting" className="rounded-md border px-3 py-2 text-ui">
                <span className="font-semibold">{waiting}.</span> Sending waits for HubSpot write
                access. The preview works until then.
              </p>
            ) : null}
            {!waiting && pairs.length === 0 && phase === 'preview' ? (
              <p id="send-many-none" className="text-ui text-muted-foreground">
                Nothing to add: each lead above says why.
              </p>
            ) : null}
          </div>
        ) : null}
        {sent.error ? (
          <ErrorState
            error={sent.error}
            context="Nothing was sent."
            onRetry={previewAgain}
            retryLabel="Preview again"
          />
        ) : null}
        {/* The one live region: the batch's result, said once. */}
        <p
          role="status"
          aria-live="polite"
          data-slot="send-many-summary"
          className={summary ? 'text-ui font-semibold' : 'sr-only'}
        >
          {summary}
        </p>
        <AlertDialogFooter>
          {phase === 'hold' ? (
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <div id="send-many-hold" className="min-w-0 flex-1 text-ui">
                <Countdown ms={holdMs} words={sendingIn} slot="send-many-hold" />
              </div>
              <Button
                ref={undoRef}
                type="button"
                variant="outline"
                aria-describedby="send-many-hold"
                onClick={() => {
                  hold.current?.undo()
                }}
              >
                {UNDO}
              </Button>
            </div>
          ) : phase === 'done' ? (
            <AlertDialogCancel ref={closeRef}>Close</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={phase === 'sending'}>Cancel</AlertDialogCancel>
              <Button
                ref={sendRef}
                type="button"
                disabled={!canSend}
                aria-describedby={
                  waiting
                    ? 'send-many-waiting'
                    : pairs.length === 0 && data
                      ? 'send-many-none'
                      : undefined
                }
                onClick={startHold}
              >
                <Send aria-hidden="true" />
                {phase === 'sending' ? 'Sending.' : confirmWords(data ? pairs.length : count)}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
