/**
 * The one-page profile of a lead (PLAN-V16 T3-7): everything in Levi's section 9, laid out to print
 * on one A4 page. "Print the profile" on a Tier A lead's card opens it.
 *
 * It sits outside the app frame (no menu, no top bar), like the sign-in page, and still needs a
 * person who may see leads (`RequireSignIn`, in router.tsx). On screen it has "Back to the lead"
 * and "Print"; on paper it has only the profile.
 *
 * Every text came from a web page, a tool or Claude, so all of it is plain text, and every link
 * goes through `SourceLink`.
 */
import { ArrowLeft, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useLead } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { PendingDetail } from '@/components/skeletons'
import { SourceLink } from '@/components/source-link'
import { TierLine } from '@/components/tier-mark'
import { Button } from '@/components/ui/button'
import { formatDate, formatM2, formatStaff } from '@/lib/format'
import { TIER_ACTIONS } from '@/lib/labels'
import { hasOffice, officeAddress, officeSource, STRENGTH_WORDS } from './card/v16-words'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex break-inside-avoid flex-col gap-1">
      <h2 className="text-ui font-semibold">{title}</h2>
      <div className="flex flex-col gap-1 text-caption">{children}</div>
    </section>
  )
}

function Basis({ value }: { value: string | null }) {
  return value ? <span className="text-muted-foreground"> ({value})</span> : null
}

function Headcount({ lead }: { lead: LeadDetail }) {
  const staff = lead.headcount
  if (!staff || (staff.now === null && staff.projected === null)) {
    return <p className="text-muted-foreground">Not known yet.</p>
  }
  return (
    <>
      {staff.now !== null ? (
        <p>
          Now: {formatStaff(staff.now)}
          <Basis value={staff.now_basis} />
        </p>
      ) : null}
      {staff.projected !== null ? (
        <p>
          In 24 months: {formatStaff(staff.projected)}
          <Basis value={staff.projected_basis} />
        </p>
      ) : null}
      {staff.source_url ? (
        <p>
          Source: <SourceLink href={staff.source_url} />
        </p>
      ) : null}
    </>
  )
}

function Space({ lead }: { lead: LeadDetail }) {
  const space = lead.space
  if (!space || (space.now_m2 === null && space.projected_m2 === null)) {
    return <p className="text-muted-foreground">Not known yet.</p>
  }
  return (
    <>
      {space.now_m2 !== null ? <p>Now: {formatM2(space.now_m2, true)}</p> : null}
      {space.projected_m2 !== null ? <p>Projected: {formatM2(space.projected_m2, true)}</p> : null}
      <p className="text-muted-foreground">At about 10 m² a person (estimated).</p>
    </>
  )
}

function Office({ lead }: { lead: LeadDetail }) {
  const office = lead.office
  if (!hasOffice(office)) {
    return <p className="text-muted-foreground">Not known yet.</p>
  }
  const source = officeSource(office)
  return (
    <>
      {officeAddress(office) ? <p>{officeAddress(office)}</p> : null}
      {office.area_m2 !== null ? (
        <p>
          {formatM2(office.area_m2, office.area_basis === 'estimated')}
          <Basis value={office.area_basis} />
        </p>
      ) : null}
      {office.since_words ? <p>{office.since_words}</p> : null}
      {office.lease_end ? (
        <p>
          Lease ends {formatDate(office.lease_end)}
          <Basis value={office.lease_end_basis} />
        </p>
      ) : null}
      {office.fitout_by ? <p>Last fitout by {office.fitout_by}</p> : null}
      {source ? <p className="text-muted-foreground">From {source}.</p> : null}
    </>
  )
}

function Signs({ lead }: { lead: LeadDetail }) {
  if (lead.triggers.length === 0) {
    return <p className="text-muted-foreground">No sign that counts was found.</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {lead.triggers.map((item, index) => (
        <li key={`${item.trigger.id}-${String(index)}`}>
          {item.trigger.what_happened}{' '}
          <span className="text-muted-foreground">{item.trigger.date ?? 'Date not known'}. </span>
          <SourceLink href={item.trigger.source_url} />
        </li>
      ))}
    </ul>
  )
}

