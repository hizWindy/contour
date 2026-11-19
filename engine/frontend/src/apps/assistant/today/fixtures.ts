/**
 * Today's answer for the tests (PLAN-V22 T2-2), with made-up names only: Sample Logistics Pty Ltd,
 * Vitera Pty Ltd, Jo Sample. Only tests import it; the app never does.
 */
import type { Today, TodayDeal, TodayMeeting, TodayTask } from '@/api/types'

/** The day the tests run on (Melbourne): Thursday 19 November 2026. */
export const TEST_NOW = new Date('2026-11-19T09:00:00+11:00')
export const TEST_DAY = '2026-11-19'

export const SAMPLE = { key: '201', name: 'Sample Logistics Pty Ltd' }
export const VITERA = { key: '202', name: 'Vitera Pty Ltd' }

export function task(change: Partial<TodayTask> = {}): TodayTask {
  return {
    id: 't1',
    subject: 'Call Jo Sample about the quote',
    kind: 'call',
    group: 'overdue',
    overdue: true,
    due: '2026-11-17',
    due_at: '2026-11-17T09:00:00+11:00',
    company: SAMPLE,
    hubspot_url: 'https://app.hubspot.com/tasks/1/view/t1',
    priority: null,
    ...change,
  }
}

export function meeting(change: Partial<TodayMeeting> = {}): TodayMeeting {
  return {
    id: 'm1',
    title: 'Fitout catch-up',
    day: 'today',
    starts_at: '2026-11-19T10:00:00+11:00',
    ends_at: '2026-11-19T11:00:00+11:00',
    company: VITERA,
    form: null,
    hubspot_url: null,
    ...change,
  }
}

export function deal(change: Partial<TodayDeal> = {}): TodayDeal {
  return {
    id: 'd1',
    name: 'Stage 2 fitout',
    company: SAMPLE,
    stage: 'Qualified Deal',
    close_date: '2026-11-12',
    last_contact: '2026-10-28T09:00:00+11:00',
    reasons: ['close_date_passed'],
    why: 'Close date passed, 12 Nov',
    hubspot_url: 'https://app.hubspot.com/deals/1/d1',
    ...change,
  }
}

/** A full day: a task in each group, a meeting today and tomorrow, calls waiting, and a deal. */
export function today(change: Partial<Today> = {}): Today {
  return {
    parts: ['tasks', 'meetings', 'calls', 'deals'],
    tasks: [
      task(),
      task({
        id: 't2',
        subject: 'Email the floor plan',
        kind: 'email',
        group: 'today',
        overdue: false,
        due: '2026-11-19',
        due_at: '2026-11-19T09:00:00+11:00',
        company: null,
        hubspot_url: null,
      }),
      task({
        id: 't3',
        subject: 'Book the site visit',
        kind: 'todo',
        group: 'soon',
        overdue: false,
        due: '2026-11-24',
        due_at: '2026-11-24T09:00:00+11:00',
        company: VITERA,
      }),
    ],
    tasks_state: 'ok',
    tasks_sentence: null,
    tasks_more: 0,
    meetings: [
      meeting(),
      meeting({
        id: 'm2',
        title: 'Design review',
        day: 'tomorrow',
        starts_at: '2026-11-20T14:00:00+11:00',
        ends_at: null,
        company: SAMPLE,
        form: {
          id: '0f3c9a2e-1111-2222-3333-444444444444',
          status: 'draft',
          sent_at: null,
          sent_count: 0,
          sent_names: [],
        },
      }),
    ],
    calls: { to_confirm: 3, needs_look: 1 },
    deals: [deal()],
    deals_more: 0,
    quiet_days: 14,
    checked_at: '2026-11-19T08:12:00+11:00',
    ...change,
  }
}
