/**
 * A choice by voice (PLAN-V24 choice 14, T2-4): "the second one" or a name from the card's list
 * picks it, for a company, a person and a teammate; a person's or a teammate's name that isn't
 * there changes nothing and says so; and nothing here asks the AI (it is plain code). Made-up names
 * only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd, James Sample, Sam Example.
 */
import { describe, expect, it } from 'vitest'
import type { AssistantCommand, TeamMember } from '@/api/types'
import { pickByVoice } from './choose'
import { draftOf, type CallDraft, type CardDraft, type EmailDraft, type TaskDraft } from './draft'
import {
  callCommand,
  emailCommand,
  JAMES,
  JAMES_TOO,
  OTHER_SAMPLE,
  SAM,
  SAM_TOO,
  SAMPLE,
  taskCommand,
} from './fixtures'

function draft(command: AssistantCommand): CardDraft {
  const made = draftOf({ command, words: 'the words', source: 'mic' }, null)
  if (!made) throw new Error('No card for this command')
  return made
}

/** A task asking "Which Sample?". */
function whichSample(): TaskDraft {
  return draft(
    taskCommand({
      company: { found: null, choices: [SAMPLE, OTHER_SAMPLE], from_page: false, heard: 'Sample' },
    }),
  ) as TaskDraft
}

/** A call at Sample Logistics asking "Which James?". */
function whichJames(): CallDraft {
  return draft(
    callCommand({ person: { found: null, choices: [JAMES, JAMES_TOO], heard: 'James' } }),
  ) as CallDraft
}

/** A task for "Sam", with two Sams on the team. */
function whichSamTask(): TaskDraft {
  return draft(
    taskCommand({
      task: {
        subject: 'Send the quote',
        due: '2099-11-27',
        due_words: 'Friday',
        kind: 'todo',
        owner: { heard: 'Sam', found: null, choices: [SAM, SAM_TOO], address: null, problem: null },
        owner_id: null,
      },
    }),
  ) as TaskDraft
}

/** An email to "Sam", with two Sams on the team. */
function whichSamEmail(): EmailDraft {
  return draft(
    emailCommand({
      email: {
        to: [{ heard: 'Sam', found: null, choices: [SAM, SAM_TOO], address: null, problem: null }],
        subject: 'The floor plan',
        body: 'It is ready.',
      },
    }),
  ) as EmailDraft
}

function picked(pick: ReturnType<typeof pickByVoice>): CardDraft {
  if (pick?.kind !== 'picked') throw new Error(`Nothing picked: ${JSON.stringify(pick)}`)
  return pick.draft
}

describe('a company (T2-4)', () => {
  it.each(['the second one', 'The second one.', 'second', 'number two', 'the last one', '2'])(
    '"%s" picks the second company',
    (said) => {
      const next = picked(pickByVoice(whichSample(), said)) as TaskDraft
      expect(next.company.found).toEqual({ key: OTHER_SAMPLE.key, name: OTHER_SAMPLE.name })
      expect(next.company.choices).toEqual([])
      // Picked from the command's own choices: it teaches the mic nothing.
      expect(next.company.byHand).toBe(false)
    },
  )

  it.each([
    'Sample Logistics',
    'sample logistics pty ltd',
    'pick Sample Logistics',
    'the first one',
  ])('"%s" picks Sample Logistics from the list', (said) => {
    const next = picked(pickByVoice(whichSample(), said)) as TaskDraft
    expect(next.company.found).toEqual({ key: SAMPLE.key, name: SAMPLE.name })
  })

  it('a name both have picks neither, and the card asks again', () => {
    expect(pickByVoice(whichSample(), 'Sample')).toEqual({ kind: 'which' })
  })

  it('a name not in the list goes on to the command step, for now (T3-2 searches it)', () => {
    expect(pickByVoice(whichSample(), 'North Wind')).toBeNull()
  })

  it('a change goes on to the command step', () => {
    expect(pickByVoice(whichSample(), 'make it Monday')).toBeNull()
    expect(pickByVoice(whichSample(), 'the third one')).toBeNull()
  })
})

describe('a person on a call (T2-4)', () => {
  it('"the second one" picks the second person', () => {
    const next = picked(pickByVoice(whichJames(), 'the second one')) as CallDraft
    expect(next.person.found).toEqual(JAMES_TOO)
    expect(next.person.choices).toEqual([])
  })

  it.each(['James Example', 'James the facilities lead', "It's James Example"])(
    '"%s" picks James Example from the list',
    (said) => {
      expect((picked(pickByVoice(whichJames(), said)) as CallDraft).person.found).toEqual(JAMES_TOO)
    },
  )

  it.each(['no one in particular', 'nobody', 'the third one', 'the last one'])(
    '"%s" picks no one in particular, as the list ends',
    (said) => {
      const next = picked(pickByVoice(whichJames(), said)) as CallDraft
      expect(next.person.found).toBeNull()
      expect(next.person.choices).toEqual([])
    },
  )

  it.each(['James Smith', 'Pat'])(
    '"%s" is no one there: nothing changes, and the card says so',
    (said) => {
      expect(pickByVoice(whichJames(), said)).toEqual({ kind: 'none', words: said })
    },
  )

  it('"James" fits both: nothing changes, and the card asks again', () => {
    expect(pickByVoice(whichJames(), 'James')).toEqual({ kind: 'which' })
  })

  it('a change goes on to the command step', () => {
    expect(pickByVoice(whichJames(), 'make the follow-up Monday')).toBeNull()
    expect(pickByVoice(whichJames(), 'Friday')).toBeNull()
  })

  it('once the person is picked there is no question', () => {
    const done = picked(pickByVoice(whichJames(), 'James Sample'))
    expect(pickByVoice(done, 'the second one')).toBeNull()
  })
})

describe('a teammate (T2-4)', () => {
  const samToo: TeamMember = SAM_TOO

  it('"the second one" picks the second Sam a task is for', () => {
    const next = picked(pickByVoice(whichSamTask(), 'the second one')) as TaskDraft
    expect(next.forWhom?.found).toEqual(samToo)
    expect(next.forWhom?.choices).toEqual([])
  })

  it('a name from the list picks the Sam an email goes to', () => {
    const next = picked(pickByVoice(whichSamEmail(), SAM_TOO.name)) as EmailDraft
    expect(next.to[0]?.found).toEqual(samToo)
  })

  it.each([
    ['a task', whichSamTask],
    ['an email', whichSamEmail],
  ])('for %s, a name that isn’t on the team changes nothing, and the card says so', (_, made) => {
    expect(pickByVoice(made(), 'Sam Smith')).toEqual({ kind: 'none', words: 'Sam Smith' })
  })
})
