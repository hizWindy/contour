/**
 * The Signs tab: every sign of an office change that counts, strongest first, each with what
 * happened, its date, how sure it is, its points and its page. The first three show at once.
 */
import { useRules } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { SourceLink } from '@/components/source-link'
import { Badge } from '@/components/ui/badge'
import { Section, ShowFirst } from './parts'
import { LABEL_WORDS } from './words'

/** The Profile's timing advice. The tool can't see when a consultant is appointed. */
function ConsultantNote() {
  const rules = useRules()
  const months = rules.data?.criteria.triggers.consultant_window_months
  if (!months) {
    return null
  }
  return (
    <p className="text-caption text-muted-foreground">
      Best timing is before a consultant is appointed. That is usually within {months} months of the
      project, and the tool can&apos;t see it.
    </p>
  )
}

export function SignsTab({ lead }: { lead: LeadDetail }) {
  // Strongest first. Equal points keep the order the research gave.
  const signs = [...lead.triggers].sort((a, b) => b.points - a.points)
  return (
    <Section title="Signs of an office change">
      {signs.length === 0 ? (
        <p className="text-muted-foreground">No sign that counts was found.</p>
      ) : (
        <ShowFirst
          items={signs}
          label="Signs of an office change"
          keyOf={({ trigger }, index) => `${trigger.id}-${String(index)}`}
          render={({ trigger, points }) => (
            <div className="flex flex-col gap-1">
              <p>{trigger.what_happened}</p>
              <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                {trigger.date ? <span>{trigger.date}</span> : <span>Date not known</span>}
                <Badge variant="outline">{LABEL_WORDS[trigger.label] ?? trigger.label}</Badge>
                <span>{points} points</span>
                <SourceLink href={trigger.source_url} />
              </p>
            </div>
          )}
        />
      )}
      <ConsultantNote />
    </Section>
  )
}
