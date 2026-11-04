/**
 * The Facts tab: each fact with how sure it is, where it came from and what the other sources
 * said; the flags where sources disagree; the numbers HubSpot and Signal Hire filled in; the
 * fitout's worth; and Signal Hire's own record of the company.
 */
import { Flag } from 'lucide-react'
import type { ReactNode } from 'react'
import type { LeadDetail, Schemas } from '@/api/types'
import { Money } from '@/components/money'
import { SourceLink } from '@/components/source-link'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatM2, formatNumber, formatStaff } from '@/lib/format'
import { Section } from './parts'
import {
  LABEL_WORDS,
  SOURCE_WORDS,
  sourceOf,
  websiteHref,
  yesNo,
  type Fact,
  type FactSource,
} from './words'

type SignalHireCompany = Schemas['SignalHireCompany']

/**
 * One fact: its value, how sure it is, and where it came from. `entry` is what the backend says
 * about the source when it isn't plainly Claude's web research: the source that was used, what
 * the other sources said, and nothing more (the flag is shown above the table).
 */
function FactRow({
  label,
  value,
  fact,
  entry,
}: {
  label: string
  value: ReactNode
  fact: Fact
  entry?: FactSource
}) {
  const known = fact.value !== null
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-2 pr-4 text-left font-semibold sm:whitespace-nowrap">
        {label}
      </th>
      <td className="py-2 pr-4">
        <div className="flex flex-col gap-0.5">
          <span>{value}</span>
          {entry?.others.map((other) => (
            <span
              key={`${other.source}-${other.value}`}
              className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground"
            >
              <span>{`${SOURCE_WORDS[other.source]} says ${other.value}`}</span>
              {other.url ? <SourceLink href={other.url} /> : null}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 pr-4">
        {known && fact.label ? (
          <Badge variant="outline">{LABEL_WORDS[fact.label] ?? fact.label}</Badge>
        ) : null}
      </td>
      <td className="py-2">
        {known ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-muted-foreground">{SOURCE_WORDS[entry?.used ?? 'claude']}</span>
            {fact.source_url ? <SourceLink href={fact.source_url} /> : null}
          </span>
        ) : null}
      </td>
    </tr>
  )
}

/** The numbers another source filled in where the web research found none: one plain note each. */
function FromSource({ title, notes }: { title: string; notes: string[] }) {
  if (notes.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="list-disc pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The places where two sources disagree: a flag for a person to check, never a decision. The
 * values themselves are in the table, next to the one the rules used.
 */
function SourceFlags({ lead }: { lead: LeadDetail }) {
  const flags = lead.fact_sources.flatMap((entry) => (entry.conflict ? [entry.conflict] : []))
  if (flags.length === 0) {
    return null
  }
  return (
    <ul aria-label="Sources that disagree" className="flex flex-col gap-2">
      {flags.map((flag) => (
        <li
          key={flag}
          className="flex items-start gap-2 rounded-md border border-review bg-review-soft px-3 py-2 text-review-ink"
        >
          <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Check.</span> {flag}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Facts({ lead }: { lead: LeadDetail }) {
  const facts = lead.facts
  const nameEntry = sourceOf(lead, 'name')
  const staff = typeof facts.staff_in_city.value === 'number' ? facts.staff_in_city.value : null
  const m2 = typeof facts.office_m2.value === 'number' ? facts.office_m2.value : null
  const needed = typeof facts.size_needed_m2.value === 'number' ? facts.size_needed_m2.value : null
  const text = (fact: Fact): string =>
    typeof fact.value === 'string' && fact.value !== '' ? fact.value : 'Not known'
  return (
    <Section title="Facts">
      <SourceFlags lead={lead} />
      {/* On a narrow screen the table scrolls inside the card instead of widening the page.
          `relative` keeps the links' hidden screen-reader words inside this box too. */}
      <div className="relative -mx-1 overflow-x-auto px-1">
        <table className="w-full text-ui">
          <caption className="sr-only">Facts about {lead.company}, with their sources</caption>
          <tbody>
            {nameEntry ? (
              <FactRow
                label="Company name"
                value={facts.name}
                fact={{ value: facts.name, label: null, source_url: null, source_date: null }}
                entry={nameEntry}
              />
            ) : null}
            <FactRow
              label="Website"
              value={
                websiteHref(facts.website.value) ? (
                  <SourceLink
                    href={websiteHref(facts.website.value)}
                    label={String(facts.website.value)}
                  />
                ) : (
                  'Not known'
                )
              }
              fact={facts.website}
              entry={sourceOf(lead, 'website')}
            />
            <FactRow
              label="City"
              value={text(facts.city)}
              fact={facts.city}
              entry={sourceOf(lead, 'city')}
            />
            <FactRow
              label="Industry"
              value={text(facts.industry)}
              fact={facts.industry}
              entry={sourceOf(lead, 'industry')}
            />
            <FactRow label="Owner" value={text(facts.owner)} fact={facts.owner} />
            <FactRow
              label="Staff in the city"
              value={
                staff === null
                  ? 'Not known'
                  : `${formatStaff(staff)}${facts.staff_from_linkedin ? ' on LinkedIn' : ''}`
              }
              fact={facts.staff_in_city}
              entry={sourceOf(lead, 'staff_in_city')}
            />
            <FactRow
              label="Office size"
              value={m2 === null ? 'Not known' : formatM2(m2, lead.office_m2_estimated)}
              fact={facts.office_m2}
            />
            <FactRow
              label="Local team runs the project"
              value={yesNo(facts.local_team_runs_project.value)}
              fact={facts.local_team_runs_project}
            />
            <FactRow
              label="Healthy business"
              value={yesNo(facts.healthy.value)}
              fact={facts.healthy}
            />
            <FactRow
              label="The office matters"
              value={yesNo(facts.office_matters.value)}
              fact={facts.office_matters}
            />
            <FactRow
              label="Expected move"
              value={text(facts.expected_move)}
              fact={facts.expected_move}
            />
            <FactRow
              label="At this address since"
              value={text(facts.office_since)}
              fact={facts.office_since}
              entry={sourceOf(lead, 'office_since')}
            />
            <FactRow
              label="Last move or fitout"
              value={text(facts.last_fitout)}
              fact={facts.last_fitout}
            />
            {facts.growth_plan.value === true ? (
              <FactRow
                label="Growing"
                value={
                  needed === null
                    ? 'Yes'
                    : `Will need about ${formatM2(needed)}${facts.growth_by.value ? ` by ${String(facts.growth_by.value)}` : ''}`
                }
                fact={facts.growth_plan}
              />
            ) : null}
          </tbody>
        </table>
      </div>
      <FromSource title="From HubSpot" notes={lead.from_hubspot} />
      <FromSource title="From Signal Hire" notes={lead.from_signalhire} />
      {lead.fitout_aud ? (
        <p className="text-muted-foreground">
          Fitout worth about <Money value={lead.fitout_aud} currency="AUD" decimals={0} />, at the
          minimum rate per m².
        </p>
      ) : null}
    </Section>
  )
}

/** A place as Signal Hire writes it, like `Melbourne, Victoria, Australia`. */
function placeOf(office: SignalHireCompany['offices'][number]): string {
  return [office.city, office.area, office.country].filter(Boolean).join(', ') || 'Place not given'
}

/**
 * What Signal Hire says about the company: its checked name, website, industry, LinkedIn page, the
 * staff in all, and the offices with the head office marked. Every text came from Signal Hire, so
 * all of it is plain text, and the two links go through `SourceLink`.
 */
function SignalHireRecord({ company }: { company: SignalHireCompany }) {
  return (
    <Section title="Signal Hire's record">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-semibold">Name</dt>
        <dd>{company.name}</dd>
        {company.website ? (
          <>
            <dt className="font-semibold">Website</dt>
            <dd>
              <SourceLink href={websiteHref(company.website)} label={company.website} />
            </dd>
          </>
        ) : null}
        {company.industry ? (
          <>
            <dt className="font-semibold">Industry</dt>
            <dd>{company.industry}</dd>
          </>
        ) : null}
        {company.linkedin_url ? (
          <>
            <dt className="font-semibold">LinkedIn</dt>
            <dd>
              <SourceLink href={company.linkedin_url} label="Company page" />
            </dd>
          </>
        ) : null}
        {company.staff_count !== null ? (
          <>
            <dt className="font-semibold">Staff in all</dt>
            <dd>
              About {formatNumber(company.staff_count)}, an estimate for every office, not the one
              in this city
            </dd>
          </>
        ) : null}
      </dl>
      {company.staffing_company ? (
        <p className="text-muted-foreground">Signal Hire marks it as a staffing company.</p>
      ) : null}
      {company.offices.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Offices</p>
          <ul className="list-disc pl-5" aria-label="Offices on Signal Hire">
            {company.offices.map((office, index) => (
              <li key={`${placeOf(office)}-${index}`}>
                {placeOf(office)}
                {office.head_office ? ' (head office)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        Read from Signal Hire on {formatDate(company.fetched_at)}. A saved copy is used for a month,
        so each company is paid for once a month.
      </p>
    </Section>
  )
}

export function FactsTab({ lead }: { lead: LeadDetail }) {
  return (
    <>
      <Facts lead={lead} />
      {lead.signalhire_company ? <SignalHireRecord company={lead.signalhire_company} /> : null}
    </>
  )
}
