/**
 * The call prep modal (PLAN-V10 D4): the call script for one call, over the page.
 *
 * - **At once:** what we already know (the facts pack) shows straight away: the last call, the
 *   quick facts and the company. Then the script, from a saved prep (free) or a new one.
 * - **"Before you dial"** comes first, in one line: Levi's four questions. On a rushed call that
 *   is all anyone reads.
 * - **The script:** opener, why now, questions, if they say, and the goal. Every line shows its
 *   sources (F for a fact we had, W for a web page found), and lines without one never arrive.
 * - **A company with no person** asks "Who are you calling?", with "Prep a cold call" for the
 *   switchboard.
 * - **States:** ready, searched ahead, searching (a bar that fills in 3 steps and never loops),
 *   failed in plain words, and switched off (the facts still show).
 * - **Motion:** it fades in and rises 8 px (250 ms), and leaves in 150 ms. Another person in the
 *   same modal cross-fades in 150 ms, and the modal keeps its size.
 * - **Phone:** it fills the screen, and the number with a Call button stays at the bottom.
 */
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Copy,
  ExternalLink,
  Hourglass,
  Phone,
  PhoneCall,
  RefreshCw,
  UserRound,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { usePrep, usePrepFacts, useStartPrep } from '@/api/hooks'
import type { PrepFacts, PrepOut, PrepScript, PrepSource, ScriptLine } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDate, formatNumber, formatRelative, formatTime, melbourneDate } from '@/lib/format'
import { safeHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'
import { CallNote } from './company-view'
import { agoWords } from './dates'
import { DealMark, LeaseEnd } from './marks'
import type { PrepTarget } from './prep-box'
import { scriptText, STILL_WORDS } from './script-text'
import { WAITING_FOR_PEOPLE } from './words'

const COPIED_MS = 2000
const STEPS = ['Facts from HubSpot', 'Web check', 'Script'] as const

function targetKey(target: PrepTarget): string {
  return target.prepId ?? `${target.companyKey}|${target.cold ? 'cold' : (target.person?.id ?? '')}`
}

/** A button that copies text and says "Copied" for 2 seconds. */
function CopyButton({
  text,
  label,
  disabled,
}: {
  text: string
  label: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, COPIED_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
          },
          () => {
            toast.error("It couldn't be copied", { description: 'Select the text and copy it.' })
          },
        )
      }}
    >
      <Copy aria-hidden="true" />
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  )
}

function SourceChip({ id, source }: { id: string; source: PrepSource | undefined }) {
  const href = safeHref(source?.url)
  const chip = (
    <span className="inline-flex h-5 items-center rounded-sm border border-input px-1 text-caption leading-none font-semibold text-muted-foreground tabular-nums">
      {id}
    </span>
  )
  const what = source
    ? `${source.label}${source.date ? `, ${formatDate(source.date)}` : ''}`
    : 'A source'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-sm hover:opacity-80"
          >
            {chip}
            <span className="sr-only">Source: {what}</span>
          </a>
        ) : (
          <span tabIndex={0} className="rounded-sm">
            {chip}
            <span className="sr-only">Source: {what}</span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{what}</TooltipContent>
    </Tooltip>
  )
}

function Line({ line, sources }: { line: ScriptLine; sources: Map<string, PrepSource> }) {
  return (
    <span className="inline">
      {line.text}{' '}
      <span className="inline-flex flex-wrap gap-1 align-middle">
        {line.sources.map((id) => (
          <SourceChip key={id} id={id} source={sources.get(id)} />
        ))}
      </span>
    </span>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-md bg-secondary text-ui font-semibold text-foreground tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h4 className="text-ui font-semibold text-foreground">
          <span className="sr-only">{n}. </span>
          {title}
        </h4>
        <div className="text-body">{children}</div>
      </div>
    </li>
  )
}

function Lines({
  lines,
  sources,
  empty,
}: {
  lines: ScriptLine[]
  sources: Map<string, PrepSource>
  empty: string
}) {
  if (lines.length === 0) return <p className="text-ui text-muted-foreground">{empty}</p>
  if (lines.length === 1 && lines[0])
    return (
      <p>
        <Line line={lines[0]} sources={sources} />
      </p>
    )
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted-foreground">
      {lines.map((line, index) => (
        <li key={index}>
          <Line line={line} sources={sources} />
        </li>
      ))}
    </ul>
  )
}

