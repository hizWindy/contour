/**
 * The Research tab: what the research cost and searched, its problems, what the source check left
 * out, the run that found it, older researches of the same company, what each page said, and the
 * rivals to check (PLAN-V9 B5).
 */
import { Link } from 'react-router'
import type { LeadDetail } from '@/api/types'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
import { SourceLink } from '@/components/source-link'
import { formatDate, formatNumber } from '@/lib/format'
import { Section, ShowFirst } from './parts'

function Notes({ lead }: { lead: LeadDetail }) {
  if (lead.notes.length === 0) return null
  return (
    <Section title="What each source said">
      <p className="text-caption text-muted-foreground">
        A summary of each page in Claude&apos;s words, not a quote.
      </p>
      <ShowFirst
        items={lead.notes}
        label="What each source said"
        keyOf={(note, index) => `${note.url}-${String(index)}`}
        render={(note) => (
          <div className="flex flex-col gap-1">
            <p>{note.claim}</p>
            <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span>{note.angle}</span>
              {note.published ? <span>{note.published}</span> : null}
              {note.from_memory ? <span>From memory</span> : null}
              <SourceLink href={note.url} />
            </p>
          </div>
        )}
      />
    </Section>
  )
}

function Research({ lead }: { lead: LeadDetail }) {
  return (
    <Section title="Research">
      <p>
        Cost <Money value={lead.research.cost_usd} /> of a <Money value={lead.research.cap_usd} />{' '}
        cap, {formatNumber(lead.research.web_searches)} web searches.
      </p>
      {lead.problems.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Problems</p>
          <ShowFirst
            items={lead.problems}
            label="Problems"
            className="list-disc gap-1 pl-5 text-muted-foreground"
            keyOf={(problem) => problem}
            render={(problem) => problem}
          />
        </div>
      ) : null}
      {lead.dropped.length > 0 ? (
        <p className="text-muted-foreground">
          Left out by the source check: {lead.dropped.join('; ')}
        </p>
      ) : null}
      {lead.run_id ? (
        <Link to={`/runs/${lead.run_id}`} className="w-fit underline-offset-4 hover:underline">
          Open the run that found it
        </Link>
      ) : null}
      {lead.previous.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Researched before</p>
          <ShowFirst
            items={lead.previous}
            label="Researched before"
            className="gap-1"
            keyOf={(item) => item.id}
            render={(item) => (
              <span className="flex flex-wrap items-center gap-2">
                <Link to={`/leads/${item.id}`} className="underline-offset-4 hover:underline">
                  {formatDate(item.created_at)}
                </Link>
                <ResultBadge result={item.result} />
                <span className="tabular-nums">Score {item.score}</span>
              </span>
            )}
          />
        </div>
      ) : null}
    </Section>
  )
}

const RIVAL_STATUS: Record<LeadDetail['rivals'][number]['status'], string> = {
  pending: 'The next run for the city researches it',
  used: 'Researched',
  skipped: 'Left out by a rule, like an open deal',
}

function Rivals({ lead }: { lead: LeadDetail }) {
  if (lead.rivals.length === 0) return null
  return (
    <Section title="Rivals to check">
      <p className="text-caption text-muted-foreground">
        Competitors in {lead.rivals[0]?.city}, found because this is a good lead in a booming
        industry. The next run for the city looks at them.
      </p>
      <ul className="flex flex-col gap-2">
        {lead.rivals.map((rival) => (
          <li key={`${rival.name}-${rival.city}`} className="flex flex-col gap-1">
            <span className="font-semibold">{rival.name}</span>
            <span>{rival.why}</span>
            <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span>{RIVAL_STATUS[rival.status]}</span>
              {rival.website ? <span>{rival.website}</span> : null}
              <SourceLink href={rival.url} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function ResearchTab({ lead }: { lead: LeadDetail }) {
  return (
    <>
      <Research lead={lead} />
      <Rivals lead={lead} />
      <Notes lead={lead} />
    </>
  )
}
