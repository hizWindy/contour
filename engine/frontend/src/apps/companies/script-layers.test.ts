import { describe, expect, it } from 'vitest'
import { guideText, type CallGuide, type GuideLine } from './playbook'
import { applyEdits, lineSlot, parseSlot } from './script-layers'

function line(text: string, sources: string[] = ['F7']): GuideLine {
  return { text, why: sources.length ? 'HubSpot: Perth office' : null, sources, icon: 'lease' }
}

/** Claude's draft: sources on every line. */
function draft(changes: Partial<CallGuide> = {}): CallGuide {
  return {
    madeFrom: 'claude',
    tone: null,
    opener: [line("Hi Jason, it's Mia from Contour."), line('Your lease ends in June.')],
    whyNow: [line('The Perth lease ends in Jun 2027.')],
    questions: [
      {
        ...line('Renew or move?'),
        followUps: [{ answer: 'Move', ask: 'Who is helping you?' }],
      },
      { ...line('Who else decides?'), followUps: [] },
    ],
    ifTheySay: [{ theySay: "We're not ready yet.", answer: line("That's fair. When?") }],
    goal: line('Book a site visit.'),
    dropped: 1,
    ...changes,
  }
}

describe('a person’s line edits over the draft', () => {
  it('leaves the draft untouched when there are no edits', () => {
    const guide = draft()
    expect(applyEdits(guide, [])).toBe(guide)
    // A blank edit or a slot the script doesn't have changes nothing either.
    expect(
      applyEdits(guide, [
        { slot: 'opener.0', text: '   ' },
        { slot: 'follow_up.0', text: 'Nope' },
        { slot: 'tone', text: 'Nope' },
      ]),
    ).toBe(guide)
  })

  it('puts an edit in its slot, marked edited, with no sources', () => {
    const guide = draft()
    const shown = applyEdits(guide, [{ slot: 'opener.1', text: '  Calling about Perth.  ' }])

    expect(shown.opener[0]).toBe(guide.opener[0])
    expect(shown.opener[1]).toEqual({
      text: 'Calling about Perth.',
      why: null,
      sources: [],
      icon: 'lease',
      edited: { slot: 'opener.1', draft: 'Your lease ends in June.' },
    })
    // The rest of the script is the draft's.
    expect(shown.whyNow).toBe(guide.whyNow)
    expect(shown.questions).toBe(guide.questions)
    expect(shown.goal).toBe(guide.goal)
    expect(shown.dropped).toBe(1)
    // The draft itself is not changed.
    expect(guide.opener[1]?.text).toBe('Your lease ends in June.')
  })

  it('keeps a question’s follow-ups, and a pushback’s words, when their line is edited', () => {
    const shown = applyEdits(draft(), [
      { slot: 'question.0', text: 'Are you staying or going?' },
      { slot: 'if_they_say.0', text: 'Sounds like it’s early. Fair. Could I call in March?' },
      { slot: 'why_now.0', text: 'Lease ends mid next year.' },
      { slot: 'goal', text: 'Get a meeting in the diary.' },
    ])

    expect(shown.questions[0]).toMatchObject({
      text: 'Are you staying or going?',
      sources: [],
      followUps: [{ answer: 'Move', ask: 'Who is helping you?' }],
      edited: { slot: 'question.0', draft: 'Renew or move?' },
    })
    expect(shown.ifTheySay[0]).toMatchObject({
      theySay: "We're not ready yet.",
      answer: { text: 'Sounds like it’s early. Fair. Could I call in March?', sources: [] },
    })
    expect(shown.whyNow[0]?.edited?.slot).toBe('why_now.0')
    expect(shown.goal).toMatchObject({
      text: 'Get a meeting in the diary.',
      why: null,
      sources: [],
      edited: { slot: 'goal', draft: 'Book a site visit.' },
    })
  })

  it('a goal edit shows even when the draft has no goal', () => {
    const shown = applyEdits(draft({ goal: null }), [{ slot: 'goal', text: 'Get a name.' }])
    expect(shown.goal).toMatchObject({ text: 'Get a name.', edited: { slot: 'goal', draft: null } })
  })

  it('Research again with fewer lines: an edit past the end comes after the draft’s lines', () => {
    const edits = [
      { slot: 'opener.3', text: 'And one more thing.' },
      { slot: 'opener.2', text: 'Do you have two minutes?' },
      { slot: 'question.1', text: 'Who signs off?' },
      { slot: 'if_they_say.1', text: 'Happy to email it.' },
    ]
    // The new draft has 1 opener line, 1 question and 1 pushback.
    const again = draft({
      opener: [line('Hi Jason.')],
      questions: [{ ...line('What changed?'), followUps: [] }],
    })
    const shown = applyEdits(again, edits)

    expect(shown.opener.map((item) => item.text)).toEqual([
      'Hi Jason.',
      'Do you have two minutes?',
      'And one more thing.',
    ])
    expect(shown.opener.slice(1).map((item) => item.edited)).toEqual([
      { slot: 'opener.2', draft: null },
      { slot: 'opener.3', draft: null },
    ])
    expect(shown.questions[1]).toMatchObject({
      text: 'Who signs off?',
      followUps: [],
      icon: 'standard',
      edited: { slot: 'question.1', draft: null },
    })
    expect(shown.ifTheySay[1]).toMatchObject({
      theySay: '',
      answer: { text: 'Happy to email it.' },
    })
    // Each line still knows its slot, so a later save goes to the same place.
    expect(shown.opener.map((item, index) => lineSlot('opener', index, item))).toEqual([
      'opener.0',
      'opener.2',
      'opener.3',
    ])
  })

  it('Research again keeps the edited slots and fills the rest with the new draft', () => {
    const edits = [{ slot: 'opener.0', text: 'Hey Jason, Mia here.' }]
    const again = draft({ opener: [line('Hi Jason, new.'), line('New reason.')] })
    const shown = applyEdits(again, edits)
    expect(shown.opener.map((item) => item.text)).toEqual(['Hey Jason, Mia here.', 'New reason.'])
    expect(shown.opener[0]?.edited?.draft).toBe('Hi Jason, new.')
  })

  it('a reset (the edit removed) brings back the draft', () => {
    const guide = draft()
    const edited = applyEdits(guide, [{ slot: 'opener.0', text: 'Mine.' }])
    expect(edited.opener[0]?.text).toBe('Mine.')
    expect(applyEdits(guide, [])).toEqual(guide)
    expect(applyEdits(guide, [{ slot: 'opener.1', text: 'Other.' }]).opener[0]).toBe(
      guide.opener[0],
    )
  })

  it('a later edit for the same slot wins', () => {
    const shown = applyEdits(draft(), [
      { slot: 'goal', text: 'First.' },
      { slot: 'goal', text: 'Second.' },
    ])
    expect(shown.goal?.text).toBe('Second.')
  })

  it('"Copy script" copies the edited text', () => {
    const shown = applyEdits(draft(), [{ slot: 'question.0', text: 'Staying or going?' }])
    const text = guideText(shown, 'Jason Reeds')
    expect(text).toContain('1) Staying or going?\n   If "Move": Who is helping you?')
    expect(text).not.toContain('Renew or move?')
  })
})

describe('slots', () => {
  it('reads the slot names of the contract, and nothing else', () => {
    expect(parseSlot('opener.0')).toEqual({ section: 'opener', index: 0 })
    expect(parseSlot('why_now.2')).toEqual({ section: 'why_now', index: 2 })
    expect(parseSlot('question.12')).toEqual({ section: 'question', index: 12 })
    expect(parseSlot('if_they_say.1')).toEqual({ section: 'if_they_say', index: 1 })
    expect(parseSlot('goal')).toEqual({ section: 'goal', index: 0 })
    for (const bad of ['goal.0', 'opener', 'opener.-1', 'questions.0', 'follow_up.0', '']) {
      expect(parseSlot(bad)).toBeNull()
    }
  })
})
