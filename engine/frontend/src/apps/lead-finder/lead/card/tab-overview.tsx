/**
 * The Overview tab: Why now first (PLAN-V12 D1), then the property record (PLAN-V16 T3-4: the
 * current office and what the tools know), then the summary with the Contour angle, the suggested
 * opener and the talking points, the size (staff and space, now and projected), the dampeners,
 * and who to talk to (the likely roles, the people public pages name, the senior people Signal
 * Hire has) and past fitout firms.
 *
 * Why now's When line holds the years at the address. A lead without a Why now keeps the office
 * line (PLAN-V11 B5) at the top of its Summary instead, so the office is never shown twice.
 *
 * Every text came from a web page or from Claude, so all of it is plain text, and every link goes
 * through `SourceLink`.
 */
import type { LeadDetail } from '@/api/types'
import { SourceLink } from '@/components/source-link'
import { melbourneDate } from '@/lib/format'
import { Section, ShowFirst } from './parts'
import { DampenersSection, PropertySection, SizeSection } from './property'
import { hasOffice } from './v16-words'
import { WhyNowSection } from './why-now'
import { officeLine, peopleFirst, type DecisionMaker } from './words'

/**
 * Leaders a public page names (the company's site, annual report, ASX or news), each with that
 * page and its date. People change jobs, so the card says to check before calling.
 */
function DecisionMakers({ people }: { people: DecisionMaker[] }) {
  if (people.length === 0) {
    return <p className="text-muted-foreground">No decision makers named on a public page.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">Decision makers</p>
      <ShowFirst
        items={people}
        label="Decision makers"
        className="gap-2"
        keyOf={(person) => `${person.name} ${person.source_url}`}
        render={(person) => (
          <span className="flex flex-col gap-0.5">
            <span>
              {person.name}, {person.role}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
              <SourceLink href={person.source_url} />
              {person.source_date ? <span>{person.source_date}</span> : null}
            </span>
          </span>
        )}
      />
      <p className="text-caption text-muted-foreground">
        From public pages. People change jobs, so check before you call.
      </p>
    </div>
  )
}

/** The senior people Signal Hire has on file: a name and a job title, never contact details. */
function SignalHirePeople({ people }: { people: LeadDetail['signalhire_people'] }) {
  if (people.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">From Signal Hire</p>
      <ShowFirst
        items={people}
        label="Senior people from Signal Hire"
        className="gap-1"
        keyOf={(person) => person.signalhire_id}
        render={(person) => (person.title ? `${person.name}, ${person.title}` : person.name)}
      />
    </div>
  )
}

export function OverviewTab({ lead }: { lead: LeadDetail }) {
  const people =
    peopleFirst(lead) === 'claude' ? (
      <>
        <DecisionMakers people={lead.facts.decision_makers} />
        <SignalHirePeople people={lead.signalhire_people} />
      </>
    ) : (
      <>
        <SignalHirePeople people={lead.signalhire_people} />
        <DecisionMakers people={lead.facts.decision_makers} />
      </>
    )
  return (
    <>
      <WhyNowSection lead={lead} />
      <PropertySection lead={lead} />
      <Section title="Summary">
        {/* The years at the address weigh more in the score since 9 Nov, so they come first.
            Why now's When line says them when there is one, and the property record above
            when it has the office. */}
        {lead.why_now || hasOffice(lead.office) ? null : (
          <p className="max-w-prose text-body">
            <span className="font-semibold">Office: </span>
            {officeLine(lead, melbourneDate())}
          </p>
        )}
        {lead.contour_angle ? (
          <p className="max-w-prose text-body">
            <span className="font-semibold">Contour angle: </span>
            {lead.contour_angle}
          </p>
        ) : null}
        <p className="max-w-prose text-body">{lead.summary}</p>
        {lead.opening_line ? (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Suggested opener</p>
            <p className="max-w-prose font-serif">&ldquo;{lead.opening_line}&rdquo;</p>
          </div>
        ) : null}
        {lead.facts.talking_points.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Talking points</p>
            <ul className="list-disc pl-5">
              {lead.facts.talking_points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
      <SizeSection lead={lead} />
      <DampenersSection lead={lead} />
      <Section title="Who to talk to">
        {lead.contact_roles.length > 0 ? (
          <p>
            <span className="font-semibold">Likely roles: </span>
            {lead.contact_roles.join(', ')}
          </p>
        ) : (
          <p>{lead.contact_role ?? 'Not known yet.'}</p>
        )}
        {/* The first source in the rules' list for decision makers comes first. */}
        {people}
        {lead.facts.fitout_contractors.length > 0 ? (
          <p className="text-muted-foreground">
            Past fitout firms: {lead.facts.fitout_contractors.join(', ')}
          </p>
        ) : null}
      </Section>
    </>
  )
}
