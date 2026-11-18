/**
 * Today's rules (PLAN-V22 T2-2, choices 6 and 8): the parts a person sees, the tasks' groups, the
 * order J and K move through, when the day is empty, and a row's company for L and V. Made-up
 * names only.
 */
import { describe, expect, it } from 'vitest'
import { deal, meeting, task, today, VITERA } from './fixtures'
import {
  callsRows,
  companyOf,
  nextRowId,
  nothingToday,
  onPageOfRow,
  rowsOf,
  taskGroups,
  type TodayRow,
} from './rows'
import { dealsMoreWords, dueWords, soonWords, tasksMoreWords } from './words'

describe('the rows J and K move through', () => {
  it('go tasks, meetings, calls, then deals, the most urgent first', () => {
    expect(rowsOf(today(), { soonOpen: true }).map((row) => row.id)).toEqual([
      'task:t1',
      'task:t2',
      'task:t3',
      'meeting:m1',
      'meeting:m2',
      'calls:to_confirm',
      'calls:needs_look',
      'deal:d1',
    ])
  })

  it('leave out the folded next 7 days', () => {
    expect(rowsOf(today(), { soonOpen: false }).map((row) => row.id)).not.toContain('task:t3')
  })

  it('leave out the parts a person doesn’t see', () => {
    const ids = rowsOf(today({ parts: ['meetings', 'deals'] }), { soonOpen: true }).map(
      (row) => row.id,
    )
    expect(ids).toEqual(['meeting:m1', 'meeting:m2', 'deal:d1'])
  })

  it('give a meeting typed in for a pre-read its pre-read’s id', () => {
    const typed = meeting({
      id: null,
      form: { id: 'f9', status: 'drafting', sent_at: null, sent_count: 0, sent_names: [] },
    })
    expect(rowsOf(today({ meetings: [typed] }), { soonOpen: false })).toContainEqual(
      expect.objectContaining({ id: 'meeting:f9' }),
    )
  })
})

describe('the tasks', () => {
  it('group overdue, today, then the next 7 days, keeping the server’s order inside', () => {
    const tasks = [
      task({ id: 'a', group: 'soon' }),
      task({ id: 'b', group: 'overdue' }),
      task({ id: 'c', group: 'today' }),
      task({ id: 'd', group: 'overdue' }),
    ]
    expect(
      taskGroups(tasks).map(({ group, tasks: inGroup }) => [group, inGroup.map((one) => one.id)]),
    ).toEqual([
      ['overdue', ['b', 'd']],
      ['today', ['c']],
      ['soon', ['a']],
    ])
  })

  it('say when each is due', () => {
    expect(dueWords({ group: 'overdue' }, 'Tue 17 Nov')).toBe('Overdue, due Tue 17 Nov')
    expect(dueWords({ group: 'today' }, 'Thu 19 Nov')).toBe('Due today')
    expect(dueWords({ group: 'soon' }, 'Tue 24 Nov')).toBe('Due Tue 24 Nov')
    expect(soonWords(5)).toBe('Next 7 days (5)')
  })

  it('count the ones HubSpot has beyond the list', () => {
    expect(tasksMoreWords(1)).toBe('1 older overdue task is in HubSpot too.')
    expect(tasksMoreWords(3)).toBe('3 older overdue tasks are in HubSpot too.')
    expect(dealsMoreWords(4)).toBe('And 4 more deals that need a nudge.')
  })
})

describe('the calls', () => {
  it('show each kind of work waiting, only when there is some', () => {
    expect(callsRows(today({ calls: { to_confirm: 0, needs_look: 2 } }))).toEqual([
      { kind: 'calls', id: 'calls:needs_look', tab: 'needs_look', count: 2 },
    ])
    expect(callsRows(today({ calls: { to_confirm: 0, needs_look: 0 } }))).toEqual([])
  })
})

describe('nothing today', () => {
  const empty = today({
    tasks: [],
    meetings: [],
    calls: { to_confirm: 0, needs_look: 0 },
    deals: [],
  })

  it('is every part empty, with the tasks read', () => {
    expect(nothingToday(empty)).toBe(true)
    expect(nothingToday(today())).toBe(false)
  })

  it('isn’t known while the tasks can’t be read', () => {
    expect(
      nothingToday({ ...empty, tasks_state: 'no_owner', tasks_sentence: 'Link your account.' }),
    ).toBe(false)
  })

  it('counts only the parts a person sees', () => {
    expect(nothingToday({ ...today({ deals: [deal()] }), ...empty, parts: ['tasks'] })).toBe(true)
  })
})

describe('a row’s company, for L and V', () => {
  const rows = rowsOf(today(), { soonOpen: true })
  const byId = (id: string): TodayRow | undefined => rows.find((row) => row.id === id)

  it('is the task’s, the meeting’s or the deal’s, and none for the calls', () => {
    expect(companyOf(byId('task:t3'))).toEqual(VITERA)
    expect(companyOf(byId('task:t2'))).toBeNull()
    expect(companyOf(byId('calls:to_confirm'))).toBeNull()
  })

  it('puts the meeting and its pre-read on screen with its company', () => {
    expect(onPageOfRow(byId('meeting:m1'))).toEqual({ company_key: '202', meeting_id: 'm1' })
    expect(onPageOfRow(byId('meeting:m2'))).toEqual({
      company_key: '201',
      meeting_id: 'm2',
      form_id: '0f3c9a2e-1111-2222-3333-444444444444',
    })
    expect(onPageOfRow(byId('deal:d1'))).toEqual({ company_key: '201' })
    expect(onPageOfRow(undefined)).toBeNull()
  })
})

describe('where the focus goes when a row leaves', () => {
  it('is the next row, or the one before the last', () => {
    expect(nextRowId(['a', 'b', 'c'], 'b')).toBe('c')
    expect(nextRowId(['a', 'b', 'c'], 'c')).toBe('b')
    expect(nextRowId(['a'], 'a')).toBeNull()
  })
})
