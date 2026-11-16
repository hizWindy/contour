/**
 * The prep card's own part (PLAN-V10 F1), in the side panel's one column:
 *
 * - **Last time we talked:** the last call's note, in the serif because it is a quote. It sits
 *   above the script, because it is the one thing to read before you say the opener.
 *
 * The card's other parts have their own files: the quick facts and "Company info" are the quick
 * look (`quick-look.tsx`, PLAN-V18 T3-7), "Before you dial" is in `before-you-dial.tsx`, the
 * script in `sales-script.tsx` and its title in `script-header.tsx` (PLAN-V14 T2-2).
 */
import { useId } from 'react'
import type { CompanyDetail, PrepFacts } from '@/api/types'
import { formatDate } from '@/lib/format'
import { CallNote } from './company-view'
import { Quiet } from './sales-script'
import { WAITING_FOR_PEOPLE } from './words'

export interface LastTalkProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
}

/** The last call: when, who, by whom and how it went, then its note. */
export function LastTalk({ company, facts }: LastTalkProps) {
  const title = useId()
  const call = facts?.last_call ?? company?.calls[0] ?? null
  const waiting = (facts?.people_status ?? company?.people_status) === 'waiting'
  return (
    <section aria-labelledby={title} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={title} className="text-ui font-semibold text-foreground">
          Last time we talked
        </h3>
        {call ? (
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
        ) : null}
      </div>
      {call ? (
        call.note ? (
          <CallNote text={call.note} />
        ) : (
          <Quiet>No note on this call.</Quiet>
        )
      ) : waiting ? (
        <Quiet>{WAITING_FOR_PEOPLE}</Quiet>
      ) : (
        <Quiet>No call logged in HubSpot.</Quiet>
      )}
    </section>
  )
}
