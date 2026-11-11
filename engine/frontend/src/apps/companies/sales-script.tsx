/**
 * The sales script (PLAN-V10 F1), in the order of the call: 1 Opener (what to say), 2 Why now,
 * 3 Guided questions, 4 If they say, 5 Goal of the call. Moved out of `prep-card.tsx` by PLAN-V14
 * T2-2, with no change. Its title and "Written from ..." line are in `script-header.tsx`.
 *
 * PLAN-V14 T3-4: the tone line sits above the steps, and lines are keyed by their slot, because a
 * person's edit may repeat another line's words. T3-5: the "Style" row at the top opens the style
 * sheet; after a style change it says "Not used yet" until a new script is made. T3-6: each
 * editable line has a pencil (`line-editor.tsx`), and the first save offers "Make it my style".
 */
import { CornerDownRight, Flag, Info, MessageCircle } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { GuideIconMark, GuideText, GuideWhy } from './guide-parts'
import { GuidedQuestions } from './guided-questions'
import type { CallGuide } from './playbook'
import { LineEditContext, type LineEditContextValue } from './line-edit-context'
import { EditableLine } from './line-editor'
import { draftKey, GOAL_SLOT, lineSlot } from './script-layers'
import { StyleRow, StyleSheet } from './style-sheet'
import { styleNoteFor } from './style-words'

function Step({
  n,
  title,
  aside,
  children,
}: {
  n: number
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-md bg-foreground text-caption font-semibold text-background tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 className="text-ui font-semibold text-foreground">
            <span className="sr-only">{n}. </span>
            {title}
          </h4>
          {aside}
        </div>
        {children}
      </div>
    </li>
  )
}

