/**
 * The Score and rules tab: why this result, rule by rule; the five filters checked before the
 * score, each met, not met or estimated with its basis (PLAN-V16 T3-4); and the score in its
 * parts, each opening to the checks behind it, with what the dampeners took off.
 */
import { ChevronDown } from 'lucide-react'
import type { LeadDetail, Schemas } from '@/api/types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatNumber, pluralise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Section } from './parts'
import { FILTER_STATES } from './v16-words'
import { OUTCOME } from './words'

type ScorePartOut = Schemas['ScorePart']

const OPENER =
  'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted touch:min-h-11'
const CHEVRON =
  'ml-auto size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]:rotate-180'

function Rules({ lead }: { lead: LeadDetail }) {
  return (
    <Section title="Why this result">
      <p>{lead.why_it_fits}</p>
      <ul className="flex flex-col gap-1" aria-label="Each rule">
        {lead.checks.map((check, index) => {
          const meta = OUTCOME[check.outcome]
          const Icon = meta.icon
          return (
            <li key={`${check.rule}-${String(index)}`}>
              <Collapsible>
                <CollapsibleTrigger className={OPENER}>
                  <Icon aria-hidden="true" className={cn('size-4 shrink-0', meta.tone)} />
                  <span className="font-semibold">{check.rule}</span>
                  <span className="text-muted-foreground">{meta.word}</span>
                  <ChevronDown aria-hidden="true" className={CHEVRON} />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-8 pb-2 text-muted-foreground">
                  {check.detail}
                </CollapsibleContent>
              </Collapsible>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** The five filters (Levi's section 2). An unknown fact is estimated, never a fail. */
function Filters({ lead }: { lead: LeadDetail }) {
  if (lead.filters.length === 0) {
    return null
  }
  return (
    <Section title="The five filters">
      <ul className="flex flex-col gap-2" aria-label="Each filter">
        {lead.filters.map((filter) => {
          const meta = FILTER_STATES[filter.state]
          const Icon = meta.icon
          return (
            <li key={filter.id} className="flex items-start gap-2">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', meta.tone)} />
              <span className="flex min-w-0 flex-col">
                <span>
                  <span className="font-semibold">{filter.label}</span>{' '}
                  <span className="text-muted-foreground">{meta.word}</span>
                </span>
                <span className="text-muted-foreground">{filter.basis}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** "92 before the dampeners; they took off 10 points." Nothing when none was found. */
function Dampened({ lead }: { lead: LeadDetail }) {
  const deducted = lead.score_before_dampeners - lead.score
  if (deducted <= 0) {
    return null
  }
  return (
    <p>
      {formatNumber(lead.score_before_dampeners)} before the dampeners; they took off{' '}
      {pluralise(deducted, 'point')}, so the score is {formatNumber(lead.score)}.
    </p>
  )
}

function ScoreParts({ lead }: { lead: LeadDetail }) {
  if (lead.score_parts.length === 0) {
    return (
      <Section title="Score">
        <p className="text-muted-foreground">
          {lead.result === 'drop'
            ? 'A dropped company is not scored.'
            : 'This lead was scored under version 1 of the rules, so it has no parts.'}
        </p>
      </Section>
    )
  }
  return (
    <Section title="Score">
      <p>
        The tool could check {formatNumber(lead.score_checked ?? 0)} of the 100 points. Sales fills
        in the rest after the first call.
      </p>
      <Dampened lead={lead} />
      <ul className="flex flex-col gap-1" aria-label="Each part of the score">
        {lead.score_parts.map((part: ScorePartOut) => (
          <li key={part.id}>
            <Collapsible>
              <CollapsibleTrigger className={OPENER}>
                <span className="font-semibold">{part.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {part.earned} of {part.checked} checked
                </span>
                <ChevronDown aria-hidden="true" className={CHEVRON} />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-2">
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {part.checks.map((check) => (
                    <li key={check.id} className="flex flex-wrap gap-x-2">
                      <span className="text-foreground">{check.label}</span>
                      <span className="tabular-nums">
                        {check.known
                          ? `${String(check.earned)} of ${String(check.max)}`
                          : 'Not known yet'}
                      </span>
                      {check.known && check.detail ? <span>{check.detail}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-caption text-muted-foreground">
                  The part is worth {part.max} points.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function ScoreTab({ lead }: { lead: LeadDetail }) {
  return (
    <>
      <Rules lead={lead} />
      <Filters lead={lead} />
      <ScoreParts lead={lead} />
    </>
  )
}