function ScriptView({ script, sources }: { script: PrepScript; sources: Map<string, PrepSource> }) {
  return (
    <ol aria-label="The call script" className="flex flex-col gap-5">
      <Step n={1} title="Opener">
        <Lines lines={script.opener} sources={sources} empty="Nothing sure enough to say first." />
      </Step>
      <Step n={2} title="Why now">
        <Lines lines={script.why_now} sources={sources} empty="No clear reason found." />
      </Step>
      <Step n={3} title="Questions to ask">
        <Lines lines={script.questions} sources={sources} empty="No questions with a source." />
      </Step>
      <Step n={4} title="If they say">
        {script.if_they_say.length === 0 ? (
          <p className="text-ui text-muted-foreground">No likely pushback with a source.</p>
        ) : (
          <dl className="flex flex-col gap-3">
            {script.if_they_say.map((item, index) => (
              <div key={index} className="flex flex-col gap-1">
                <dt className="font-serif text-ui text-muted-foreground">"{item.they_say}"</dt>
                <dd>
                  <Line line={item.answer} sources={sources} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Step>
      <Step n={5} title="Goal of the call">
        {script.goal ? (
          <p className="font-semibold">
            <Line line={script.goal} sources={sources} />
          </p>
        ) : (
          <p className="text-ui text-muted-foreground">No goal with a source.</p>
        )}
      </Step>
      {script.dropped > 0 ? (
        <li className="text-caption text-muted-foreground">
          {script.dropped === 1
            ? '1 line was left out because it had no source.'
            : `${formatNumber(script.dropped)} lines were left out because they had no source.`}
        </li>
      ) : null}
    </ol>
  )
}

/** The script while it is written: still grey lines, as tall as the script, after 200 ms. */
function ScriptPending() {
  return (
    <Pending label="Writing the call script.">
      <ol className="flex flex-col gap-5">
        {[2, 2, 3, 2, 1].map((lines, index) => (
          <li key={index} className="grid grid-cols-[2rem_1fr] gap-3">
            <Skeleton className="size-7" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <SkeletonLines count={lines} />
            </div>
          </li>
        ))}
      </ol>
    </Pending>
  )
}

/** The bar that fills one step at a time: facts, web check, script. It never loops. */
function Searching({ stage }: { stage: number }) {
  const done = Math.max(0, Math.min(3, stage))
  const now = STEPS[Math.min(done, STEPS.length - 1)]
  return (
    <div className="flex flex-col gap-2">
      <span role="status" className="sr-only">
        Searching.
      </span>
      <Progress value={Math.max(8, (done / 3) * 100)} aria-label={`Preparing: ${now}`} />
      <ol className="grid grid-cols-3 gap-2 text-caption">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              'flex items-center gap-1 transition-colors',
              index < done ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {index < done ? (
              <CircleCheck aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleDashed aria-hidden="true" className="size-3.5" />
            )}
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

const STILL: Record<PrepScript['still_there'], { icon: LucideIcon; words: string; tone: string }> =
  {
    yes: { icon: CircleCheck, words: STILL_WORDS.yes, tone: 'text-pass' },
    no: { icon: UserX, words: STILL_WORDS.no, tone: 'text-destructive' },
    unknown: { icon: CircleHelp, words: STILL_WORDS.unknown, tone: 'text-muted-foreground' },
    not_checked: {
      icon: CircleDashed,
      words: STILL_WORDS.not_checked,
      tone: 'text-muted-foreground',
    },
  }

function DialItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </div>
  )
}

function BeforeYouDial({
  facts,
  prep,
  sources,
  personal,
}: {
  facts: PrepFacts | undefined
  prep: PrepOut | undefined
  sources: Map<string, PrepSource>
  personal: boolean
}) {
  const script = prep?.status === 'ready' ? prep.script : null
  const pending = prep === undefined || prep.status === 'searching'
  const still = script ? STILL[script.still_there] : null
  const lastTalk = facts?.last_call?.called_at ?? facts?.last_talk ?? null
  return (
    <section aria-labelledby="before-you-dial" className="rounded-lg border bg-card p-4">
      <h3 id="before-you-dial" className="text-ui font-semibold text-foreground">
        Before you dial
      </h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DialItem label="Still there?">
          {!personal ? (
            <span className="text-muted-foreground">A cold call: nobody named</span>
          ) : still && script ? (
            <span className="inline-flex items-start gap-1.5">
              <still.icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', still.tone)} />
              <span>
                <span
                  className={cn('font-semibold', script.still_there === 'no' && 'text-destructive')}
                >
                  {still.words}
                </span>
                {script.still_there_note ? (
                  <span className="block text-caption text-muted-foreground">
                    <Line line={script.still_there_note} sources={sources} />
                  </span>
                ) : script.still_there === 'not_checked' ? (
                  <span className="block text-caption text-muted-foreground">
                    {facts?.names_ok === false
                      ? "Names don't go to Claude yet."
                      : 'The company was checked this week.'}
                  </span>
                ) : null}
              </span>
            </span>
          ) : pending ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <span className="text-muted-foreground">Not checked</span>
          )}
        </DialItem>
        <DialItem label="Last talk">
          {lastTalk ? (
            <span>
              {formatDate(lastTalk)}
              <span className="block text-caption text-muted-foreground">
                {agoWords(lastTalk.slice(0, 10), melbourneDate())}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">None on record</span>
          )}
        </DialItem>
        <DialItem label="News">
          {script ? (
            script.news[0] ? (
              <Line line={script.news[0]} sources={sources} />
            ) : (
              <span className="text-muted-foreground">None found in the last 90 days</span>
            )
          ) : pending ? (
            <span className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </span>
          ) : (
            <span className="text-muted-foreground">Not checked</span>
          )}
        </DialItem>
        <DialItem label="Connections">
          <span className="text-muted-foreground">Waiting for the customer list.</span>
        </DialItem>
      </dl>
    </section>
  )
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function SideColumn({ facts }: { facts: PrepFacts }) {
  const call = facts.last_call
  const hubspot = safeHref(facts.hubspot_url)
  return (
    <aside className="flex flex-col gap-5 lg:border-l lg:pl-6">
      <SideSection title="The last call">
        {facts.people_status === 'waiting' && !call ? (
          <p className="text-ui text-muted-foreground">{WAITING_FOR_PEOPLE}</p>
        ) : call ? (
          <div className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground">
              {[
                call.called_at ? formatDate(call.called_at) : null,
                call.person,
                call.owner ? `by ${call.owner}` : null,
                call.outcome,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {call.note ? <CallNote text={call.note} /> : null}
          </div>
        ) : (
          <p className="text-ui text-muted-foreground">No call logged in HubSpot.</p>
        )}
      </SideSection>
      <SideSection title="Quick facts">
        <dl className="grid grid-cols-2 gap-3 text-ui">
          <DialItem label="Next lease end">
            <LeaseEnd date={facts.next_lease_end} />
          </DialItem>
          <DialItem label="Deal">
            <DealMark deal={facts.deal} />
          </DialItem>
          <DialItem label="Staff">
            {facts.staff === null ? 'Unknown' : formatNumber(facts.staff)}
          </DialItem>
          <DialItem label="Owner">{facts.owner ?? 'No owner'}</DialItem>
        </dl>
      </SideSection>
      <SideSection title="Company info">
        <p className="text-ui">
          {[facts.industry, facts.city].filter(Boolean).join(' · ') || 'Nothing more on record'}
        </p>
        {hubspot ? (
          <a
            href={hubspot}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex w-fit items-center gap-1 text-ui underline underline-offset-4"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            Open in HubSpot
          </a>
        ) : null}
      </SideSection>
    </aside>
  )
}

function SourcesList({ prep }: { prep: PrepOut }) {
  if (prep.sources.length === 0) return null
  return (
    <details className="group rounded-lg border bg-card p-4">
      <summary className="cursor-pointer text-ui font-semibold text-foreground">
        Sources ({formatNumber(prep.sources.length)})
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-ui">
        {prep.sources.map((source) => {
          const href = safeHref(source.url)
          return (
            <li key={source.id} className="flex items-start gap-2">
              <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-input px-1 text-caption font-semibold text-muted-foreground tabular-nums">
                {source.id}
              </span>
              <span className="min-w-0">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline underline-offset-4"
                  >
                    {source.label}
                  </a>
                ) : (
                  source.label
                )}
                {source.date ? (
                  <span className="text-muted-foreground"> · {formatDate(source.date)}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function statusWords(prep: PrepOut): string {
  if (prep.status === 'searching') return 'Searching.'
  if (prep.status === 'failed') return 'It failed.'
  if (prep.trigger === 'search_ahead') {
    return `Ready. Searched ahead at ${formatTime(prep.created_at)}.`
  }
  if (prep.reused) {
    return `Ready. Made ${formatRelative(prep.created_at)}${prep.made_by ? ` by ${prep.made_by}` : ''}. Refresh makes a new one.`
  }
  return 'Ready.'
}

/** "Who are you calling?": the company's people, and a cold call to the switchboard. */
function WhoPicker({
  facts,
  onPick,
}: {
  facts: PrepFacts | undefined
  onPick: (person: { id: string; name: string; title: string | null } | null) => void
}) {
  if (!facts) {
    return (
      <Pending label="Loading the people.">
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </Pending>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="font-serif text-section text-foreground">Who are you calling?</p>
      {facts.people_status === 'waiting' ? (
        <p className="flex items-start gap-2 text-ui text-muted-foreground">
          <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {WAITING_FOR_PEOPLE}
        </p>
      ) : facts.people.length === 0 ? (
        <p className="text-ui text-muted-foreground">No people on record in HubSpot.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {facts.people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: person.id, name: person.name, title: person.title })
                }}
                className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted touch:min-h-11"
              >
                <UserRound aria-hidden="true" className="size-5 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{person.name}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {person.title ?? 'No title on record'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => {
          onPick(null)
        }}
      >
        <Phone aria-hidden="true" />
        Prep a cold call
      </Button>
    </div>
  )
}

export interface PrepModalProps {
  target: PrepTarget | null
  onClose: () => void
  /** Another person (or a cold call) in the same modal. */
  onChangeTarget: (target: PrepTarget) => void
}

export function PrepModal({ target, onClose, onChangeTarget }: PrepModalProps) {
  // While the modal fades out, it keeps showing what it had.
  const [shown, setShown] = useState(target)
  if (target !== null && target !== shown) {
    setShown(target)
  }
  const [prepIds, setPrepIds] = useState<Record<string, string>>({})
  const [off, setOff] = useState(false)
  const started = useRef(new Set<string>())
  const start = useStartPrep()

  const key = shown ? targetKey(shown) : ''
  const picking = shown !== null && !shown.prepId && !shown.person && !shown.cold
  // A Refresh replaces what a chip opened, so the newest prep for this key wins.
  const prepId = prepIds[key] ?? shown?.prepId
  const prep = usePrep(prepId)
  const contactId = shown?.person?.id ?? prep.data?.person?.id ?? null
  const facts = usePrepFacts(shown?.companyKey || prep.data?.company_key, contactId || null)

  const ask = (refresh: boolean): void => {
    if (!shown) return
    const askKey = key
    // A chip carries only the prep: its person (or the cold call) comes from the prep itself.
    const saved = shown.prepId ? prep.data : undefined
    const cold = Boolean(shown.cold) || saved?.kind === 'cold'
    start.mutate(
      {
        company_key: shown.companyKey || (saved?.company_key ?? ''),
        contact_id: cold ? null : (shown.person?.id ?? saved?.person?.id ?? null),
        cold,
        refresh,
      },
      {
        onSuccess: (made) => {
          setOff(false)
          setPrepIds((ids) => ({ ...ids, [askKey]: made.id }))
        },
        onError: (error) => {
          if (isApiProblem(error) && error.code === 'prep_off') {
            setOff(true)
          }
        },
      },
    )
  }

  // A person or a cold call: start (or reuse) the prep once.
  useEffect(() => {
    if (!target || target.prepId || (!target.person && !target.cold)) return
    const wanted = targetKey(target)
    if (started.current.has(wanted)) return
    started.current.add(wanted)
    ask(false)
    // `ask` reads the target it is given; it starts once per target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const sources = new Map((prep.data?.sources ?? []).map((source) => [source.id, source]))
  const personName = shown?.person?.name ?? prep.data?.person?.name
  const personTitle = shown?.person?.title ?? prep.data?.person?.title
  const companyName = shown?.companyName ?? prep.data?.company_name ?? 'Company'
  const title = picking
    ? companyName
    : personName
      ? `${personName}${personTitle ? ` · ${personTitle}` : ''}`
      : `${companyName} · cold call`
  const subtitle = picking
    ? 'Pick who you are calling.'
    : [personName ? companyName : null, facts.data?.city].filter(Boolean).join(' · ') ||
      'The switchboard'
  const phone = facts.data?.phone ?? null
  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null
  const problem = start.error && !(isApiProblem(start.error) && start.error.code === 'prep_off')

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 data-open:slide-in-from-bottom-2 sm:max-w-5xl',
          'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
      >
        <DialogHeader className="gap-1 border-b p-6 pr-14 max-sm:p-4 max-sm:pr-14">
          <p className="text-caption text-muted-foreground">Call prep</p>
          <DialogTitle className="text-section">{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
          {!picking ? (
            <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
              {prep.data?.status === 'failed' ? (
                <CircleAlert aria-hidden="true" className="size-3.5 text-destructive" />
              ) : prep.data?.status === 'ready' ? (
                <CircleCheck aria-hidden="true" className="size-3.5" />
              ) : (
                <Hourglass aria-hidden="true" className="size-3.5" />
              )}
              {off
                ? 'Call scripts are switched off. These are the facts from HubSpot.'
                : prep.data
                  ? statusWords(prep.data)
                  : 'Starting.'}
            </p>
          ) : null}
        </DialogHeader>
        <div
          key={key}
          className="min-h-0 flex-1 animate-in overflow-y-auto p-6 duration-150 fade-in-0 max-sm:p-4"
        >
          {picking ? (
            <WhoPicker
              facts={facts.data}
              onPick={(person) => {
                if (!shown) return
                onChangeTarget(person ? { ...shown, person } : { ...shown, cold: true })
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <BeforeYouDial
                  facts={facts.data}
                  prep={off ? undefined : prep.data}
                  sources={sources}
                  personal={Boolean(personName)}
                />
                {off ? (
                  <p className="text-ui text-muted-foreground">
                    An Admin switches call scripts on in Admin, Settings. Until then, the facts on
                    the right are what we know.
                  </p>
                ) : problem ? (
                  <ErrorState
                    error={start.error}
                    context="The call prep couldn't start."
                    onRetry={() => {
                      ask(false)
                    }}
                  />
                ) : prep.data?.status === 'failed' ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-soft p-4 text-ui text-destructive-ink"
                  >
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{prep.data.error ?? 'It failed. Press Refresh to try again.'}</span>
                  </div>
                ) : prep.data?.status === 'ready' && prep.data.script ? (
                  <div className="flex animate-in flex-col gap-5 duration-150 fade-in-0">
                    <ScriptView script={prep.data.script} sources={sources} />
                    <SourcesList prep={prep.data} />
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <Searching stage={prep.data?.stage ?? 0} />
                    <ScriptPending />
                  </div>
                )}
              </div>
              {facts.data ? (
                <SideColumn facts={facts.data} />
              ) : facts.error ? (
                <ErrorState error={facts.error} context="What we know couldn't be loaded." />
              ) : (
                <Pending label="Loading what we know.">
                  <div className="flex flex-col gap-5 lg:border-l lg:pl-6">
                    <SkeletonLines count={4} />
                    <SkeletonLines count={3} />
                  </div>
                </Pending>
              )}
            </div>
          )}
        </div>
        {!picking ? (
          <div className="flex flex-wrap items-center gap-2 border-t bg-popover p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {phone && tel ? (
              <>
                <Button asChild className="sm:hidden">
                  <a href={tel}>
                    <PhoneCall aria-hidden="true" />
                    Call {phone}
                  </a>
                </Button>
                <span className="text-body font-semibold tabular-nums select-all max-sm:hidden">
                  {phone}
                </span>
                <CopyButton text={phone} label="Copy number" />
              </>
            ) : (
              <span className="text-ui text-muted-foreground">No number on record</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <CopyButton
                text={prep.data ? scriptText(facts.data, prep.data) : ''}
                label="Copy script"
                disabled={prep.data?.status !== 'ready'}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={start.isPending || prep.data?.status === 'searching' || off}
                onClick={() => {
                  ask(true)
                }}
              >
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
