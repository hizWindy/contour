import { describe, expect, it } from 'vitest'
import type { PrepScript } from '@/api/types'
import { detail, JASON, stage, TODAY } from './guide-fixtures'
import {
  buildGuide,
  guideFromPrep,
  guideText,
  guideTone,
  shortMoney,
  type CallGuide,
  type GuideLine,
} from './playbook'

const texts = (lines: { text: string }[]): string[] => lines.map((line) => line.text)

const TIME_ASK = 'Do you have two minutes, or is there a better time?'
/** The end of every tone line in the default tone: the preset's advice, then the rule after a no. */
const AFTER_NO =
  'Keep it friendly: a short greeting and plain words. After a second no, thank them and let it go.'

/** A returning client, a company with a lease date and a cold call: the three cases of T3-2. */
const RETURNING = (): CallGuide =>
  buildGuide({ company: detail(), person: JASON, caller: 'Mia Wong', today: TODAY })
const LEASE_ONLY = (): CallGuide =>
  buildGuide({
    company: detail({
      deals: [],
      calls: [],
      deal: 'none',
      last_talk: null,
      relationship: stage('cold'),
    }),
    person: JASON,
    caller: 'Mia',
    today: TODAY,
  })
const COLD = (): CallGuide =>
  buildGuide({
    company: detail({
      deals: [],
      calls: [],
      deal: 'none',
      offices: [],
      next_lease_end: null,
      last_talk: null,
      relationship: stage('cold'),
    }),
    person: null,
    caller: 'Mia',
    today: TODAY,
  })

/** Every line the caller reads, in one list. */
function allLines(guide: CallGuide): GuideLine[] {
  return [
    ...(guide.tone ? [guide.tone] : []),
    ...guide.opener,
    ...guide.whyNow,
    ...guide.questions,
    ...guide.ifTheySay.map((item) => item.answer),
    ...(guide.goal ? [guide.goal] : []),
  ]
}

