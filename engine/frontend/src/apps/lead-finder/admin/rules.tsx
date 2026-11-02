/**
 * Admin, Rules: the rules a company is checked against, read only. They live in the rules files
 * (`apps/lead_finder/rules/`), and every choice still to be confirmed with Levi is listed as TBC.
 */
import { useRules } from '@/api/hooks'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { resultLabel } from '@/lib/labels'

const SOURCE_WORDS: Record<string, string> = {
  hubspot: 'HubSpot',
  headcount_tool: 'Signal Hire',
  linkedin: 'LinkedIn (doubled)',
  web_research: 'the web research',
}

/** A list of sources in the order the rules look at them: 'HubSpot, then Signal Hire, then ...'. */
function sources(order: readonly string[]): string {
  return order.map((source) => SOURCE_WORDS[source] ?? source).join(', then ')
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-ui">{children}</CardContent>
    </Card>
  )
}

export default function AdminRulesTab() {
  const rules = useRules()
  if (rules.error) {
    return <ErrorState error={rules.error} context="The rules couldn't be loaded." />
  }
  if (!rules.data) {
    return <EmptyState title="Loading the rules." headingLevel={3} />
  }
  const { criteria, watchlist, version } = rules.data
  const tbc = [...criteria.tbc, ...watchlist.tbc]
  return (
    <div className="flex flex-col gap-6">
      <p className="text-ui text-muted-foreground">
        Rules version <span className="font-semibold text-foreground">{version}</span>. They change
        in the rules files, and a change shows as a new version on every run and lead.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Cities">
          <p>Can pass: {criteria.cities.pass.join(', ')}</p>
          <p>Director review: {criteria.cities.director_review.join(', ')}</p>
          <p>
            Any other city:{' '}
            {criteria.cities.other_cities === 'drop' ? 'dropped' : 'Director review'}
          </p>
        </Block>
        <Block title="Size">
          <p>
            An office of {formatNumber(criteria.size.office_m2_min)} to{' '}
            {formatNumber(criteria.size.office_m2_max)} m² fits. From{' '}
            {formatNumber(criteria.size.director_band_m2[0])} m² up to the minimum, a Director
            decides.
          </p>
          <p>
            When the office size isn&apos;t known, staff is only a hint:{' '}
            {criteria.size.staff_hint_min}+ office staff. Below it a company gets a flag, never a
            Drop. Over {formatNumber(criteria.size.staff_max)} staff goes to a Director.
          </p>
          <p>
            A small company that will need an office in range within{' '}
            {criteria.size.grow_into_range_months} months still fits.
          </p>
          <p>LinkedIn staff counts are multiplied by {criteria.size.linkedin_staff_multiplier}.</p>
        </Block>
        <Block title="Where the data comes from">
          <p>
            The first source with a value is the one the rules use. The other values stay on the
            lead card, and a big gap between them raises a flag for a person to check.
          </p>
          <ul className="list-disc pl-5">
            <li>Staff in the city: {sources(criteria.size.staff_sources)}</li>
            <li>
              Company name, website and industry: {sources(criteria.data_sources.company_details)}
            </li>
            <li>Cities with an office: {sources(criteria.data_sources.office_cities)}</li>
            <li>Decision makers: {sources(criteria.data_sources.decision_makers)}</li>
          </ul>
          <p>
            Staff numbers more than {criteria.conflicts.staff_gap_ratio} times apart raise a flag.
            Everything else (signs of an office change, owner, lease end, office size) comes from
            the web research alone.
          </p>
        </Block>
        <Block title="Score">
          <ul className="list-disc pl-5">
            {Object.entries(criteria.score.parts).map(([id, part]) => (
              <li key={id}>
                {part.label}: {part.points} points
              </li>
            ))}
          </ul>
          <p>
            {criteria.score.bands.research_first} to 100 research first,{' '}
            {criteria.score.bands.investigate} to {criteria.score.bands.research_first - 1}{' '}
            investigate, under {criteria.score.bands.investigate} nurture.
            {criteria.score.band_basis === 'scaled'
              ? ' The points are scaled to the points checked first.'
              : ''}
          </p>
          <p>
            More than {criteria.office_age.due_years} years at the same address is due. A move or
            fitout in the last {criteria.office_age.recent_move_years} years is recent.
          </p>
        </Block>
        <Block title="Results and stages">
          <ul className="list-disc pl-5">
            {Object.entries(criteria.stages).map(([result, stage]) => (
              <li key={result}>
                {resultLabel(result)}: {stage}
              </li>
            ))}
          </ul>
        </Block>
        <Block title="Signs of an office change">
          {(
            [
              ['Main', criteria.triggers.main],
              ['Other', criteria.triggers.other],
              ['Weak', criteria.triggers.weak],
            ] as const
          ).map(([group, items]) => (
            <div key={group}>
              <p className="font-semibold">{group}</p>
              <ul className="list-disc pl-5">
                {items.map((item) => (
                  <li key={item.id}>{item.label}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-muted-foreground">
            An event counts for {criteria.triggers.recent_months} months.
          </p>
        </Block>
        <Block title="Never suggest">
          <ul className="list-disc pl-5">
            {criteria.never_suggest.open_deal ? <li>A company with an open deal</li> : null}
            {criteria.never_suggest.already_sent ? <li>A company already sent</li> : null}
            <li>
              A dissolved deal, for {criteria.never_suggest.dissolved_deal_wait_months} months
              unless a new sign appears
            </li>
            {criteria.never_suggest.do_not_contact ? (
              <li>A company marked do not contact</li>
            ) : null}
          </ul>
        </Block>
      </div>
      <Block title="Still to be confirmed with Levi">
        {tbc.length === 0 ? (
          <p className="text-muted-foreground">Nothing is waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tbc.map((item) => (
              <li key={item.key} className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <Badge variant="outline">TBC</Badge>
                  <span className="font-semibold">{item.key}</span>
                </span>
                <span className="text-muted-foreground">{item.note}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <CardDescription>
        Sources never read: {criteria.source_domains.blocked.join(', ')}.
      </CardDescription>
    </div>
  )
}
