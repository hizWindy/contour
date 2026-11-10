/**
 * The Why now section (PLAN-V12 D1), first on the Overview tab: why call this company now.
 *
 * Claude's reason and likely next step come first, with the notes they rest on. Then the lines
 * code worked out from the facts: When (with the years at the address), Size, Missing, and the
 * questions to ask on the call. Each estimate says "estimated" and shows its working. How sure we
 * are sits next to the title; Low is a thin lead, and the card says to check the sources first.
 *
 * Every text came from Claude or a web page, so all of it is plain text, and every link goes
 * through `SourceLink`.
 */
import { Flag } from 'lucide-react'
import type { ReactNode } from 'react'
import type { LeadDetail } from '@/api/types'
import { SourceLink } from '@/components/source-link'
import { formatDate } from '@/lib/format'
import { Section } from './parts'
import { CONFIDENCE_WORDS, whyNotWritten, type WhyNow } from './words'

/** One row: a short label, and the line beside it (under it on a phone). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-caption text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="max-w-prose min-w-0">{children}</dd>
    </div>
  )
}

/** A line code wrote, with the page it rests on. Its text says "estimated" when it is one. */
function Line({ line }: { line: WhyNow['when'] | WhyNow['size'] }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{line.text}</span>
      {line.source_url ? (
        <span className="text-caption text-muted-foreground">
          <SourceLink href={line.source_url} />
        </span>
      ) : null}
    </span>
  )
}

export function WhyNowSection({ lead }: { lead: LeadDetail }) {
  const why = lead.why_now
  if (!why) {
    return (
      <Section title="Why now">
        <p className="max-w-prose text-muted-foreground">
          Not written for this lead: {whyNotWritten(lead)}
        </p>
      </Section>
    )
  }
  return (
    <Section title="Why now" aside={CONFIDENCE_WORDS[why.confidence]}>
      {why.confidence === 'low' ? (
        <p className="flex max-w-prose items-start gap-2">
          <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-review" />
          <span>
            <span className="font-semibold">Thin lead:</span> check the sources before you call.
          </span>
        </p>
      ) : null}
      {why.reason ? (
        <p className="max-w-prose text-body">{why.reason}</p>
      ) : (
        <p className="max-w-prose text-muted-foreground">
          The check removed Claude&apos;s reason. What it removed is listed below.
        </p>
      )}
      {why.likely_next ? (
        <p className="max-w-prose text-body">
          <span className="font-semibold">Likely next: </span>
          {why.likely_next}
        </p>
      ) : null}
      {why.links.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span>From</span>
          {why.links.map((link) => (
            <SourceLink key={link} href={link} />
          ))}
        </p>
      ) : null}
      <dl className="flex flex-col gap-3">
        <Row label="When">
          <Line line={why.when} />
        </Row>
        <Row label="Size">
          <Line line={why.size} />
        </Row>
        <Row label="Missing">
          {why.missing.length > 0 ? `${why.missing.join('; ')}.` : 'Nothing key.'}
        </Row>
        <Row label="Ask">
          {why.ask.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {/* Plain type: the serif voice is for quotes from sources (engine/DESIGN.md) */}
              {why.ask.map((question) => (
                <li key={question}>&ldquo;{question}&rdquo;</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">No question was written.</span>
          )}
        </Row>
      </dl>
      {why.dropped.length > 0 ? (
        <div className="flex flex-col gap-1 text-caption text-muted-foreground">
          <p>Removed by the check:</p>
          <ul className="list-disc pl-5">
            {why.dropped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        Written {formatDate(why.written_at)} by {why.model}, US$
        {Number(why.cost_usd).toFixed(2)}. Code wrote When, Size and Missing from the facts.
      </p>
    </Section>
  )
}
