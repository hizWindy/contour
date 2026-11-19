/**
 * The rules behind Today's rows (PLAN-V22 T2-2, choices 6 and 8), in plain code with no screen, so
 * each can be tested on its own:
 *
 * - **The parts,** the most urgent first: tasks, meetings, the pre-reads sent to me (PLAN-V23
 *   T2-4), calls, deals. A person sees only the parts the server lists for them (`parts`).
 * - **The tasks' groups:** overdue, today's, then the next 7 days' (folded). Inside a group the
 *   server's order stays.
 * - **J and K** move through every row on screen, in the page's order. The folded group's rows
 *   count only while it is open.
 * - **A row's company,** for L (log a call) and for the voice bar's `on_page` (choice 8).
 */
import type {
  AssistantOnPage,
  Schemas,
  Today,
  TodayCompany,
  TodayDeal,
  TodayMeeting,
  TodayPart,
  TodayTask,
} from '@/api/types'

/** A pre-read sent to me (PLAN-V23 T2-3), with or without a HubSpot user. */
export type TodayPreRead = Schemas['TodayPreRead']

export type CallsTab = 'to_confirm' | 'needs_look'

export type TodayRow =
  | { kind: 'task'; id: string; task: TodayTask }
  | { kind: 'meeting'; id: string; meeting: TodayMeeting }
  | { kind: 'pre_read'; id: string; preRead: TodayPreRead }
  | { kind: 'calls'; id: string; tab: CallsTab; count: number }
  | { kind: 'deal'; id: string; deal: TodayDeal }

export const TASK_ORDER: readonly TodayTask['group'][] = ['overdue', 'today', 'soon']

export function taskRowId(task: Pick<TodayTask, 'id'>): string {
  return `task:${task.id}`
}

/** A meeting's id: HubSpot's, or its pre-read's for one typed in. */
export function meetingRowId(meeting: TodayMeeting): string {
  return `meeting:${meeting.id ?? meeting.form?.id ?? `${meeting.company.key}@${meeting.starts_at}`}`
}

export function preReadRowId(preRead: Pick<TodayPreRead, 'form_id'>): string {
  return `pre-read:${preRead.form_id}`
}

/** The pre-reads sent to me: none from a server that doesn't send them yet. */
export function preReadsOf(today: Pick<Today, 'pre_reads'>): readonly TodayPreRead[] {
  return today.pre_reads ?? []
}

export function callsRowId(tab: CallsTab): string {
  return `calls:${tab}`
}

export function dealRowId(deal: Pick<TodayDeal, 'id'>): string {
  return `deal:${deal.id}`
}

/** True when this person sees the part. */
export function sees(today: Pick<Today, 'parts'>, part: TodayPart): boolean {
  return today.parts.includes(part)
}

/** The tasks in their groups, in order. Empty groups are left out. */
export function taskGroups(
  tasks: readonly TodayTask[],
): { group: TodayTask['group']; tasks: TodayTask[] }[] {
  return TASK_ORDER.map((group) => ({
    group,
    tasks: tasks.filter((task) => task.group === group),
  })).filter((one) => one.tasks.length > 0)
}

/** The calls part's rows: each kind of work waiting, only when there is some. */
export function callsRows(today: Pick<Today, 'calls'>): Extract<TodayRow, { kind: 'calls' }>[] {
  const tabs: [CallsTab, number][] = [
    ['to_confirm', today.calls.to_confirm],
    ['needs_look', today.calls.needs_look],
  ]
  return tabs
    .filter(([, count]) => count > 0)
    .map(([tab, count]) => ({ kind: 'calls', id: callsRowId(tab), tab, count }))
}

/** Every row on screen, in the page's order: what J and K move through. */
export function rowsOf(today: Today, { soonOpen }: { soonOpen: boolean }): TodayRow[] {
  const rows: TodayRow[] = []
  if (sees(today, 'tasks')) {
    for (const { group, tasks } of taskGroups(today.tasks)) {
      if (group === 'soon' && !soonOpen) continue
      for (const task of tasks) rows.push({ kind: 'task', id: taskRowId(task), task })
    }
  }
  if (sees(today, 'meetings')) {
    for (const meeting of today.meetings) {
      rows.push({ kind: 'meeting', id: meetingRowId(meeting), meeting })
    }
  }
  if (sees(today, 'pre_reads')) {
    for (const preRead of preReadsOf(today)) {
      rows.push({ kind: 'pre_read', id: preReadRowId(preRead), preRead })
    }
  }
  if (sees(today, 'calls')) rows.push(...callsRows(today))
  if (sees(today, 'deals')) {
    for (const deal of today.deals) rows.push({ kind: 'deal', id: dealRowId(deal), deal })
  }
  return rows
}

/**
 * Nothing due at all: every part this person sees is empty, and the tasks could be read. When they
 * couldn't, the day isn't known to be empty, and the parts say why.
 */
export function nothingToday(today: Today): boolean {
  const tasksKnown = today.tasks_state === 'ok' && today.tasks_sentence === null
  return (
    (!sees(today, 'tasks') || (tasksKnown && today.tasks.length === 0)) &&
    (!sees(today, 'meetings') || today.meetings.length === 0) &&
    (!sees(today, 'pre_reads') || preReadsOf(today).length === 0) &&
    (!sees(today, 'calls') || today.calls.to_confirm + today.calls.needs_look === 0) &&
    (!sees(today, 'deals') || today.deals.length === 0)
  )
}

/** A row's company, when it has one: for L and for the voice bar. */
export function companyOf(row: TodayRow | undefined): TodayCompany | null {
  if (!row) return null
  switch (row.kind) {
    case 'task':
      return row.task.company
    case 'meeting':
      return row.meeting.company
    case 'pre_read':
      return row.preRead.company
    case 'deal':
      return row.deal.company
    case 'calls':
      return null
  }
}

/** What a row puts on screen for the voice bar (choice 8): its company, and its meeting. */
export function onPageOfRow(row: TodayRow | undefined): AssistantOnPage | null {
  const company = companyOf(row)
  if (!row || !company) return null
  if (row.kind === 'meeting') {
    const { id, form } = row.meeting
    return {
      company_key: company.key,
      ...(id ? { meeting_id: id } : {}),
      ...(form ? { form_id: form.id } : {}),
    }
  }
  if (row.kind === 'pre_read') return { company_key: company.key, form_id: row.preRead.form_id }
  return { company_key: company.key }
}

/** The row after this one, or the one before it when it is the last: where the focus goes next. */
export function nextRowId(ids: readonly string[], id: string): string | null {
  const index = ids.indexOf(id)
  if (index === -1) return null
  return ids[index + 1] ?? ids[index - 1] ?? null
}
