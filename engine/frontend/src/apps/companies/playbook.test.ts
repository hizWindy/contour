import { describe, expect, it } from 'vitest'
import type { CompanyDetail, PrepScript } from '@/api/types'
import { buildGuide, guideFromPrep, guideText, shortMoney } from './playbook'

const TODAY = '2026-11-09'
const JASON = { name: 'Jason Reeds', title: 'Head of Operations' }

function detail(changes: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    key: '101',
    source: 'hubspot',
    name: 'ABC Logistics',
    domain: 'abclogistics.com.au',
    website: null,
    city: 'Perth',
    state: 'WA',
    industry: 'Logistics',
    staff: 300,
    linkedin_staff: 280,
    description: null,
    owner: 'Levi',
    lifecycle_stage: 'Opportunity',
    last_talk: '2026-10-01',
    last_talk_note: null,
    next_lease_end: '2027-06-30',
    deal: 'open',
    hubspot_url: null,
    offices: [
      {
        label: 'Perth',
        city: 'Perth',
        street: null,
        level: null,
        lease_end: '2027-06-30',
        moved_in: null,
        office_m2: null,
        linkedin_staff: null,
        quality: null,
      },
    ],
    deals: [
      {
        name: 'Perth fit-out',
        stage: 'Qualified Deal',
        state: 'open',
        pipeline: null,
        amount_aud: '1500000',
        close_date: '2027-03-01',
        owner: 'Levi',
        next_step: 'Site visit',
        hubspot_url: null,
      },
    ],
    notes: [],
    people: [],
    calls: [
      {
        id: '301',
        called_at: '2026-10-01T01:00:00Z',
        person: 'Jason Reeds',
        owner: 'Levi',
        minutes: 7,
        outcome: 'Connected',
        note: 'Lease ends next year.',
        hubspot_url: null,
      },
    ],
    people_status: 'ready',
    lead: null,
    ...changes,
  }
}

const texts = (lines: { text: string }[]): string[] => lines.map((line) => line.text)

describe('the free call script', () => {
  it('opens from the last call, gives the deal and the lease as reasons, and guides the questions', () => {
    const guide = buildGuide({ company: detail(), person: JASON, caller: 'Mia Wong', today: TODAY })

    expect(guide.madeFrom).toBe('hubspot')
    expect(texts(guide.opener)).toEqual([
      "Hi Jason, it's Mia from Contour. We spoke on 1 Oct.",
      'I wanted to follow up on Perth fit-out.',
    ])
    expect(texts(guide.whyNow)).toEqual([
      'The Perth lease ends in Jun 2027, in 7 months.',
      'Open deal: Perth fit-out, at Qualified Deal, $1.5M.',
    ])
    expect(guide.whyNow[0]?.why).toBe('HubSpot: Perth office')
    expect(texts(guide.questions)).toEqual([
      'Last time we spoke was on 1 Oct. What has changed since then?',
      'Where are things at with Perth fit-out? Is Mar 2027 still the plan?',
      'Your Perth lease ends in Jun 2027. Are you planning to renew, or to move?',
      'Who else is involved in decisions about the office?',
    ])
    expect(guide.questions[2]?.followUps.map((follow) => follow.answer)).toEqual([
      'Renew',
      'Move',
      'Not sure yet',
    ])
    expect(guide.goal).toMatchObject({ text: 'Site visit.', why: 'HubSpot: deal, next step' })
    expect(guide.ifTheySay.map((item) => item.theySay)).toEqual([
      "We're not ready to think about it yet.",
      'We already have a builder.',
      'Just send me an email.',
    ])
    expect(guide.ifTheySay[0]?.answer.text).toBe(
      'Understood. With the lease ending in Jun 2027, could I check in again in Feb 2027?',
    )
  })

  it('writes a cold call for the switchboard, with a placeholder for a caller nobody named', () => {
    const guide = buildGuide({ company: detail(), person: null, caller: null, today: TODAY })

    expect(texts(guide.opener)).toEqual([
      "Hi, it's [your name] from Contour. We design and build offices. Could I speak to whoever looks after your office space?",
      "When you're put through: I wanted to follow up on Perth fit-out.",
    ])
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

    expect(texts(guide.opener)).toEqual([
      "Hi Jason, it's Mia from Contour. We design and build offices.",
      'I wanted to check in on how the Melbourne office is working for the team.',
    ])
    expect(texts(guide.questions)).toEqual([
      'When does the lease on your Melbourne office end?',
      'How is the Melbourne office working for the team?',
      'Who else is involved in decisions about the office?',
    ])
    expect(guide.ifTheySay[0]?.theySay).toBe("We're happy with the office.")
    expect(guide.goal?.text).toBe('Ask for a referral, and a heads-up on any new office.')
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
    expect(texts(guide.questions)).toContain(
      'Your Sydney office is rated "Needs an Upgrade". Is a refresh on the list for next year?',
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
    })
    const guide = buildGuide({ company, person: JASON, caller: 'Mia', today: TODAY })

    expect(texts(guide.whyNow)).toEqual([
      'LinkedIn shows 150 staff in Australia, and HubSpot has 100. They may be growing.',
      'No talk on record since 1 Nov 2025, 12 months ago.',
    ])
    expect(texts(guide.questions)).toContain(
      'Are you growing? LinkedIn shows 150 staff in Australia, and HubSpot has 100.',
    )
    expect(
      buildGuide({
        company: detail({ staff: 100, linkedin_staff: 150, last_talk: '2025-01-01' }),
        person: JASON,
        caller: 'Mia',
        today: TODAY,
      }).whyNow,
    ).toHaveLength(3)
  })

  it('copies as plain text, follow-ups included', () => {
    const guide = buildGuide({ company: detail(), person: JASON, caller: 'Mia', today: TODAY })
    const text = guideText(guide, 'Jason Reeds, Head of Operations, ABC Logistics')

    expect(text).toContain('Call: Jason Reeds, Head of Operations, ABC Logistics')
    expect(text).toContain('3. Guided questions')
    expect(text).toContain(
      '   If "Renew": What would make the current space work better for the team?',
    )
    expect(text).toContain('5. Goal of the call\n- Site visit.')
    expect(text).not.toContain('—')
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
