/**
 * The rules behind Meetings' rows (PLAN-V17 "The screens", part 5), in plain code with no screen,
 * so each can be tested on its own:
 *
 * - **The groups:** Upcoming is grouped by its Melbourne day: Today, Tomorrow, This week (to
 *   Sunday, as weeks run Monday to Sunday) and Later. Inside a group, the earliest first.
 * - **One status a row:** a cancelled meeting says so, a past one whether its notes are logged,
 *   and an upcoming one where its pre-read stands.
 */
import type { MeetingItem } from '@/api/v17'
import { addDays, weekdayOf } from '@/lib/due-date'
import { melbourneDate } from '@/lib/format'

export type DayGroup = 'today' | 'tomorrow' | 'this_week' | 'later'

export interface MeetingGroup {
  group: DayGroup
  items: MeetingItem[]
}

/**
 * Which group a Melbourne day (YYYY-MM-DD) falls in. A day before today (a meeting still going
 * from earlier) counts as today. On a Saturday, This week is only Sunday, which is Tomorrow: so
 * the group is empty and doesn't show.
 */
export function dayGroupOf(day: string, today: string): DayGroup {
  if (day <= today) return 'today'
  if (day === addDays(today, 1)) return 'tomorrow'
  const sunday = addDays(today, 7 - weekdayOf(today))
  return day <= sunday ? 'this_week' : 'later'
}

const ORDER: readonly DayGroup[] = ['today', 'tomorrow', 'this_week', 'later']

/** Upcoming in its groups, in order, the earliest first in each. Empty groups are left out. */
export function groupUpcoming(items: readonly MeetingItem[], today: string): MeetingGroup[] {
  const sorted = [...items].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  return ORDER.map((group) => ({
    group,
    items: sorted.filter((item) => dayGroupOf(melbourneDate(item.starts_at), today) === group),
  })).filter((one) => one.items.length > 0)
}

/**
 * A row's one status. Upcoming: `needs` (no pre-read yet), then the form's own status. Past:
 * whether what was said is logged. A cancelled meeting is `cancelled`, whenever it was.
 */
export type RowStatus =
  'needs' | 'drafting' | 'draft' | 'sent' | 'failed' | 'notes_logged' | 'no_notes' | 'cancelled'

/** HubSpot's outcome for a cancelled meeting. */
const CANCELED = 'CANCELED'

export function isCancelled(item: MeetingItem): boolean {
  return item.outcome?.toUpperCase() === CANCELED
}

export function rowStatus(item: MeetingItem, past: boolean): RowStatus {
  if (isCancelled(item)) return 'cancelled'
  if (past) return item.notes_logged ? 'notes_logged' : 'no_notes'
  return item.form?.status ?? 'needs'
}

/** A row's key: HubSpot's id, or the form's for a meeting typed in. */
export function rowKey(item: MeetingItem): string {
  return item.id ?? item.form?.id ?? `${item.company_key}@${item.starts_at}`
}
