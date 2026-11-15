/**
 * The facts of the pre-read (PLAN-V17 "The screens", part 6), from HubSpot and our notes, with no
 * AI: when, where, who we meet (names and job titles), the Contour people, staff, offices, the
 * lease end and the deal stage. The server picks them, words them and leaves out any it doesn't
 * have; the page shows each as it comes, in its order, with where it came from in quiet text. The
 * server never puts an email address or a phone number in them.
 *
 * A new pre-read has none for a moment, while the server reads them: still grey rows show where
 * they will be. A draft that failed before it read them says so.
 */
import { Fragment, useId } from 'react'
import type { MeetingFormOut } from '@/api/v17'
import { Skeleton } from '@/components/ui/skeleton'
import { FACTS, FACTS_COMING, FACTS_NOTE, NO_FACTS } from './words'

/**
 * As many rows as a pre-read of a meeting in HubSpot has (when, where, who we meet, the Contour
 * people, staff, offices, the lease end and the deal stage), so nothing jumps when the facts come.
 */
const ROWS = 8

/**
 * The still rows of the facts, at their size: a label, a value and its source each. The page's own
 * loading shape uses them too.
 */
export function FactsRowsPending() {
  return (
    <div
      aria-hidden="true"
      data-slot="facts-pending"
      className="grid gap-x-6 gap-y-3 rounded-lg border bg-card p-4 sm:grid-cols-[10rem_minmax(0,1fr)]"
    >
      {Array.from({ length: ROWS }, (_, index) => (
        <Fragment key={index}>
          <Skeleton className="h-5 w-24" />
          {/* As the value sits under its label on a phone. */}
          <div className="flex flex-col gap-1 max-sm:-mt-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-28" />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** While the facts are read: a line that says so, over their still rows. */
function FactsComing() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-muted-foreground">{FACTS_COMING}</p>
      <FactsRowsPending />
    </div>
  )
}

export function FactsSection({ form }: { form: MeetingFormOut }) {
  const headingId = useId()
  let body
  if (form.facts.length > 0) {
    body = (
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-card p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {form.facts.map((fact, index) => (
          <Fragment key={`${fact.label}-${String(index)}`}>
            <dt className="text-ui text-muted-foreground">{fact.label}</dt>
            <dd className="flex min-w-0 flex-col gap-0.5 max-sm:-mt-2">
              <span className="text-ui break-words text-foreground">{fact.value}</span>
              <span className="text-caption text-muted-foreground">{fact.source}</span>
            </dd>
          </Fragment>
        ))}
      </dl>
    )
  } else if (form.status === 'drafting') {
    body = <FactsComing />
  } else {
    body = <p className="text-ui text-muted-foreground">{NO_FACTS}</p>
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-section font-semibold text-foreground">
          {FACTS}
        </h2>
        <p className="text-caption text-muted-foreground">{FACTS_NOTE}</p>
      </div>
      {body}
    </section>
  )
}