function Dampeners({ lead }: { lead: LeadDetail }) {
  if (lead.dampeners.length === 0) {
    return <p className="text-muted-foreground">Not checked for this lead yet.</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {lead.dampeners.map((item) => (
        <li key={item.id}>
          {item.state === 'found' ? (
            <>
              <span className="font-semibold">{`${item.label}.`}</span>{' '}
              {`${STRENGTH_WORDS[item.strength]}.${item.evidence ? ` ${item.evidence}` : ''}`}{' '}
              {item.url ? <SourceLink href={item.url} /> : null}
            </>
          ) : (
            <>
              {item.label}:{' '}
              <span className="text-muted-foreground">
                {item.state === 'not_found' ? 'not found' : 'not checked'}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

function WhoToContact({ lead }: { lead: LeadDetail }) {
  const roles = lead.contact_roles.length > 0 ? lead.contact_roles : [lead.contact_role]
  const named = lead.facts.decision_makers
  return (
    <>
      <p>{roles.filter(Boolean).join(', ') || 'Not known yet.'}</p>
      {named.length > 0 ? (
        <p className="text-muted-foreground">
          {`Named on public pages: ${named.map((person) => `${person.name}, ${person.role}`).join('; ')}.`}
        </p>
      ) : null}
    </>
  )
}

export function Profile({ lead }: { lead: LeadDetail }) {
  const change = lead.what_changed
  const city = lead.facts.city.value
  const sector = lead.facts.industry.value
  const whyNow = lead.why_now ? [lead.why_now.reason, lead.why_now.likely_next] : [lead.summary]
  return (
    <article
      aria-label={`Profile of ${lead.company}`}
      data-slot="profile"
      className="mx-auto flex w-full max-w-[186mm] flex-col gap-4 bg-card p-6 text-foreground print:max-w-none print:bg-transparent print:p-0"
    >
      <header className="flex flex-col gap-1 border-b pb-3">
        <h1 className="text-title font-semibold">{lead.company}</h1>
        <p className="text-ui text-muted-foreground">
          {[typeof city === 'string' ? city : null, typeof sector === 'string' ? sector : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <TierLine
            tier={lead.tier}
            score={lead.score}
            confidence={lead.confidence}
            className="text-section"
          />
          <span className="text-ui text-muted-foreground">{TIER_ACTIONS[lead.tier]}</span>
          {change ? <span className="text-ui">What changed: {change.text}</span> : null}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 print:grid-cols-2">
        <Part title="Why now">
          {whyNow.filter(Boolean).map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </Part>
        <Part title="Contour angle">
          <p>{lead.contour_angle ?? 'Not written yet.'}</p>
        </Part>
        <Part title="Local headcount">
          <Headcount lead={lead} />
        </Part>
        <Part title="Space needed">
          <Space lead={lead} />
        </Part>
        <Part title="Current office">
          <Office lead={lead} />
        </Part>
        <Part title="Who to contact">
          <WhoToContact lead={lead} />
        </Part>
      </div>

      <Part title="Signs">
        <Signs lead={lead} />
      </Part>
      <Part title="Dampeners">
        <Dampeners lead={lead} />
      </Part>
      <Part title="Suggested opener">
        <p className="font-serif text-ui">
          {lead.opening_line ? <>&ldquo;{lead.opening_line}&rdquo;</> : 'Not written yet.'}
        </p>
      </Part>
      <footer className="border-t pt-2 text-caption text-muted-foreground">
        {lead.confidence_why} Researched {formatDate(lead.created_at)}.
      </footer>
    </article>
  )
}

export default function ProfilePage() {
  const { leadId = '' } = useParams()
  const lead = useLead(leadId, { missingIsPage: true })
  return (
    <main className="min-h-screen bg-background px-4 py-6 print:min-h-0 print:bg-transparent print:p-0">
      <div className="mx-auto mb-4 flex max-w-[186mm] flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/leads/${leadId}`}>
            <ArrowLeft aria-hidden="true" />
            Back to the lead
          </Link>
        </Button>
        <Button
          type="button"
          disabled={!lead.data}
          onClick={() => {
            window.print()
          }}
        >
          <Printer aria-hidden="true" />
          Print
        </Button>
      </div>
      {lead.error ? (
        <ErrorState
          error={lead.error}
          context="This lead couldn't be loaded."
          onRetry={() => void lead.refetch()}
        />
      ) : lead.data ? (
        <Profile lead={lead.data} />
      ) : (
        <PendingDetail label="Loading the profile." />
      )}
    </main>
  )
}
