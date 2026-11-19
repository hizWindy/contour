/**
 * The review card's rules without a screen (PLAN-V22 T3-3 and choice 22): a draft from each
 * command, what blocks a send, a change by voice, "send it", and the drafts kept in this browser,
 * which work even where storage is blocked. Made-up names only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyChange,
  callPatchOf,
  draftOf,
  emailBodyOf,
  missingOf,
  readBackOf,
  sendOrCancel,
  taskBodyOf,
  type TaskDraft,
} from './draft'
import { isTyping } from '@/lib/is-typing'
import { inTextBox } from './keys'
import { cardDrafts, cutHolds, dropCardDraft, keepCardDraft } from './drafts'
import { callCommand, emailCommand, JAMES, JAMES_TOO, note, SAM, taskCommand } from './fixtures'

const TODAY = '2099-11-23'

/** Each test keeps its drafts under its own person, so the page's own copy never mixes them. */
function taskDraft(by: string | null = null): TaskDraft {
  const made = draftOf({ command: taskCommand(), words: 'add a task', source: 'mic' }, by)
  if (made?.action !== 'task') throw new Error('not a task')
  return made
}

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('a draft from the command', () => {
  it('a task keeps the server’s day while the box reads as it did', () => {
    const draft = taskDraft()
    expect(draft).toMatchObject({ when: 'Friday', due: '2099-11-27', spoken: true, edited: false })
    expect(taskBodyOf(draft, TODAY)).toEqual({
      company_key: '201',
      subject: 'Send Sample Logistics the quote',
      body: '',
      due: '2099-11-27',
      kind: 'email',
      owner_id: null,
    })
  })

  it('a call keeps the whole words when the note came back empty (choice 16)', () => {
    const draft = draftOf(
      {
        command: callCommand({ note_text: '' }),
        words: 'log a call with Jo, all good',
        source: 'typed',
      },
      null,
    )
    expect(draft).toMatchObject({ action: 'log_call', text: 'log a call with Jo, all good' })
  })

  it('an email goes to teammates by owner id and to typed Contour addresses', () => {
    const made = draftOf(
      {
        command: emailCommand({
          email: {
            to: [
              { heard: 'Sam', found: SAM, choices: [], address: null, problem: null },
              {
                heard: 'pat',
                found: null,
                choices: [],
                address: 'pat@contour.example',
                problem: null,
              },
            ],
            subject: 'The floor plan',
            body: 'It is ready.',
          },
        }),
        words: 'email Sam and Pat',
        source: 'typed',
      },
      'person-1',
    )
    expect(made?.by).toBe('person-1')
    expect(made?.action === 'email' ? emailBodyOf(made) : null).toEqual({
      owner_ids: ['o-2'],
      emails: ['pat@contour.example'],
      subject: 'The floor plan',
      body: 'It is ready.',
      company_key: null,
    })
  })

  it('opens no card for an action that has none', () => {
    expect(
      draftOf({ command: callCommand({ action: 'open' }), words: '', source: 'mic' }, null),
    ).toBeNull()
  })
})

describe('what blocks a send', () => {
  it('in the card’s order: a choice, then each required box', () => {
    const call = draftOf(
      {
        command: callCommand({
          person: { found: null, choices: [JAMES, JAMES_TOO], heard: 'James' },
        }),
        words: '',
        source: 'mic',
      },
      null,
    )
    expect(call && missingOf(call, TODAY)).toBe('person')
    const task = taskDraft()
    expect(missingOf({ ...task, subject: ' ' }, TODAY)).toBe('subject')
    expect(missingOf({ ...task, when: 'whenever' }, TODAY)).toBe('due')
    expect(missingOf({ ...task, when: '1/1/2000' }, TODAY)).toBe('due')
    expect(missingOf({ ...task, company: { found: null, choices: [], heard: 'x' } }, TODAY)).toBe(
      'company',
    )
    expect(missingOf(task, TODAY)).toBeNull()
  })
})

