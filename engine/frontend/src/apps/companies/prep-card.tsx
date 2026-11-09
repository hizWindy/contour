/**
 * The prep card's parts (PLAN-V10 F1, from the prototype). The card is quick info, then the sales
 * script, in the order of the call:
 *
 * - **Before you dial:** 4 tiles, Levi's 4 questions. On a rushed call that is all anyone reads.
 * - **Sales script:** 1 Opener (what to say), 2 Why now, 3 Guided questions, 4 If they say,
 *   5 Goal of the call.
 * - **Beside it:** the last time we talked (the call note, in the serif: it is a quote), quick
 *   facts, and "Company info" for everything else.
 *
 * Colour only where something needs attention: Ochre for no talk in 6 months or nobody named,
 * Terracotta for a person who has left. Every status has an icon and words.
 */
import {
  Building2,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CornerDownRight,
  Flag,
  History,
  Link2,
  MessageSquare,
  Newspaper,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CompanyDetail, PrepFacts, PrepScript } from '@/api/types'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CallNote } from './company-view'
import { agoWords, talkStale } from './dates'
import { GuideIconMark, GuideText, GuideWhy } from './guide-parts'
import { GuidedQuestions } from './guided-questions'
import { DealMark, LeaseEnd } from './marks'
import { shortMoney, type CallGuide } from './playbook'
import { STILL_WORDS } from './script-text'
import { WAITING_FOR_PEOPLE } from './words'

// --- Before you dial -----------------------------------------------------------------------------

type Tone = 'quiet' | 'attention' | 'alert'

const ICON_TONES: Record<Tone, string> = {
  quiet: 'text-muted-foreground',
  attention: 'text-review',
  alert: 'text-destructive',
}

interface TileProps {
  label: string
  icon: LucideIcon
  tone?: Tone
  value: ReactNode
  sub?: ReactNode
  loading?: boolean
}

function Tile({ label, icon: Icon, tone = 'quiet', value, sub, loading }: TileProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-3 transition-colors',
        tone === 'alert' ? 'border-destructive bg-destructive-soft' : 'bg-card',
      )}
    >
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {loading ? (
          <span className="flex flex-col gap-1.5" aria-hidden="true">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : (
          <span className="flex animate-in flex-col gap-1 duration-150 fade-in-0">
            <span className="flex min-w-0 items-start gap-1.5 text-ui font-semibold">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ICON_TONES[tone])} />
              <span className="line-clamp-2 min-w-0">{value}</span>
            </span>
            {sub ? (
              <span className="line-clamp-2 text-caption text-muted-foreground">{sub}</span>
            ) : null}
          </span>
        )}
      </dd>
    </div>
  )
}

export interface BeforeYouDialProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
  /** Call prep's script, once it is ready. */
  script: PrepScript | null
  /** Call prep is checking the web now. */
  checking: boolean
  person: { id: string; name: string } | null
  today: string
}

function stillTile({ facts, script, checking, person, company }: BeforeYouDialProps): TileProps {
  if (!person) {
    return {
      label: 'Who',
      icon: Users,
      tone: 'attention',
      value: 'Nobody named',
      sub: 'Ask the switchboard for whoever looks after the office.',
    }
  }
  if (script && script.still_there !== 'not_checked') {
    const note = script.still_there_note ? (
      <GuideText line={{ ...script.still_there_note, why: null, icon: 'web' }} />
    ) : null
    if (script.still_there === 'yes') {
      return { label: 'Still there?', icon: CircleCheck, value: STILL_WORDS.yes, sub: note }
    }
    if (script.still_there === 'no') {
      return { label: 'Still there?', icon: UserX, tone: 'alert', value: STILL_WORDS.no, sub: note }
    }
    return {
      label: 'Still there?',
      icon: CircleHelp,
      value: STILL_WORDS.unknown,
      sub: 'The web check found nothing sure.',
    }
  }
  if (checking) return { label: 'Still there?', icon: CircleDashed, value: '', loading: true }
  const activity = company?.people.find((item) => item.id === person.id)?.last_activity
  return {
    label: 'Still there?',
    icon: CircleDashed,
    value: STILL_WORDS.not_checked,
    sub: activity
      ? `Last HubSpot activity ${formatDate(activity)}.`
      : facts?.names_ok === false
        ? "Names don't go to Claude yet, so there is no web check."
        : facts?.prep_enabled
          ? 'Call prep checks this on the web.'
          : 'Call prep is off, so there is no web check.',
  }
}