/** A quiet line for "nothing here". The card's side uses it too. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-ui text-muted-foreground">{children}</p>
}

/** The script: opener, why now, guided questions, if they say and the goal. */
export function SalesScript({ guide }: { guide: CallGuide }) {
  const [styleOpen, setStyleOpen] = useState(false)
  // The draft the style changed under: "Not used yet" until a new script replaces it.
  const [changedOn, setChangedOn] = useState<string | null>(null)
  const draft = useMemo(() => draftKey(guide), [guide])
  // A note for Your style, filled in from a line by "Make it my style".
  const [prefill, setPrefill] = useState<string | null>(null)
  // The first save on this card offers "Make it my style", once.
  const [offered, setOffered] = useState(false)
  const [offer, setOffer] = useState<{ slot: string; text: string } | null>(null)
  const call = guide.call ?? null
  const edit = useMemo<LineEditContextValue>(
    () => ({
      call,
      onSaved: (slot, text) => {
        if (offered) return
        setOffered(true)
        setOffer({ slot, text })
      },
      offerSlot: offer?.slot ?? null,
      onMakeStyle: () => {
        if (!offer) return
        setPrefill(styleNoteFor(offer.slot, offer.text))
        setOffer(null)
        setStyleOpen(true)
      },
      onDismissOffer: () => {
        setOffer(null)
      },
    }),
    [call, offered, offer],
  )
  return (
    <LineEditContext.Provider value={edit}>
      <div className="flex flex-col gap-4">
        <StyleRow
          madeFrom={guide.madeFrom}
          changedSince={changedOn === draft}
          onOpen={() => {
            setPrefill(null)
            setStyleOpen(true)
          }}
        />
        <StyleSheet
          open={styleOpen}
          onOpenChange={setStyleOpen}
          prefill={prefill}
          onChanged={() => {
            setChangedOn(draft)
          }}
        />
        {guide.notices?.map((notice) => (
          <p key={notice} role="status" className="flex items-start gap-2 text-ui text-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">{notice}</span>
          </p>
        ))}
        {guide.tone ? (
          <p className="flex items-start gap-2 text-ui text-muted-foreground">
            <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold text-foreground">Tone: </span>
              {guide.tone.text}
            </span>
          </p>
        ) : null}
        <ol aria-label="The call, step by step" className="flex flex-col gap-6">
          <Step n={1} title="Opener">
            <div className="flex flex-col gap-1.5 rounded-lg border bg-background p-3">
              <span className="text-caption font-semibold text-muted-foreground">Say</span>
              {guide.opener.length === 0 ? (
                <Quiet>Nothing sure enough to say first.</Quiet>
              ) : (
                guide.opener.map((item, index) => {
                  const slot = lineSlot('opener', index, item)
                  return (
                    <EditableLine
                      key={slot}
                      line={item}
                      slot={slot}
                      label={`Opener line ${String(index + 1)}`}
                    >
                      <p className="text-body">
                        <GuideText line={item} />
                      </p>
                    </EditableLine>
                  )
                })
              )}
            </div>
          </Step>
          <Step n={2} title="Why now">
            {guide.whyNow.length === 0 ? (
              <Quiet>No new reason found. This is a check-in call.</Quiet>
            ) : (
              <ul className="flex flex-col gap-3">
                {guide.whyNow.map((item, index) => {
                  const slot = lineSlot('why_now', index, item)
                  return (
                    <li key={slot} className="flex items-start gap-2.5">
                      <GuideIconMark
                        icon={item.icon}
                        className="mt-1 size-4 shrink-0 text-muted-foreground"
                      />
                      <EditableLine
                        line={item}
                        slot={slot}
                        label={`Why now, line ${String(index + 1)}`}
                        className="flex-1"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <p className="text-body">
                            <GuideText line={item} />
                          </p>
                          {item.why ? (
                            <p className="truncate text-caption text-muted-foreground">
                              {item.why}
                            </p>
                          ) : null}
                        </div>
                      </EditableLine>
                    </li>
                  )
                })}
              </ul>
            )}
          </Step>
          <Step n={3} title="Guided questions">
            <GuidedQuestions questions={guide.questions} />
          </Step>
          <Step n={4} title="If they say">
            {guide.ifTheySay.length === 0 ? (
              <Quiet>No likely pushback with a source.</Quiet>
            ) : (
              <dl className="flex flex-col gap-3">
                {guide.ifTheySay.map((item, index) => (
                  <div
                    key={lineSlot('if_they_say', index, item.answer)}
                    className="flex flex-col gap-1"
                  >
                    {/* Past the draft's end, a person's answer has no pushback left to answer. */}
                    <dt className="text-body font-semibold">
                      {item.theySay ? `"${item.theySay}"` : 'Your own answer'}
                    </dt>
                    <dd className="flex items-start gap-2 text-body">
                      <CornerDownRight
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0 text-muted-foreground"
                      />
                      <EditableLine
                        line={item.answer}
                        slot={lineSlot('if_they_say', index, item.answer)}
                        label={
                          item.theySay
                            ? `Answer to "${item.theySay}"`
                            : `Your own answer ${String(index + 1)}`
                        }
                        className="flex-1"
                      >
                        <GuideText line={item.answer} />
                      </EditableLine>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Step>
          <Step n={5} title="Goal of the call">
            {guide.goal ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-start gap-2.5 rounded-lg border bg-background p-3 text-body">
                  <Flag aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground" />
                  <EditableLine
                    line={guide.goal}
                    slot={GOAL_SLOT}
                    label="Goal of the call"
                    className="flex-1"
                  >
                    <p className="font-semibold">
                      <GuideText line={guide.goal} />
                    </p>
                  </EditableLine>
                </div>
                <GuideWhy line={guide.goal} />
              </div>
            ) : (
              <Quiet>No goal with a source.</Quiet>
            )}
          </Step>
        </ol>
        {guide.dropped > 0 ? (
          <p className="text-caption text-muted-foreground">
            {guide.dropped === 1
              ? '1 line was left out because it had no source.'
              : `${formatNumber(guide.dropped)} lines were left out because they had no source.`}
          </p>
        ) : null}
      </div>
    </LineEditContext.Provider>
  )
}

/** The script's shape while the company loads: still grey lines, after 200 ms. */
export function SalesScriptPending() {
  return (
    <Pending label="Writing the call script.">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-5 w-32" />
        {[2, 3, 4, 2, 1].map((lines, index) => (
          <div key={index} className="grid grid-cols-[1.5rem_1fr] gap-3">
            <Skeleton className="size-6" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <SkeletonLines count={lines} />
            </div>
          </div>
        ))}
      </div>
    </Pending>
  )
}
