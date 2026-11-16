/**
 * The facts of the pre-read (PLAN-V17 "The screens", part 6), from HubSpot and our notes, with no
 * AI, as the form's first two sections (PLAN-V18 T2-5): quiet, read only fields in a grid of two
 * columns (one on a phone), each with its label above and where it came from under it.
 *
 * - **1 The meeting:** the date and the time, Teams or in person, who we meet, and the Contour
 *   people. The date, the time and the place come from the pre-read's own copy of the meeting, so
 *   they show at once, with the source the server gives its "When" fact.
 * - **2 The company:** the company (a link to its record), then the server's other facts: staff,
 *   offices, the lease end and the deal stage, in the server's order and words.
 *
 * The server leaves out the facts it doesn't have and never puts an email address or a phone
 * number in them. A new pre-read has none for a moment, while the server reads them: still grey
 * fields show where they will be, at their size. A draft that failed before it read them says so.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { FormFact, MeetingFormOut } from '@/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTime } from '@/lib/format'
import { whereWords } from '../words'
import {
  COMPANY,
  CONTOUR_PEOPLE,
  DATE,
  FACTS_COMING,
  fullDate,
  HUBSPOT_MEETING,
  NO_FACTS,
  NOT_KNOWN,
  TIME,
  TYPED_IN,
  WHERE_LABEL,
  WHO_WE_MEET,
} from './words'

/** The server's labels of the facts about the meeting itself. The rest are the company's. */
const MEETING_FACTS = new Set(['When', 'Where', 'Who we meet', 'Contour people'])

/** The meeting's people facts, in the form's order: the server's label, then the field's. */
const PEOPLE_FACTS: readonly (readonly [string, string])[] = [
  ['Who we meet', WHO_WE_MEET],
  ['Contour people', CONTOUR_PEOPLE],
]

/** How many facts about the company a pre-read of a HubSpot meeting has: staff to deal stage. */
const COMPANY_FACTS = 4

function factOf(form: MeetingFormOut, label: string): FormFact | undefined {
  return form.facts.find((fact) => fact.label === label)
}

/** A company's own record, like "/companies/101" or "/companies/lead%3A7". */
function companyHref(key: string): string {
  return `/companies/${encodeURIComponent(key)}`
}

function Field({
  label,
  value,
  source,
}: {
  label: string
  value: ReactNode
  source?: string | null
}) {
  return (
    <div data-slot="fact" className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-ui break-words text-foreground">{value}</dd>
      {source ? <dd className="text-caption text-muted-foreground">{source}</dd> : null}
    </div>
  )
}

/** A field still on its way: its label, its value and its source, still and grey. */
function FieldPending() {
  return (
    <div aria-hidden="true" data-slot="fact-pending" className="flex flex-col gap-1.5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-28" />
    </div>
  )
}

/** Still fields, for the page's own loading shape. */
export function FieldsPending({ count }: { count: number }) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <FieldPending key={index} />
      ))}
    </div>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
}

/** The facts are on their way while it drafts; once it is done, none means they weren't read. */
function coming(form: MeetingFormOut): boolean {
  return form.facts.length === 0 && form.status === 'drafting'
}

/** 1 The meeting: when, where, who we meet and the Contour people. */
export function MeetingFields({ form }: { form: MeetingFormOut }) {
  const { meeting } = form
  const told = factOf(form, 'When')?.source ?? (meeting.meeting_id ? HUBSPOT_MEETING : TYPED_IN)
  const whereFact = factOf(form, 'Where')
  const where = whereFact?.value ?? whereWords({ where: meeting.where, location: null })
  const time = meeting.ends_at
    ? `${formatTime(meeting.starts_at)} to ${formatTime(meeting.ends_at)}`
    : formatTime(meeting.starts_at)
  const waiting = coming(form)
  return (
    <div className="flex flex-col gap-4">
      {waiting ? <p className="text-caption text-muted-foreground">{FACTS_COMING}</p> : null}
      <Grid>
        <Field label={DATE} value={fullDate(meeting.starts_at)} source={told} />
        <Field label={TIME} value={time} source={told} />
        <Field label={WHERE_LABEL} value={where ?? NOT_KNOWN} source={whereFact?.source ?? told} />
        {PEOPLE_FACTS.map(([label, shown]) => {
          if (waiting) return <FieldPending key={shown} />
          const fact = factOf(form, label)
          return fact ? (
            <Field key={shown} label={shown} value={fact.value} source={fact.source} />
          ) : null
        })}
      </Grid>
    </div>
  )
}

/** 2 The company: the company itself, then the server's facts about it. */
export function CompanyFields({ form }: { form: MeetingFormOut }) {
  const { meeting } = form
  const facts = form.facts.filter((fact) => !MEETING_FACTS.has(fact.label))
  const waiting = coming(form)
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Field
          label={COMPANY}
          value={
            <Link
              to={companyHref(meeting.company_key)}
              className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              {meeting.company_name}
            </Link>
          }
        />
        {waiting
          ? Array.from({ length: COMPANY_FACTS }, (_, index) => <FieldPending key={index} />)
          : facts.map((fact, index) => (
              <Field
                key={`${fact.label}-${String(index)}`}
                label={fact.label}
                value={fact.value}
                source={fact.source}
              />
            ))}
      </Grid>
      {form.facts.length === 0 && !waiting ? (
        <p className="text-ui text-muted-foreground">{NO_FACTS}</p>
      ) : null}
    </div>
  )
}