describe('the free call script', () => {
  it('opens from the last call, gives the deal and the lease as reasons, and guides the questions', () => {
    const guide = RETURNING()

    expect(guide.madeFrom).toBe('hubspot')
    expect(texts(guide.opener)).toEqual([
      "Hi Jason, it's Mia from Contour. We spoke on 1 Oct.",
      'I wanted to follow up on Perth fit-out.',
      TIME_ASK,
    ])
    expect(texts(guide.whyNow)).toEqual([
      'The Perth lease ends in Jun 2027, in 7 months.',
      'Open deal: Perth fit-out, at Qualified Deal, $1.5M.',
    ])
    expect(guide.whyNow[0]?.why).toBe('HubSpot: Perth office')
    expect(texts(guide.questions)).toEqual([
      'Last time we spoke was on 1 Oct. What has changed since then?',
      'Where are things at with Perth fit-out? Is Mar 2027 still the plan?',
      'Is anything holding up Perth fit-out, or still undecided?',
      "What happens if Perth fit-out isn't finished before the Perth lease ends in Jun 2027?",
      'If Perth fit-out runs to plan, what does that mean for the team?',
      'Who else is involved in decisions about the office?',
    ])
    expect(guide.questions[3]?.why).toBe('HubSpot: Perth office')
    expect(guide.questions[1]?.followUps.map((follow) => follow.answer)).toEqual([
      'On track',
      'Delayed',
    ])
    expect(guide.goal).toMatchObject({ text: 'Site visit.', why: 'HubSpot: deal, next step' })
    expect(guide.ifTheySay.map((item) => item.theySay)).toEqual([
      "We're not ready to think about it yet.",
      'We already have a builder.',
      'Just send me an email.',
    ])
    expect(guide.ifTheySay[0]?.answer.text).toBe(
      "Sounds like the timing isn't right yet. That's fair. With the lease ending in Jun 2027, could I check in again in Feb 2027?",
    )
  })

  it('asks the switchboard for the last contact, with a placeholder for a caller nobody named', () => {
    const guide = buildGuide({ company: detail(), person: null, caller: null, today: TODAY })

    expect(texts(guide.opener)).toEqual([
      "Hi, it's [your name] from Contour. Could I speak to Jason Reeds? We spoke in October.",
      "When you're put through: I wanted to follow up on Perth fit-out.",
      `Then: ${TIME_ASK}`,
    ])
    expect(guide.opener[0]?.why).toBe('HubSpot call, 1 Oct 2026')
    expect(guide.goal?.text).toBe(
      'Get the name of the person who looks after the office, and a good time to call them.',
    )
    expect(guide.ifTheySay.map((item) => item.theySay)).toEqual([
      "We're not interested.",
      'Can you just email it?',
    ])
    expect(guide.questions.at(-1)?.text).toBe(
      'Who looks after the office, and when is the next move?',
    )
    // The last call was with Jason, so a cold call doesn't ask what changed since.
    expect(texts(guide.questions)).not.toContain(
      'Last time we spoke was on 1 Oct. What has changed since then?',
    )
  })

  it('checks in with a customer, asks for the lease date it lacks, and aims for a referral', () => {
    const company = detail({
      deal: 'customer',
      lifecycle_stage: 'Customer',
      deals: [],
      calls: [],
      relationship: stage('customer'),
      offices: [
        {
          label: 'Melbourne',
          city: 'Melbourne',
          street: null,
          level: null,
          lease_end: null,
          moved_in: null,
          office_m2: null,
          linkedin_staff: null,
          quality: null,
        },
      ],
    })
    const guide = buildGuide({ company, person: JASON, caller: 'Mia', today: TODAY })

    // A customer: no intro, just who is calling, then the check-in.
    expect(texts(guide.opener)).toEqual([
      "Hi Jason, it's Mia from Contour.",
      'I wanted to check in on how the Melbourne office is working for the team.',
      TIME_ASK,
    ])
    expect(texts(guide.questions)).toEqual([
      'When does the lease on your Melbourne office end?',
      'How is the Melbourne office working for the team?',
      "If something isn't working, how does it affect the team day to day?",
      'If that were fixed, what would it be worth to the team?',
      'Who else is involved in decisions about the office?',
    ])
    expect(guide.ifTheySay[0]).toMatchObject({
      theySay: "We're happy with the office.",
      answer: {
        text: "Sounds like it's working well. That's great to hear. Is anything changing with team size or sites this year?",
      },
    })
    expect(guide.goal?.text).toBe('Ask for a referral, and a heads-up on any new office.')
    expect(guide.tone).toMatchObject({
      text: `Warm. They are a client, so catch up before the questions. ${AFTER_NO}`,
      why: 'A Contour customer',
    })
  })

  it('names "Other Office 2" by its city, and asks where the team is when no office is known', () => {
    const other = detail({
      deals: [],
      offices: [
        {
          label: 'Other Office 2',
          city: 'Sydney',
          street: null,
          level: null,
          lease_end: '2028-01-31',
          moved_in: null,
          office_m2: null,
          linkedin_staff: null,
          quality: 'Needs an Upgrade',
        },
      ],
    })
    const guide = buildGuide({ company: other, person: JASON, caller: 'Mia', today: TODAY })
    expect(texts(guide.whyNow)).toContain('The Sydney lease ends in Jan 2028, in 14 months.')
    expect(texts(guide.whyNow)).toContain(
      'The Sydney office is rated "Needs an Upgrade" in HubSpot.',
    )
    // The lease leads the questions, and its problem question uses the office's rating.
    expect(texts(guide.questions)).toContain(
      'Your Sydney office is rated "Needs an Upgrade". What isn\'t working in it today?',
    )
    expect(texts(guide.questions)).toContain(
      'What happens if the lease ends before the new space is ready?',
    )

    const nowhere = buildGuide({
      company: detail({ offices: [], deals: [], next_lease_end: null }),
      person: JASON,
      caller: 'Mia',
      today: TODAY,
    })
    expect(texts(nowhere.questions)).toContain(
      'Where is the team based now, and when does that lease end?',
    )
    expect(nowhere.goal?.text).toBe('Book a first meeting.')
  })

  it('spots growth and a long silence, at most 3 reasons', () => {
    const company = detail({
      deals: [],
      offices: [],
      deal: 'none',
      staff: 100,
      linkedin_staff: 150,
      last_talk: '2025-11-01',
      calls: [],
      relationship: stage('contacted', { since: '2025-11-01' }),
    })
    const guide = buildGuide({ company, person: JASON, caller: 'Mia', today: TODAY })

    expect(texts(guide.whyNow)).toEqual([
      'LinkedIn shows 150 staff in Australia, and HubSpot has 100. They may be growing.',
      'No talk on record since 1 Nov 2025, 12 months ago.',
    ])
    expect(texts(guide.questions)).toEqual([
      'Where is the team based now, and when does that lease end?',
      'Are you growing? LinkedIn shows 150 staff in Australia, and HubSpot has 100.',
      'Is the current office still big enough for the team?',
      'What happens if the team outgrows the space before there is a plan?',
      'If the space grew with the team, what would that mean for you?',
      'Who else is involved in decisions about the office?',
    ])
    expect(
      buildGuide({
        company: detail({ staff: 100, linkedin_staff: 150, last_talk: '2025-01-01' }),
        person: JASON,
        caller: 'Mia',
        today: TODAY,
      }).whyNow,
    ).toHaveLength(3)
  })

  it('copies as plain text, the tone and follow-ups included', () => {
    const guide = buildGuide({ company: detail(), person: JASON, caller: 'Mia', today: TODAY })
    const text = guideText(guide, 'Jason Reeds, Head of Operations, ABC Logistics')

    expect(text).toContain(
      `Call: Jason Reeds, Head of Operations, ABC Logistics\nTone: Warm. There is a deal in progress, so pick up where it stands. ${AFTER_NO}`,
    )
    expect(text).toContain('3. Guided questions')
    expect(text).toContain('   If "On track": What do you need from us before then?')
    expect(text).toContain('5. Goal of the call\n- Site visit.')
    expect(text).not.toContain('—')
  })

  it('says how old saved research is once it is over 90 days old', () => {
    const note = (date: string) => ({
      date,
      found_by: 'lead_finder',
      text: 'Won a contract with the state.',
      url: null,
    })
    const reason = (date: string) =>
      buildGuide({
        company: detail({ deals: [], notes: [note(date)] }),
        person: JASON,
        caller: 'Mia',
        today: TODAY,
      }).whyNow.find((item) => item.icon === 'news')?.why

    expect(reason('2026-06-03')).toBe('Saved research, 3 Jun 2026, 5 months ago')
    expect(reason('2026-10-20')).toBe('Saved research, 20 Oct 2026')
  })
})

