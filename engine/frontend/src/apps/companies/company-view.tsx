/**
 * What we know about one company (PLAN-V10 B5), the same in the side panel and on its full page:
 * four boxes (the next lease end, the last talk, the deal and the owner), then About, Offices,
 * Deals, People, Call history, News and research, Connections and, for people with the Lead
 * Finder tick, the Lead Finder.
 *
 * People and Call history wait for HubSpot access to contacts and calls (PLAN-V10 C1). Call notes
 * are quotes from a source, so they are in the serif (DESIGN.md "Type").
 */
import {
  Building2,
  ExternalLink,
  Hourglass,
  Link2,
  MapPin,
  Phone,
  PhoneCall,
  Target,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type {
  CompanyCall,
  CompanyDeal,
  CompanyDetail,
  CompanyNote,
  CompanyOffice,
  CompanyPerson,
} from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { SourceLink } from '@/components/source-link'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { formatDate, formatM2, formatNumber, melbourneDate } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { websiteHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'
import { WAITING_FOR_PEOPLE } from './words'
import { DealMark, LastTalk, LeaseEnd, NotInHubSpot, StageMark } from './marks'

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t pt-5">
      <h3 id={id} className="flex items-center gap-2 text-body font-semibold text-foreground">
        {Icon ? <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Quiet({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <p className="flex items-start gap-2 text-ui text-muted-foreground">
      {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  )
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="min-w-0 text-ui">{children}</div>
    </div>
  )
}

/** The four boxes at the top: what a caller checks first. */
export function QuickBoxes({ company, today }: { company: CompanyDetail; today: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Box label="Next lease end">
        <LeaseEnd date={company.next_lease_end} today={today} />
      </Box>
      <Box label="Last talk">
        <LastTalk date={company.last_talk} today={today} />
      </Box>
      <Box label="Deal">
        <DealMark deal={company.deal} />
      </Box>
      <Box label="Owner">
        {company.owner ?? <span className="text-muted-foreground">No owner</span>}
      </Box>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui">{children}</dd>
    </div>
  )
}

function About({ company }: { company: CompanyDetail }) {
  const website = websiteHref(company.domain)
  return (
    <Section id="company-about" title="About" icon={Building2}>
      {company.description ? (
        <p className="max-w-prose text-body whitespace-pre-line">{company.description}</p>
      ) : (
        <Quiet>No description in HubSpot.</Quiet>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Website">
          {website ? (
            <SourceLink href={website} />
          ) : (
            <span className="text-muted-foreground">None on record</span>
          )}
        </Fact>
        <Fact label="Industry">{company.industry ?? 'Unknown'}</Fact>
        <Fact label="Staff">
          {company.staff === null ? 'Unknown' : formatNumber(company.staff)}
        </Fact>
        <Fact label="Staff in Australia (LinkedIn)">
          {company.linkedin_staff === null ? 'Unknown' : formatNumber(company.linkedin_staff)}
        </Fact>
        <Fact label="Lifecycle stage">{company.lifecycle_stage ?? 'Unknown'}</Fact>
        <Fact label="State">{company.state ?? 'Unknown'}</Fact>
      </dl>
    </Section>
  )
}

function OfficeRow({ office, today }: { office: CompanyOffice; today: string }) {
  const where = [office.level, office.street, office.city].filter(Boolean).join(', ')
  const size = office.office_m2 === null ? null : formatM2(Number(office.office_m2))
  const more = [
    size,
    office.quality,
    office.linkedin_staff === null ? null : `${formatNumber(office.linkedin_staff)} staff`,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold">{office.label}</span>
        {where ? <span className="text-caption text-muted-foreground">{where}</span> : null}
        {more.length > 0 ? (
          <span className="text-caption text-muted-foreground">{more.join(' · ')}</span>
        ) : null}
      </div>
      <div className="shrink-0">
        <span className="sr-only">Lease end: </span>
        <LeaseEnd date={office.lease_end} today={today} stacked={false} />
      </div>
    </li>
  )
}

function DealRow({ deal }: { deal: CompanyDeal }) {
  const facts = [
    deal.amount_aud === null
      ? null
      : formatMoney(deal.amount_aud, { currency: 'AUD', decimals: 0 }),
    deal.close_date ? `Close ${formatDate(deal.close_date)}` : null,
    deal.owner,
    deal.stage,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-semibold">{deal.name}</span>
        <StageMark state={deal.state} />
      </div>
      {facts.length > 0 ? (
        <span className="text-caption text-muted-foreground">{facts.join(' · ')}</span>
      ) : null}
      {deal.next_step ? <p className="text-ui">Next step: {deal.next_step}</p> : null}
      {deal.hubspot_url ? (
        <SourceLink href={deal.hubspot_url} label="Open the deal in HubSpot" className="w-fit" />
      ) : null}
    </li>
  )
}

function PersonRow({
  person,
  onPrep,
}: {
  person: CompanyPerson
  onPrep?: (person: CompanyPerson) => void
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{person.name}</span>
        <span className="truncate text-caption text-muted-foreground">
          {[person.title, person.phone].filter(Boolean).join(' · ') || 'No title on record'}
        </span>
      </div>
      {onPrep ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onPrep(person)
          }}
        >
          <PhoneCall aria-hidden="true" />
          Prep a call
          <span className="sr-only"> with {person.name}</span>
        </Button>
      ) : null}
    </li>
  )
}

/** A call note is a quote from a source: in the serif, with a line at its side. */
export function CallNote({ text, className }: { text: string; className?: string }) {
  return (
    <blockquote
      className={cn(
        'border-l-2 border-border pl-3 font-serif text-ui whitespace-pre-line text-foreground',
        className,
      )}
    >
      {text}
    </blockquote>
  )
}

function CallRow({ call }: { call: CompanyCall }) {
  const facts = [
    call.called_at ? formatDate(call.called_at) : 'Date not known',
    call.person,
    call.owner ? `by ${call.owner}` : null,
    call.outcome,
    call.minutes === null ? null : `${formatNumber(call.minutes)} min`,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <span className="text-caption text-muted-foreground">{facts.join(' · ')}</span>
      {call.note ? <CallNote text={call.note} /> : <Quiet>No note.</Quiet>}
    </li>
  )
}

function NoteRow({ note }: { note: CompanyNote }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <p className="text-ui">{note.text}</p>
      <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
        {note.url ? <SourceLink href={note.url} /> : null}
        {note.date ? <span>{formatDate(note.date)}</span> : null}
        <span>Saved by {note.found_by === 'lead_finder' ? 'the Lead Finder' : 'call prep'}</span>
      </span>
    </li>
  )
}

function LeadSection({ company }: { company: CompanyDetail }) {
  const lead = company.lead
  if (!lead) return null
  return (
    <Section id="company-lead" title={lead.title} icon={Target}>
      <div className="flex flex-wrap items-center gap-3">
        <ResultBadge result={lead.result} />
        <span className="text-ui tabular-nums">
          Score {formatNumber(lead.score)}
          {lead.score_checked ? ` of ${formatNumber(lead.score_checked)}` : ''}
        </span>
        <span className="text-caption text-muted-foreground">
          Researched {formatDate(lead.found_at)}
        </span>
      </div>
      {lead.summary ? <p className="max-w-prose text-ui">{lead.summary}</p> : null}
      {lead.best_sign ? (
        <p className="text-ui">
          <span className="font-semibold">Best sign: </span>
          {lead.best_sign}
          {lead.sign_date ? (
            <span className="text-muted-foreground"> ({formatDate(lead.sign_date)})</span>
          ) : null}
        </p>
      ) : null}
      <Link
        to={lead.link}
        className="inline-flex w-fit items-center gap-1 text-ui underline underline-offset-4"
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        Open the lead card
      </Link>
    </Section>
  )
}

export interface CompanyViewProps {
  company: CompanyDetail
  /** "Prep a call" for one of its people. Without it, no buttons show. */
  onPrep?: (person: CompanyPerson) => void
  today?: string
  /** False when the four boxes are already on screen above (the panel shows them first). */
  boxes?: boolean
}

export function CompanyView({
  company,
  onPrep,
  today = melbourneDate(),
  boxes = true,
}: CompanyViewProps) {
  const waiting = company.people_status === 'waiting'
  return (
    <div className="flex flex-col gap-5">
      {boxes && company.source === 'lead' ? <NotInHubSpot /> : null}
      {boxes ? <QuickBoxes company={company} today={today} /> : null}
      {company.last_talk_note ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">The last call note</span>
          <CallNote text={company.last_talk_note} />
        </div>
      ) : null}
      <About company={company} />
      <Section id="company-offices" title="Offices" icon={MapPin}>
        {company.offices.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {company.offices.map((office, index) => (
              <OfficeRow key={`${office.label}-${String(index)}`} office={office} today={today} />
            ))}
          </ul>
        ) : (
          <Quiet>No offices on record.</Quiet>
        )}
      </Section>
      <Section id="company-deals" title="Deals" icon={Link2}>
        {company.deals.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {company.deals.map((deal, index) => (
              <DealRow key={`${deal.name}-${String(index)}`} deal={deal} />
            ))}
          </ul>
        ) : (
          <Quiet>No deals on record.</Quiet>
        )}
      </Section>
      <Section id="company-people" title="People" icon={Phone}>
        {waiting ? (
          <Quiet icon={Hourglass}>{WAITING_FOR_PEOPLE}</Quiet>
        ) : company.people.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {company.people.map((person) => (
              <PersonRow key={person.id} person={person} onPrep={onPrep} />
            ))}
          </ul>
        ) : (
          <Quiet>No people on record in HubSpot.</Quiet>
        )}
      </Section>
      <Section id="company-calls" title="Call history" icon={PhoneCall}>
        {waiting ? (
          <Quiet icon={Hourglass}>{WAITING_FOR_PEOPLE}</Quiet>
        ) : company.calls.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {company.calls.map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </ul>
        ) : (
          <Quiet>No calls logged in HubSpot.</Quiet>
        )}
      </Section>
      <Section id="company-news" title="News and research">
        {company.notes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {company.notes.map((note, index) => (
              <NoteRow key={`${note.url ?? ''}-${String(index)}`} note={note} />
            ))}
          </ul>
        ) : (
          <Quiet>No notes from the last 30 days. A call prep looks for news.</Quiet>
        )}
      </Section>
      <Section id="company-connections" title="Connections">
        <Quiet icon={Hourglass}>Waiting for the customer list from Levi.</Quiet>
      </Section>
      <LeadSection company={company} />
    </div>
  )
}

/**
 * The shape of the view while it loads: the four boxes and three sections, as tall as the real
 * ones, still and grey, after 200 ms. A screen reader hears `label` once.
 */
export function CompanyViewPending({
  label = 'Loading the company.',
  boxes = true,
}: {
  label?: string
  /** False when the four boxes are already on screen. */
  boxes?: boolean
}) {
  return (
    <Pending label={label}>
      <div className="flex flex-col gap-5">
        {boxes ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        ) : null}
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 border-t pt-5">
            <Skeleton className="h-5 w-28" />
            <SkeletonLines count={3} />
          </div>
        ))}
      </div>
    </Pending>
  )
}