function talkTile({ company, facts, today }: BeforeYouDialProps): TileProps {
  const date = facts?.last_call?.called_at?.slice(0, 10) ?? company?.last_talk ?? null
  if (!date) {
    return {
      label: 'Last talk',
      icon: History,
      tone: 'attention',
      value: 'None on record',
      sub: company?.source === 'lead' ? 'Not in HubSpot yet.' : 'No call logged in HubSpot.',
    }
  }
  const stale = talkStale(date, today)
  const owner = facts?.last_call?.owner ?? company?.owner
  return {
    label: 'Last talk',
    icon: stale ? History : MessageSquare,
    tone: stale ? 'attention' : 'quiet',
    value: formatDate(date),
    sub: `${agoWords(date, today)}${owner ? ` · ${owner}` : ''}`,
  }
}

function newsTile({ company, facts, script, checking }: BeforeYouDialProps): TileProps {
  const news = script?.news[0]
  if (news) {
    return {
      label: 'News',
      icon: Newspaper,
      value: <GuideText line={{ ...news, why: null, icon: 'news' }} />,
    }
  }
  if (script) {
    return {
      label: 'News',
      icon: Newspaper,
      value: 'Nothing new',
      sub: 'None found in the last 90 days.',
    }
  }
  if (checking) return { label: 'News', icon: Newspaper, value: '', loading: true }
  const note = company?.notes[0]
  if (note) {
    return {
      label: 'News',
      icon: Newspaper,
      value: note.text,
      sub: `Saved research${note.date ? `, ${formatDate(note.date)}` : ''}.`,
    }
  }
  return {
    label: 'News',
    icon: Newspaper,
    value: 'Not checked',
    sub: facts?.prep_enabled
      ? 'Call prep looks for news.'
      : 'Call prep is off, so there is no web check.',
  }
}

/** Levi's 4 questions, in 4 tiles. */
export function BeforeYouDial(props: BeforeYouDialProps) {
  return (
    <section aria-labelledby="before-you-dial" className="flex flex-col gap-3">
      <h3 id="before-you-dial" className="text-ui font-semibold text-foreground">
        Before you dial
      </h3>
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile {...stillTile(props)} />
        <Tile {...talkTile(props)} />
        <Tile {...newsTile(props)} />
        <Tile
          label="Connections"
          icon={Link2}
          value="Not checked yet"
          sub="Waiting for the customer list."
        />
      </dl>
    </section>
  )
}

// --- The sales script ------------------------------------------------------------------------------

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

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-ui text-muted-foreground">{children}</p>
}

