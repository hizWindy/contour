/**
 * A short memory (PLAN-V25 T5-1): what a command leaves for the conversation's next turn. Made-up
 * names only.
 */
import { describe, expect, it } from 'vitest'
import type { AssistantCommand } from '@/api/types'
import { lastTurnOf } from './last-turn'

const SAMPLE = {
  key: '201',
  name: 'Sample Logistics Pty Ltd',
  city: 'Perth',
  industry: null,
  source: 'hubspot' as const,
}

function command(change: Partial<AssistantCommand>): AssistantCommand {
  return {
    action: 'log_call',
    read_back: 'Log a call.',
    company: null,
    person: null,
    meeting: null,
    note_text: null,
    task: null,
    email: null,
    open: null,
    change: null,
    unsure: null,
    ...change,
  }
}

describe('the last turn', () => {
  it('keeps the company and the person found, and their names as heard', () => {
    const call = command({
      company: { heard: 'Sample Logistics', from_page: false, found: SAMPLE, choices: [] },
      person: { heard: 'Jo', found: { id: 'c1', name: 'Jo Sample', title: null }, choices: [] },
    })
    expect(lastTurnOf(call)).toEqual({
      action: 'log_call',
      company_key: '201',
      company_heard: 'Sample Logistics',
      person_id: 'c1',
      person_heard: 'Jo',
    })
  })

  it('keeps no name that was not heard: the one on screen stays an id only', () => {
    const task = command({
      action: 'task',
      company: { heard: '', from_page: true, found: SAMPLE, choices: [] },
    })
    expect(lastTurnOf(task)).toEqual({
      action: 'task',
      company_key: '201',
      company_heard: '',
      person_id: null,
      person_heard: '',
    })
  })

  it('leaves nothing for a page, a change, or a command that found nobody', () => {
    expect(lastTurnOf(command({ action: 'open' }))).toBeNull()
    expect(lastTurnOf(command({ action: 'change' }))).toBeNull()
    expect(
      lastTurnOf(
        command({ company: { heard: 'North Wind', from_page: false, found: null, choices: [] } }),
      ),
    ).toBeNull()
  })
})
