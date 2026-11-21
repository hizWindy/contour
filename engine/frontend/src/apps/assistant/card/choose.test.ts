/**
 * A choice by voice (PLAN-V24 choice 14, T2-4): "the second one" or a name from the card's list
 * picks it, for a company, a person and a teammate; a person's or a teammate's name that isn't
 * there changes nothing and says so; and nothing here asks the AI (it is plain code). T3-2: while
 * the card waits on its company, a name that isn't on screen is searched, and "the first one" picks
 * from the search list. Made-up names only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd,
 * Northwind Pty Ltd, North Wind (as misheard), James Sample, Sam Example.
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
  NORTHWIND,
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

  it('a name not in the list is searched (PLAN-V24 choice 19)', () => {
    expect(pickByVoice(whichSample(), 'North Wind')).toEqual({
      kind: 'search',
      words: 'North Wind',
    })
  })

  it('a change goes on to the command step', () => {
    expect(pickByVoice(whichSample(), 'make it Monday')).toBeNull()
    expect(pickByVoice(whichSample(), 'the third one')).toBeNull()
  })
})

describe('the company said again (PLAN-V24 T3-2, choice 19)', () => {
  /** A call whose company the command found nowhere. */
  function northWind(): CallDraft {
    return draft(
      callCommand({
        company: { found: null, choices: [], from_page: false, heard: 'North Wind', can_add: true },
        person: null,
      }),
    ) as CallDraft
  }
  const found = [
    { key: NORTHWIND.key, name: NORTHWIND.name },
    { key: SAMPLE.key, name: SAMPLE.name },
  ]

  it.each([
    ['Northwind', 'Northwind'],
    ['Northwind.', 'Northwind'],
    ["It's North Wind Freight, please.", 'North Wind Freight'],
    ['use Sample Freight', 'Sample Freight'],
  ])('with no list on screen, "%s" is searched as "%s"', (said, words) => {
    expect(pickByVoice(northWind(), said)).toEqual({ kind: 'search', words })
  })

  it('"the first one" picks the first company the search list shows, found by hand', () => {
    const next = picked(pickByVoice(northWind(), 'the first one', found)) as CallDraft
    expect(next.company.found).toEqual({ key: NORTHWIND.key, name: NORTHWIND.name })
    // By hand: the name heard can teach the mic (for a call, the server does it on the pick).
    expect(next.company.byHand).toBe(true)
    expect(next.company.heard).toBe('North Wind')
    expect(picked(pickByVoice(northWind(), 'second', found))).toMatchObject({
      company: { found: { key: SAMPLE.key } },
    })
  })

  it('a name the search list shows picks it; one it doesn’t is searched', () => {
    expect(picked(pickByVoice(northWind(), 'Sample Logistics', found))).toMatchObject({
      company: { found: { key: SAMPLE.key } },
    })
    expect(pickByVoice(northWind(), 'Southwind', found)).toEqual({
      kind: 'search',
      words: 'Southwind',
    })
  })

  it('the search list takes the place of "Which Sample?" once a name was searched', () => {
    const next = picked(pickByVoice(whichSample(), 'the first one', found)) as TaskDraft
    expect(next.company.found).toEqual({ key: NORTHWIND.key, name: NORTHWIND.name })
    expect(next.company.byHand).toBe(true)
  })

  it('a place with nothing there, a change, a filler or a long sentence is never searched', () => {
    expect(pickByVoice(northWind(), 'the first one')).toBeNull()
    expect(pickByVoice(northWind(), 'the third one', found)).toBeNull()
    expect(pickByVoice(northWind(), 'make the follow-up Monday')).toBeNull()
    expect(pickByVoice(northWind(), 'log a call with Northwind')).toBeNull()
    expect(pickByVoice(northWind(), 'um')).toBeNull()
    expect(pickByVoice(northWind(), 'B')).toBeNull()
    expect(
      pickByVoice(northWind(), 'they said the move is going ahead after all this year'),
    ).toBeNull()
  })

  it('once the company is picked, the person is the question again', () => {
    const next = picked(pickByVoice(northWind(), 'the first one', found))
    expect(pickByVoice(next, 'Northwind')).toBeNull()
  })

  it.each([
    'okay',
    'yeah',
    'Yep.',
    'hmm',
    'mhm',
    'huh',
    'Hmm, okay.',
    'right',
    'sure',
    'sure thing',
    'great',
    'all good',
    'no',
    'thanks',
    'thank you',
    'cheers',
    'hang on',
    'got it',
  ])('a reply or a sound alone, "%s", is never searched or picked (PLAN-V24 review)', (said) => {
    expect(pickByVoice(northWind(), said)).toBeNull()
    expect(pickByVoice(northWind(), said, found)).toBeNull()
    expect(pickByVoice(whichSample(), said)).toBeNull()
  })

  it('a name with a reply word in it is still searched whole, and a sound before it is left out', () => {
    expect(pickByVoice(northWind(), 'Great Southern Freight')).toEqual({
      kind: 'search',
      words: 'Great Southern Freight',
    })
    expect(pickByVoice(northWind(), 'Hmm, Southwind.')).toEqual({
      kind: 'search',
      words: 'Southwind',
    })
  })

  it('a sound before a place still picks by place', () => {
    expect(picked(pickByVoice(northWind(), 'hmm, the second one', found))).toMatchObject({
      company: { found: { key: SAMPLE.key } },
    })
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

  it.each(['great', 'hmm', 'thank you'])(
    'a reply, "%s", is no name: the card says nothing back (PLAN-V24 review)',
    (said) => {
      expect(pickByVoice(whichJames(), said)).toBeNull()
    },
  )

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