describe('the script technique (PLAN-V14)', () => {
  const cases = [
    ['a returning client', RETURNING],
    ['a company with a lease date', LEASE_ONLY],
    ['a cold call', COLD],
  ] as const

  it.each(cases)('%s: the opener says who and why, then asks for two minutes', (_, make) => {
    const opener = texts(make().opener)
    expect(opener[0]).toMatch(/it's Mia from Contour\./)
    expect(opener).toHaveLength(3)
    expect(opener[2]).toMatch(/Do you have two minutes, or is there a better time\?$/)
  })

  it('a company with a lease date: situation, problem, cost, worth, then who decides', () => {
    const guide = LEASE_ONLY()
    expect(texts(guide.opener)[1]).toBe(
      'Your Perth lease ends in Jun 2027, so I wanted to check in early.',
    )
    expect(texts(guide.questions)).toEqual([
      'Your Perth lease ends in Jun 2027. Are you planning to renew, or to move?',
      "What isn't working as well as it should in the Perth office today?",
      'What happens if the lease ends before the new space is ready?',
      'If the new space were ready well before Jun 2027, what would that mean for the team?',
      'Who else is involved in decisions about the office?',
    ])
    expect(guide.questions.slice(0, 4).map((item) => item.why)).toEqual(
      Array(4).fill('HubSpot: Perth office'),
    )
  })

  it('a cold call: a standard reason, standard questions in the same order, and the switchboard goal', () => {
    const guide = COLD()
    expect(texts(guide.opener)).toEqual([
      "Hi, it's Mia from Contour. We design and build offices. Could I speak to whoever looks after your office space?",
      "When you're put through: I'm calling to see what's ahead for your office over the next year or two.",
      `Then: ${TIME_ASK}`,
    ])
    expect(texts(guide.questions)).toEqual([
      'Where is the team based now, and when does that lease end?',
      "What isn't working as well as it should in the current office?",
      'What does that cost the team, day to day?',
      'If that were fixed, what would it be worth to the team?',
      'Who looks after the office, and when is the next move?',
    ])
  })

  it.each(cases)('%s: each pushback answer has three beats and one question', (_, make) => {
    const answers = make().ifTheySay.map((item) => item.answer.text)
    expect(answers.length).toBeGreaterThan(0)
    for (const answer of answers) {
      // Name the feeling. Agree with what is fair. Ask one question.
      expect(answer).toMatch(/^Sounds like [^.?]+\. [^.?]+\. [^.?]+\?$/)
      expect(answer.split('?')).toHaveLength(2)
    }
  })

  it('a pushback with no lease date to lean on asks what would need to be true', () => {
    const guide = buildGuide({
      company: detail({ deals: [], calls: [], deal: 'none', offices: [], next_lease_end: null }),
      person: JASON,
      caller: 'Mia',
      today: TODAY,
    })
    expect(guide.ifTheySay[0]?.answer.text).toBe(
      "Sounds like the timing is tight. That's fair. What would need to be true for it to be worth a look?",
    )
  })

  it('the tone is warm for a returning client and light for a cold call', () => {
    expect(RETURNING().tone).toMatchObject({
      text: `Warm. There is a deal in progress, so pick up where it stands. ${AFTER_NO}`,
      why: 'HubSpot: deal',
    })
    const light = `Light. A cold call: keep it short, and listen more than you talk. ${AFTER_NO}`
    expect(LEASE_ONLY().tone).toMatchObject({ text: light, why: null })
    expect(COLD().tone).toMatchObject({ text: light, why: null })
    // An open deal is a returning client, even through the switchboard.
    expect(
      buildGuide({ company: detail(), person: null, caller: 'Mia', today: TODAY }).tone?.text,
    ).toBe(`Warm. There is a deal in progress, so pick up where it stands. ${AFTER_NO}`)
  })

  it.each(cases)('%s: a feeling is only ever a question', (_, make) => {
    const guide = make()
    const said = [
      ...allLines(guide).map((item) => item.text),
      ...guide.questions.flatMap((item) => item.followUps.map((follow) => follow.ask)),
    ]
    const feeling = /stress|worr|frustrat|anxious|nervous|overwhelm|hanging over|upset|annoy/i
    const felt = said.filter((text) => feeling.test(text))
    for (const text of felt) expect(text).toMatch(/\?$/)
  })

  it.each(cases)('%s: every line keeps its source mark', (_, make) => {
    // A line with a fact (a date, a number, the deal, the lease, a rating) says where it comes from.
    const fact = /\d|fit-out|lease|rated/i
    for (const item of allLines(make())) {
      if (fact.test(item.text)) expect(item.why, item.text).toBeTruthy()
    }
  })

  it('the questions never pass six: two situation, problem, cost, worth, who decides', () => {
    for (const make of [RETURNING, LEASE_ONLY, COLD]) {
      expect(make().questions.length).toBeLessThanOrEqual(6)
    }
  })

  it("gives Claude's script the same tone line", () => {
    const input = { company: detail(), person: JASON, caller: 'Mia', today: TODAY }
    expect(guideTone(input)).toEqual(buildGuide(input).tone)
  })
})

describe('the relationship stage (PLAN-V15)', () => {
  const WON = {
    name: 'Perth fit-out',
    stage: 'Ordered - Contract Signed',
    state: 'won' as const,
    pipeline: null,
    amount_aud: null,
    close_date: '2023-05-01',
    owner: 'Levi',
    next_step: null,
    hubspot_url: null,
  }
  const LOST = { ...WON, stage: 'Closed lost', state: 'lost' as const, close_date: '2025-06-01' }
  const SARAH_CALL = {
    id: '302',
    called_at: '2026-03-03T01:00:00Z',
    person: 'Sarah Lee',
    owner: 'Levi',
    minutes: 4,
    outcome: 'Connected',
    note: null,
    hubspot_url: null,
  }
  const at = (changes: Parameters<typeof detail>[0], person = JASON as typeof JASON | null) =>
    buildGuide({ company: detail(changes), person, caller: 'Mia', today: TODAY })

  const STAGES = {
    open_deal: () => at({ calls: [] }),
    customer: () => at({ deals: [WON], calls: [], relationship: stage('customer') }),
    past_customer: () =>
      at({ deals: [WON], calls: [], last_talk: null, relationship: stage('past_customer') }),
    lost_deal: () => at({ deals: [LOST], calls: [], relationship: stage('lost_deal') }),
    contacted: () => at({ deals: [], calls: [SARAH_CALL], relationship: stage('contacted') }),
    cold: () => at({ deals: [], calls: [], last_talk: null, relationship: stage('cold') }),
  }

  it('opens each stage its own way, and only a cold call says what Contour does', () => {
    const hellos = Object.fromEntries(
      Object.entries(STAGES).map(([name, make]) => [name, texts(make().opener).slice(0, 2)]),
    )
    expect(hellos).toEqual({
      open_deal: ["Hi Jason, it's Mia from Contour.", 'I wanted to follow up on Perth fit-out.'],
      customer: [
        "Hi Jason, it's Mia from Contour.",
        'Your Perth lease ends in Jun 2027, so I wanted to check in early.',
      ],
      past_customer: [
        "Hi Jason, it's Mia from Contour. We did your Perth fit-out in 2023.",
        'Your Perth lease ends in Jun 2027, so I wanted to check in early.',
      ],
      lost_deal: [
        "Hi Jason, it's Mia from Contour.",
        "Last time, the timing wasn't right for Perth fit-out, so I wanted to see what's changed.",
      ],
      contacted: [
        "Hi Jason, it's Mia from Contour. We spoke with Sarah Lee on 3 Mar.",
        'Your Perth lease ends in Jun 2027, so I wanted to check in early.',
      ],
      cold: [
        "Hi Jason, it's Mia from Contour. We design and build offices.",
        'Your Perth lease ends in Jun 2027, so I wanted to check in early.',
      ],
    })
    for (const [name, make] of Object.entries(STAGES)) {
      const said = allLines(make()).map((item) => item.text)
      const intro = said.some((text) => text.includes('We design and build offices'))
      expect(intro, name).toBe(name === 'cold')
    }
  })

  it('keeps the source of a remembered talk or deal', () => {
    expect(STAGES.past_customer().opener[0]).toMatchObject({
      why: 'HubSpot: deal',
      icon: 'customer',
    })
    expect(STAGES.contacted().opener[0]?.why).toBe('HubSpot call, 3 Mar 2026')
    // Contacted with no call on record: the stage's own date and source.
    const talk = at({ deals: [], calls: [], relationship: stage('contacted') })
    expect(talk.opener[0]).toMatchObject({
      text: "Hi Jason, it's Mia from Contour. We were last in touch in October.",
      why: 'HubSpot: last contacted',
    })
  })

  it('gives a lost deal as the first reason why now', () => {
    expect(STAGES.lost_deal().whyNow[0]).toMatchObject({
      text: 'Lost deal: Perth fit-out, closed 1 Jun 2025.',
      why: 'HubSpot deal',
    })
  })

  it("a switchboard call that isn't cold asks for the last contact by name", () => {
    const switchboard = (changes: Parameters<typeof detail>[0]) =>
      texts(at(changes, null).opener)[0]
    expect(switchboard({ deals: [], calls: [SARAH_CALL], relationship: stage('contacted') })).toBe(
      "Hi, it's Mia from Contour. Could I speak to Sarah Lee? We spoke in March.",
    )
    // A call last year says the year.
    const lastYear = { ...SARAH_CALL, called_at: '2025-12-02T01:00:00Z' }
    expect(switchboard({ deals: [], calls: [lastYear], relationship: stage('contacted') })).toBe(
      "Hi, it's Mia from Contour. Could I speak to Sarah Lee? We spoke in December 2025.",
    )
    // No call: the contact HubSpot was last in touch with.
    const people = [
      { id: 'c1', name: 'Tom Ng', title: null, phone: null, last_activity: '2026-02-10T00:00:00Z' },
      { id: 'c2', name: 'Ann Lo', title: null, phone: null, last_activity: '2026-07-01T00:00:00Z' },
    ]
    expect(switchboard({ deals: [WON], calls: [], people, relationship: stage('customer') })).toBe(
      "Hi, it's Mia from Contour. Could I speak to Ann Lo? We were in touch in July.",
    )
    // Nobody named, and not cold: no intro either.
    expect(switchboard({ deals: [LOST], calls: [], relationship: stage('lost_deal') })).toBe(
      "Hi, it's Mia from Contour. Could I speak to whoever looks after your office space?",
    )
    // Cold: today's intro.
    expect(switchboard({ deals: [], calls: [SARAH_CALL], relationship: stage('cold') })).toBe(
      "Hi, it's Mia from Contour. We design and build offices. Could I speak to whoever looks after your office space?",
    )
  })

  it('a direct call to someone we spoke to still says when', () => {
    const voicemail = { ...SARAH_CALL, person: 'Jason Reeds', outcome: 'Left voicemail' }
    expect(texts(at({ calls: [voicemail] }).opener)[0]).toBe(
      "Hi Jason, it's Mia from Contour. We left you a message on 3 Mar.",
    )
  })

  it('sets the tone line by the stage', () => {
    const tones = Object.fromEntries(
      Object.entries(STAGES).map(([name, make]) => [name, make().tone?.text.split('.')[0]]),
    )
    expect(tones).toEqual({
      open_deal: 'Warm',
      customer: 'Warm',
      past_customer: 'Warm',
      lost_deal: 'Warm and patient',
      contacted: 'Warm',
      cold: 'Light',
    })
    expect(STAGES.past_customer().tone?.text).toContain('They were a client')
    expect(STAGES.contacted().tone?.why).toBe('HubSpot: last contacted')
  })

  it('writes a cold script when the backend sends no stage', () => {
    const { relationship: _gone, ...old } = detail()
    const guide = buildGuide({ company: old, person: JASON, caller: 'Mia', today: TODAY })
    expect(texts(guide.opener)[0]).toBe(
      "Hi Jason, it's Mia from Contour. We design and build offices.",
    )
  })
})

describe('the tone presets (PLAN-V15)', () => {
  const written = (tone: 'friendly' | 'direct' | 'consultative' | 'formal', person = true) =>
    buildGuide({
      company: detail({ calls: [] }),
      person: person ? JASON : null,
      caller: 'Mia Wong',
      today: TODAY,
      tone,
    })

  it('changes the greeting, the time ask, the pushback and the close', () => {
    const words = (tone: Parameters<typeof written>[0]) => {
      const guide = written(tone)
      return {
        hello: guide.opener[0]?.text,
        time: guide.opener[2]?.text,
        pushback: guide.ifTheySay[0]?.answer.text.split('.')[0],
        goal: guide.goal?.text,
      }
    }
    expect(words('friendly')).toEqual({
      hello: "Hi Jason, it's Mia from Contour.",
      time: TIME_ASK,
      pushback: "Sounds like the timing isn't right yet",
      goal: 'Site visit.',
    })
    expect(words('direct')).toEqual({
      hello: "Jason, it's Mia from Contour.",
      time: 'Have you got two minutes?',
      pushback: "Understood, the timing isn't right yet",
      goal: 'Site visit. Ask for a day and time before you hang up.',
    })
    expect(words('consultative')).toEqual({
      hello: "Hi Jason, it's Mia from Contour.",
      time: 'Is now a good time for a few questions, or is there a better time?',
      pushback: "It sounds like the timing isn't right yet",
      goal: 'Site visit. Ask what they would want to get out of it.',
    })
    expect(words('formal')).toEqual({
      hello: 'Good morning Jason Reeds, my name is Mia Wong, from Contour Commercial Interiors.',
      time: 'Would you have two minutes to speak now, or would another time suit you better?',
      pushback: "I understand that the timing isn't right yet",
      goal: 'Site visit. Offer to confirm it in writing.',
    })
  })

  it('greets the switchboard in the tone too, and the tone line gives its advice', () => {
    expect(written('formal', false).opener[0]?.text).toBe(
      'Good morning, my name is Mia Wong, from Contour Commercial Interiors. Could I speak to whoever looks after your office space?',
    )
    expect(written('direct', false).opener[0]?.text).toBe(
      "It's Mia from Contour. Could I speak to whoever looks after your office space?",
    )
    expect(written('direct').tone?.text).toBe(
      'Warm. There is a deal in progress, so pick up where it stands. Keep it direct: short sentences, the reason first, no small talk. After a second no, thank them and let it go.',
    )
    // The switchboard's goal is the same in every tone: a name and a time.
    expect(written('formal', false).goal?.text).toBe(written('friendly', false).goal?.text)
  })

  it("uses Claude's own tone line when the script has one", () => {
    const script = {
      still_there: 'unknown',
      still_there_note: null,
      news: [],
      opener: [],
      why_now: [],
      questions: [],
      if_they_say: [],
      goal: null,
      dropped: 0,
      tone_line: 'Direct and warm: they are a client, so get to the point.',
    } as unknown as PrepScript
    expect(guideFromPrep(script, new Map()).tone?.text).toBe(
      'Direct and warm: they are a client, so get to the point.',
    )
  })
})

describe("call prep's script in the same shape", () => {
  it('keeps the sources, takes the why from their labels, and reads the follow-ups', () => {
    const script = {
      still_there: 'yes',
      still_there_note: null,
      news: [],
      opener: [{ text: 'Hi Jason.', sources: ['F11'] }],
      why_now: [{ text: 'The Perth lease ends in June 2027.', sources: ['F7'] }],
      questions: [
        {
          text: 'Renew or move?',
          sources: ['F7'],
          follow_ups: [{ if_they_say: 'Move', ask: 'Who is helping you?' }],
        },
      ],
      if_they_say: [],
      goal: { text: 'Book a site visit.', sources: ['F7'] },
      dropped: 2,
    } as unknown as PrepScript
    const guide = guideFromPrep(
      script,
      new Map([
        ['F7', 'HubSpot: Perth office'],
        ['F11', 'HubSpot call, 1 Oct 2026'],
      ]),
    )

    expect(guide.madeFrom).toBe('claude')
    // The answer form has no tone; the card adds the same tone line as the free script.
    expect(guide.tone).toBeNull()
    expect(guide.whyNow[0]).toMatchObject({
      why: 'HubSpot: Perth office',
      sources: ['F7'],
      icon: 'lease',
    })
    expect(guide.opener[0]?.icon).toBe('call')
    expect(guide.questions[0]?.followUps).toEqual([{ answer: 'Move', ask: 'Who is helping you?' }])
    expect(guide.dropped).toBe(2)
  })
})

describe('short money', () => {
  it('writes millions and thousands the way a caller says them', () => {
    expect(shortMoney('1500000')).toBe('$1.5M')
    expect(shortMoney('2000000')).toBe('$2M')
    expect(shortMoney('850000')).toBe('$850k')
    expect(shortMoney(null)).toBeNull()
    expect(shortMoney('0')).toBeNull()
  })
})
