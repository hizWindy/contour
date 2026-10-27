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
            {formatNumber(criteria.size.staff_min)} to {formatNumber(criteria.size.staff_max)}{' '}
            staff, counted in the{' '}
            {criteria.size.staff_counted_in === 'city' ? 'city' : 'whole company'}.
          </p>
          <p>LinkedIn staff counts are multiplied by {criteria.size.linkedin_staff_multiplier}.</p>
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