/** The script: opener, why now, guided questions, if they say and the goal. */
export function SalesScript({ guide }: { guide: CallGuide }) {
  return (
    <section aria-labelledby="sales-script" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="sales-script" className="text-body font-semibold text-foreground">
          Sales script
        </h3>
        <p className="text-caption text-muted-foreground">
          {guide.madeFrom === 'hubspot'
            ? 'Written from our HubSpot copy.'
            : 'Written by call prep, with a web check.'}
        </p>
      </div>
      <ol aria-label="The call, step by step" className="flex flex-col gap-6">
        <Step n={1} title="Opener">
          <div className="flex flex-col gap-1.5 rounded-lg border bg-background p-3">
            <span className="text-caption font-semibold text-muted-foreground">Say</span>
            {guide.opener.length === 0 ? (
              <Quiet>Nothing sure enough to say first.</Quiet>
            ) : (
              guide.opener.map((item) => (
                <p key={item.text} className="text-body">
                  <GuideText line={item} />
                </p>
              ))
            )}
          </div>
        </Step>
        <Step n={2} title="Why now">
          {guide.whyNow.length === 0 ? (
            <Quiet>No new reason found. This is a check-in call.</Quiet>
          ) : (
            <ul className="flex flex-col gap-3">
              {guide.whyNow.map((item) => (
                <li key={item.text} className="flex items-start gap-2.5">
                  <GuideIconMark
                    icon={item.icon}
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-body">
                      <GuideText line={item} />
                    </p>
                    {item.why ? (
                      <p className="truncate text-caption text-muted-foreground">{item.why}</p>
                    ) : null}
                  </div>
                </li>
              ))}
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
              {guide.ifTheySay.map((item) => (
                <div key={item.theySay} className="flex flex-col gap-1">
                  <dt className="text-body font-semibold">"{item.theySay}"</dt>
                  <dd className="flex items-start gap-2 text-body">
                    <CornerDownRight
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0">
                      <GuideText line={item.answer} />
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Step>
        <Step n={5} title="Goal of the call">
          {guide.goal ? (
            <div className="flex flex-col gap-1">
              <p className="flex items-start gap-2.5 rounded-lg border bg-background p-3 text-body font-semibold">
                <Flag aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground" />
                <span className="min-w-0">
                  <GuideText line={guide.goal} />
                </span>
              </p>
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
    </section>
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

// --- Beside the script ---------------------------------------------------------------------------

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-ui font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </>
  )
}

export interface CallSideProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
  today: string
  onOpenCompany: () => void
}

/** The last time we talked, quick facts, and the way to everything else. */
export function CallSide({ company, facts, today, onOpenCompany }: CallSideProps) {
  const call = facts?.last_call ?? company?.calls[0] ?? null
  const waiting = (facts?.people_status ?? company?.people_status) === 'waiting'
  const deal = company?.deals.find((item) => item.state === 'open') ?? null
  const lease = company?.offices
    .filter((office) => office.lease_end && office.lease_end >= today)
    .sort((a, b) => ((a.lease_end ?? '') < (b.lease_end ?? '') ? -1 : 1))[0]
  return (
    <aside aria-label="What we know" className="flex flex-col gap-6 lg:border-l lg:pl-6">
      <SideSection title="Last time we talked">
        {call ? (
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
            {call.note ? <CallNote text={call.note} /> : <Quiet>No note on this call.</Quiet>}
          </div>
        ) : waiting ? (
          <Quiet>{WAITING_FOR_PEOPLE}</Quiet>
        ) : (
          <Quiet>No call logged in HubSpot.</Quiet>
        )}
      </SideSection>
      <SideSection title="Quick facts">
        {company ? (
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2.5">
            <Fact label="Company">
              {[
                company.city,
                company.staff === null ? null : `${formatNumber(company.staff)} staff`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing more on record'}
            </Fact>
            <Fact label="Lease">
              {lease ? (
                <span className="flex flex-col">
                  <span className="text-caption text-muted-foreground">{lease.label}</span>
                  <LeaseEnd date={lease.lease_end} today={today} stacked={false} />
                </span>
              ) : (
                <span className="text-muted-foreground">None on record</span>
              )}
            </Fact>
            <Fact label="Deal">
              {deal ? (
                <span>
                  {deal.stage ?? deal.name}
                  {shortMoney(deal.amount_aud) ? ` · ${shortMoney(deal.amount_aud) ?? ''}` : ''}
                </span>
              ) : (
                <DealMark deal={company.deal} />
              )}
            </Fact>
            <Fact label="Owner">
              {company.owner ?? <span className="text-muted-foreground">No owner</span>}
            </Fact>
          </dl>
        ) : (
          <Pending label="Loading the quick facts.">
            <SkeletonLines count={4} />
          </Pending>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 w-fit"
          onClick={onOpenCompany}
        >
          <Building2 aria-hidden="true" />
          Company info
        </Button>
      </SideSection>
    </aside>
  )
}
