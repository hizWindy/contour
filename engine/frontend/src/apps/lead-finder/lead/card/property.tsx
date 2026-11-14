/**
 * The lead card's office sections for PLAN-V16 (T3-4), in the Overview:
 *
 * - `PropertySection` ("Property record", above the Summary): the current office (address,
 *   building, floor, m² confirmed or estimated, "at this address since at least 2017", the lease
 *   end and who did the last fitout, with where it came from), the tools' records newest first,
 *   each with its tool, date and page, and one line for each tool, never "none".
 * - `SizeSection`: local staff now and projected, and the space they need at 10 m² a person,
 *   each marked confirmed or estimated.
 * - `DampenersSection`: each dampener found, with its evidence, date, page and what could reverse
 *   it, then "Not found" for each check that found nothing (Levi's section 5).
 *
 * Every text came from a tool's page, the research or the backend, so it is plain text, and every
 * link goes through `SourceLink` (http and https only).
 */
import type { ReactNode } from 'react'
import type { LeadDetail } from '@/api/types'
import { SourceLink } from '@/components/source-link'
import { formatDate, formatM2, formatStaff } from '@/lib/format'
import { Section, ShowFirst } from './parts'
import {
  hasOffice,
  officeAddress,
  officeSource,
  PROPERTY_SOURCE_NAMES,
  RECORD_KIND_WORDS,
  recordDate,
  STRENGTH_WORDS,
  toolLines,
} from './v16-words'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** A value with its basis in quieter words: "1,400 m² confirmed". */
function WithBasis({ value, basis }: { value: string; basis: string | null }) {
  return (
    <span>
      {value}
      {basis ? <span className="text-muted-foreground"> {basis}</span> : null}
    </span>
  )
}

function CurrentOffice({ lead }: { lead: LeadDetail }) {
  const office = lead.office
  if (!hasOffice(office)) {
    return <p className="text-muted-foreground">The current office isn&apos;t known yet.</p>
  }
  const address = officeAddress(office)
  const source = officeSource(office)
  return (
    <div className="flex flex-col gap-2">
      <dl
        aria-label="Current office"
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5"
      >
        {address ? <Row label="Address">{address}</Row> : null}
        {office.area_m2 !== null ? (
          <Row label="Floor area">
            <WithBasis
              value={formatM2(office.area_m2, office.area_basis === 'estimated')}
              basis={office.area_basis}
            />
          </Row>
        ) : null}
        {office.since_words ? <Row label="How long">{office.since_words}</Row> : null}
        {office.lease_end ? (
          <Row label="Lease ends">
            <WithBasis value={formatDate(office.lease_end)} basis={office.lease_end_basis} />
          </Row>
        ) : null}
        {office.fitout_by ? <Row label="Last fitout by">{office.fitout_by}</Row> : null}
      </dl>
      {source ? <p className="text-caption text-muted-foreground">From {source}.</p> : null}
    </div>
  )
}

export function PropertySection({ lead }: { lead: LeadDetail }) {
  const records = lead.property?.records ?? []
  return (
    <Section title="Property record">
      <CurrentOffice lead={lead} />
      {records.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Records, newest first</p>
          <ShowFirst
            items={records}
            label="Property records"
            className="gap-2"
            keyOf={(record, index) => `${record.url} ${String(index)}`}
            render={(record) => {
              const day = recordDate(record)
              return (
                <span className="flex flex-col gap-0.5">
                  <span className="max-w-prose">{record.summary}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                    <span>{RECORD_KIND_WORDS[record.kind]}</span>
                    <span>{PROPERTY_SOURCE_NAMES[record.source]}</span>
                    <span>{day ? formatDate(day) : 'Date not known'}</span>
                    <SourceLink href={record.url} />
                  </span>
                </span>
              )
            }}
          />
        </div>
      ) : null}
      <ul aria-label="What each tool found" className="flex flex-col gap-0.5 text-muted-foreground">
        {toolLines(lead).map((tool) => (
          <li key={tool.source}>{tool.line}</li>
        ))}
      </ul>
    </Section>
  )
}

export function SizeSection({ lead }: { lead: LeadDetail }) {
  const staff = lead.headcount
  const space = lead.space
  const noStaff = staff === null || (staff.now === null && staff.projected === null)
  const noSpace = space === null || (space.now_m2 === null && space.projected_m2 === null)
  if (noStaff && noSpace) {
    return (
      <Section title="Size">
        <p className="text-muted-foreground">Local staff and space aren&apos;t known yet.</p>
      </Section>
    )
  }
  return (
    <Section title="Size">
      <dl aria-label="Size" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {staff?.now !== null && staff?.now !== undefined ? (
          <Row label="Local staff now">
            <WithBasis value={formatStaff(staff.now)} basis={staff.now_basis} />
          </Row>
        ) : null}
        {staff?.projected !== null && staff?.projected !== undefined ? (
          <Row label="In 24 months">
            <WithBasis value={formatStaff(staff.projected)} basis={staff.projected_basis} />
          </Row>
        ) : null}
        {space?.now_m2 !== null && space?.now_m2 !== undefined ? (
          <Row label="Space now">
            <WithBasis value={formatM2(space.now_m2, true)} basis="estimated" />
          </Row>
        ) : null}
        {space?.projected_m2 !== null && space?.projected_m2 !== undefined ? (
          <Row label="Space needed">
            <WithBasis value={formatM2(space.projected_m2, true)} basis="estimated" />
          </Row>
        ) : null}
      </dl>
      <p className="text-caption text-muted-foreground">
        Space at about 10 m² a person.
        {staff?.source_url ? ' Staff from ' : ''}
        {staff?.source_url ? <SourceLink href={staff.source_url} /> : null}
      </p>
    </Section>
  )
}

export function DampenersSection({ lead }: { lead: LeadDetail }) {
  const found = lead.dampeners.filter((item) => item.state === 'found')
  const notFound = lead.dampeners.filter((item) => item.state === 'not_found')
  const notChecked = lead.dampeners.filter((item) => item.state === 'not_checked')
  return (
    <Section title="Dampeners">
      {lead.dampeners.length === 0 ? (
        <p className="text-muted-foreground">Not checked for this lead yet.</p>
      ) : null}
      {found.length > 0 ? (
        <ul aria-label="Dampeners found" className="flex flex-col gap-3">
          {found.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5">
              <span className="font-semibold">{item.label}</span>
              <span className="text-caption text-muted-foreground">
                {STRENGTH_WORDS[item.strength]}
              </span>
              {item.evidence ? <span className="max-w-prose">{item.evidence}</span> : null}
              <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                <span>{item.date ? formatDate(item.date) : 'Date not known'}</span>
                {item.url ? <SourceLink href={item.url} /> : null}
              </span>
              {item.can_reverse ? (
                <span className="text-caption text-muted-foreground">
                  Could change: {item.can_reverse}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notFound.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">Not found</p>
          <ul aria-label="Dampeners not found" className="flex flex-col gap-0.5">
            {notFound.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {notChecked.length > 0 ? (
        <p className="text-muted-foreground">
          Not checked: {notChecked.map((item) => item.label).join('; ')}.
        </p>
      ) : null}
    </Section>
  )
}