describe('a change by voice', () => {
  it('changes a task’s box, and the read-back follows', () => {
    const changed = applyChange(taskDraft(), { box: 'due', value: 'Monday', day: '2099-11-30' })
    expect(changed).toMatchObject({ when: 'Monday', due: '2099-11-30', edited: true })
    expect(changed && readBackOf(changed, TODAY)).toBe(
      'Add a task for you: Send Sample Logistics the quote, due Mon 30 Nov.',
    )
    // A day in another year says its year.
    const later = applyChange(taskDraft(), { box: 'due', value: '4 Jan', day: '2100-01-04' })
    expect(later && readBackOf(later, TODAY)).toBe(
      'Add a task for you: Send Sample Logistics the quote, due Mon 4 Jan 2100.',
    )
    expect(
      applyChange(taskDraft(), { box: 'kind', value: 'a phone call', day: null }),
    ).toMatchObject({ kind: 'call' })
    expect(applyChange(taskDraft(), { box: 'owner', value: 'Sam', day: null })).toBeNull()
  })

  it('a call’s read-back follows the picks and the note’s follow-up once changed', () => {
    const call = draftOf({ command: callCommand(), words: '', source: 'mic' }, null)
    if (call?.action !== 'log_call') throw new Error('not a call')
    expect(readBackOf(call, TODAY, note())).toBe(call.readBack)
    const moved = note({ tasks: [{ ...note().tasks[0], due: '2099-11-30' }] })
    expect(readBackOf({ ...call, edited: true }, TODAY, moved)).toBe(
      'Log a call with Jo Sample at Sample Logistics Pty Ltd. Follow-up task on Mon 30 Nov.',
    )
    expect(
      readBackOf({ ...call, edited: true, person: { found: null, choices: [], heard: '' } }, TODAY),
    ).toBe('Log a call with Sample Logistics Pty Ltd.')
  })

  it('makes a call’s change a PATCH: the follow-up’s day, how it went, or the summary', () => {
    const outcomes = ['Connected', 'No answer']
    expect(
      callPatchOf(note(), { box: 'outcome', value: 'no answer', day: null }, outcomes),
    ).toEqual({ outcome: 'No answer' })
    expect(callPatchOf(note(), { box: 'outcome', value: 'great', day: null }, outcomes)).toBeNull()
    expect(
      callPatchOf(
        note({ tasks: [] }),
        { box: 'follow-up', value: 'Monday', day: '2099-11-30' },
        outcomes,
      ),
    ).toEqual({
      tasks: [{ subject: 'Follow up', due: '2099-11-30', due_words: 'Monday', kind: 'call' }],
    })
    expect(callPatchOf(note(), { box: 'follow-up', value: 'soon', day: null }, outcomes)).toBeNull()
  })
})

describe('"send it" and "cancel" (choice 23)', () => {
  it.each([
    ['Send it.', 'send'],
    ['okay send it', 'send'],
    ['Send it now', 'send'],
    ['Cancel', 'cancel'],
    ['cancel that', 'cancel'],
    ['send the quote to Jo', null],
    ['send it to Jo', null],
    // Words that only end in "send it" or "cancel" never count (the review before merge v22).
    ["Don't send it", null],
    ['no, do not send it', null],
    ["don't cancel", null],
    ['', null],
  ])('%j is %s', (heard, meant) => {
    expect(sendOrCancel(heard)).toBe(meant)
  })
})

describe('drafts kept in this browser (choice 22)', () => {
  it('keeps, lists and drops a person’s own drafts', () => {
    const mine = { ...taskDraft(), by: 'person-1' }
    keepCardDraft(mine)
    expect(cardDrafts('person-1').map((one) => one.key)).toEqual([mine.key])
    expect(cardDrafts('person-2')).toEqual([])
    dropCardDraft('person-1', mine.key)
    expect(cardDrafts('person-1')).toEqual([])
  })

  it('offers a draft cut off in its hold once', () => {
    const held = taskDraft('person-held')
    keepCardDraft(held, true)
    expect(cutHolds('person-held').map((one) => one.key)).toEqual([held.key])
    expect(cutHolds('person-held')).toEqual([])
    expect(cardDrafts('person-held')).toHaveLength(1)
  })

  it('works where storage is blocked, while the page is open', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const draft = taskDraft('person-blocked')
    expect(() => {
      keepCardDraft(draft)
    }).not.toThrow()
    expect(cardDrafts('person-blocked').map((one) => one.key)).toEqual([draft.key])
  })

  it('never keeps a call whose note is saved: it waits in Call logs', () => {
    const call = draftOf({ command: callCommand(), words: '', source: 'mic' }, 'person-call')
    if (call?.action !== 'log_call') throw new Error('not a call')
    keepCardDraft({ ...call, noteId: 'note-1' })
    expect(cardDrafts('person-call')).toEqual([])
    // Before its note is saved (no company picked yet), it is kept.
    keepCardDraft(call)
    expect(cardDrafts('person-call')).toHaveLength(1)
  })
})

describe('the card’s own box check (T3-6)', () => {
  it('agrees with the shared one on every part the card has', () => {
    const parts: HTMLElement[] = [
      document.createElement('input'),
      Object.assign(document.createElement('input'), { type: 'search' }),
      Object.assign(document.createElement('input'), { type: 'email' }),
      Object.assign(document.createElement('input'), { type: 'checkbox' }),
      document.createElement('textarea'),
      document.createElement('button'),
      Object.assign(document.createElement('button'), { role: 'radio' }),
      document.createElement('div'),
    ]
    for (const part of parts) {
      expect(inTextBox(part)).toBe(isTyping({ target: part, isComposing: false, key: 'v' }))
    }
  })
})
