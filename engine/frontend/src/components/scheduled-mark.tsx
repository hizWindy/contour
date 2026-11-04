import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * Says a run was started by a schedule and not by a person. A plain outline badge with an icon and
 * a word: colour is saved for results.
 */
export function ScheduledMark({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className} title="Started by a schedule">
      <CalendarClock aria-hidden="true" />
      Scheduled
    </Badge>
  )
}
