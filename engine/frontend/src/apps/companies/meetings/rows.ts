/**
 * The rules behind Meetings' rows (PLAN-V17 "The screens", part 5), in plain code with no screen,
 * so each can be tested on its own:
 *
 * - **The groups:** Upcoming is grouped by its Melbourne day, which the server gives each meeting
 *   (`group`): Today, Tomorrow, This week (to Sunday) and Later. Inside a group the server's order
 *   stays: the soonest first.
 * - **One status a row:** a cancelled meeting says so, a past one from HubSpot whether its notes
 *   are logged, and an upcoming one where its pre-read stands. A meeting typed in isn't in HubSpot,
 *   so it has no notes to log: past or not, it says where its pre-read stands.
 */
import type { MeetingGroup, MeetingItem } from '@/api/types'

export type DayGroup = MeetingGroup

export interface MeetingGroupRows<Item extends MeetingItem = MeetingItem> {
  group: DayGroup
  items: Item[]
}

const ORDER: readonly DayGroup[] = ['today', 'tomorrow', 'this_week', 'later']

/**
 * Upcoming in its groups, in order, each in the order the server sent. Empty groups are left
 * out. An upcoming meeting with no group (the server always gives one) goes under Later, which
 * writes its whole day.
 */
export function groupUpcoming<Item extends MeetingItem>(
  items: readonly Item[],
): MeetingGroupRows<Item>[] {
  return ORDER.map((group) => ({
    group,
    items: items.filter((item) => (item.group ?? 'later') === group),
  })).filter((one) => one.items.length > 0)
}

/**
 * A row's one status. Upcoming, or typed in: `needs` (no pre-read yet), then the form's own
 * status. Past, from HubSpot: whether what was said is logged. A cancelled meeting is `cancelled`,
 * whenever it was.
 */
export type RowStatus =
  'needs' | 'drafting' | 'draft' | 'sent' | 'failed' | 'notes_logged' | 'no_notes' | 'cancelled'

/** HubSpot's outcome for a cancelled meeting, in either spelling. */
const CANCELLED = new Set(['CANCELED', 'CANCELLED'])

export function isCancelled(item: MeetingItem): boolean {
  return CANCELLED.has(item.meeting.outcome?.trim().toUpperCase() ?? '')
}

export function rowStatus(item: MeetingItem, past: boolean): RowStatus {
  if (isCancelled(item)) return 'cancelled'
  if (past && !item.typed) return item.notes_logged ? 'notes_logged' : 'no_notes'
  return item.form?.status ?? 'needs'
}

/** A row's key: HubSpot's id, or the form's for a meeting typed in (its `meeting.id` is empty). */
export function rowKey(item: MeetingItem): string {
  return (
    item.meeting.id ||
    item.form?.id ||
    `${item.meeting.company_id ?? item.company_name}@${item.meeting.starts_at}`
  )
}
