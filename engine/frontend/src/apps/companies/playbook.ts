/**
 * The free call script on the prep card (PLAN-V10 F1, 9 Nov): what to say first, why now, guided
 * questions with what to ask next, answers to pushback and the goal of the call. It is written
 * here, at once, from what we already know about the company: our HubSpot copy and, for people
 * with its tick, the Lead Finder. No Claude request, so it is free and ready as the card opens.
 *
 * When call prep is switched on, Claude's script (with its web check for news and "still there?")
 * takes its place once it is ready. Both have the same shape (`CallGuide`), so the card shows
 * either one the same way.
 *
 * The wording is ours, from the prototype and Levi's 2 Nov questions. It is TBC with Levi.
 */
import type {
  CompanyCall,
  CompanyDeal,
  CompanyDetail,
  CompanyOffice,
  PrepScript,
  ScriptLine,
} from '@/api/types'

type FollowUpOut = PrepScript['questions'][number]['follow_ups'][number]
import { agoWords, monthsBetween } from './dates'

/** What a line is about, for its icon. */
export type GuideIcon =
  | 'call'
  | 'customer'
  | 'deal'
  | 'lead'
  | 'lease'
  | 'news'
  | 'office'
  | 'people'
  | 'quiet'
  | 'staff'
  | 'standard'
  | 'web'

export interface GuideLine {
  text: string
  /** Where it comes from, in words, like "HubSpot: Perth office". Null for a standard line. */
  why: string | null
  /** Claude's lines only: the ids of their sources (F3, W1), shown as chips. */
  sources: string[]
  icon: GuideIcon
}

export interface FollowUp {
  /** What they might answer, in a few words, like "Renew". */
  answer: string
  /** What to ask next. */
  ask: string
}

export interface GuideQuestion extends GuideLine {
  followUps: FollowUp[]
}

export interface GuideObjection {
  theySay: string
  answer: GuideLine
}

export interface CallGuide {
  /** hubspot: written here from our copy, free. claude: call prep's script, with its web check. */
  madeFrom: 'hubspot' | 'claude'
  opener: GuideLine[]
  whyNow: GuideLine[]
  questions: GuideQuestion[]
  ifTheySay: GuideObjection[]
  goal: GuideLine | null
  /** Claude's lines left out because they had no source. Always 0 here. */
  dropped: number
}

export interface GuideInput {
  company: CompanyDetail
  /** The person being called, or null for a cold call to the switchboard. */
  person: { name: string; title: string | null } | null
  /** The caller's first name, or null when nobody is signed in. */
  caller: string | null
  /** Today in Melbourne, as YYYY-MM-DD. */
  today: string
}

/** A lease ending this soon is a reason to call. */
export const LEASE_REASON_MONTHS = 36
/** A lease ending this soon makes a meeting about it the goal. */
const LEASE_MEETING_MONTHS = 24
/** No talk for this long is worth saying. */
const QUIET_MONTHS = 6
const MAX_WHY = 3
const MAX_QUESTIONS = 5
const MAX_OBJECTIONS = 3
const NEWS_CHARS = 160
const YOUR_NAME = '[your name]'
const UPGRADE = /needs an upgrade|mediocre/i
const CONNECTED = /connected|spoke|live/i
const VOICEMAIL = /voicemail|message/i

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = date.slice(0, 10).split('-').map(Number)
  return { year, month, day }
}

/** "Mar 2028". */
export function monthYear(date: string): string {
  const { year, month } = dateParts(date)
  return `${MONTHS[month - 1] ?? ''} ${String(year)}`
}

/** "12 Sep". */
function dayMonth(date: string): string {
  const { month, day } = dateParts(date)
  return `${String(day)} ${MONTHS[month - 1] ?? ''}`
}

/** "12 Sep 2026". */
function fullDay(date: string): string {
  return `${dayMonth(date)} ${String(dateParts(date).year)}`
}

/** The date `months` after `date` (YYYY-MM-DD), on the 1st of that month. */
function monthsAfter(date: string, months: number): string {
  const { year, month } = dateParts(date)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  return `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-01`
}

/** "$40M", "$850k", from HubSpot's amount in dollars. Null when it isn't known. */
export function shortMoney(value: string | number | null | undefined): string | null {
  const amount = Number(value)
  if (value === null || value === undefined || !Number.isFinite(amount) || amount <= 0) return null
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (amount >= 1_000) return `$${String(Math.round(amount / 1_000))}k`
  return `$${String(Math.round(amount))}`
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function cut(text: string, limit: number): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 3).trimEnd()}...`
}

/** The office's name in a sentence: its city ("the Perth lease"), never "Other Office 2". */
function officeName(office: CompanyOffice): string {
  if (/^other office/i.test(office.label)) return office.city ?? 'other'
  return office.label || office.city || 'main'
}

interface Lease {
  office: CompanyOffice
  date: string
  months: number
}

/** The nearest lease end still to come. */
function nearestLease(company: CompanyDetail, today: string): Lease | null {
  let best: Lease | null = null
  for (const office of company.offices) {
    const date = office.lease_end
    if (!date || date < today) continue
    if (best === null || date < best.date) {
      best = { office, date, months: Math.max(0, monthsBetween(today, date)) }
    }
  }
  return best
}

function openDeal(company: CompanyDetail): CompanyDeal | null {
  return company.deals.find((deal) => deal.state === 'open') ?? null
}

function isCustomer(company: CompanyDetail): boolean {
  return (
    company.deal === 'customer' ||
    company.lifecycle_stage?.toLowerCase() === 'customer' ||
    company.deals.some((deal) => deal.state === 'won')
  )
}

/** The newest call with this person, else the newest call with the company. */
function lastCall(company: CompanyDetail, person: GuideInput['person']): CompanyCall | null {
  const calls = company.calls.filter((call) => call.called_at)
  if (person) {
    const theirs = calls.find((call) => call.person === person.name)
    if (theirs) return theirs
  }
  return calls[0] ?? null
}

function growing(company: CompanyDetail): boolean {
  return (
    company.staff !== null &&
    company.linkedin_staff !== null &&
    company.staff > 0 &&
    company.linkedin_staff > company.staff * 1.1
  )
}

function upgradeOffice(company: CompanyDetail): CompanyOffice | null {
  return company.offices.find((office) => office.quality && UPGRADE.test(office.quality)) ?? null
}

function line(text: string, why: string | null, icon: GuideIcon): GuideLine {
  return { text, why, sources: [], icon }
}

function question(
  text: string,
  why: string | null,
  icon: GuideIcon,
  followUps: FollowUp[],
): GuideQuestion {
  return { text, why, sources: [], icon, followUps }
}

const STANDARD = 'A standard question'

/** Everything the rules look at, worked out once. */
interface Known {
  company: CompanyDetail
  person: GuideInput['person']
  me: string
  today: string
  lease: Lease | null
  deal: CompanyDeal | null
  customer: boolean
  call: CompanyCall | null
  callDay: string | null
}

function know(input: GuideInput): Known {
  const call = lastCall(input.company, input.person)
  return {
    company: input.company,
    person: input.person,
    me: input.caller?.trim() ? firstName(input.caller) : YOUR_NAME,
    today: input.today,
    lease: nearestLease(input.company, input.today),
    deal: openDeal(input.company),
    customer: isCustomer(input.company),
    call,
    callDay: call?.called_at ? call.called_at.slice(0, 10) : null,
  }
}

function leaseWhy(lease: Lease): string {
  return `HubSpot: ${officeName(lease.office)} office`
}

/** One sentence that gives the reason for the call, for the opener. */
function hook(known: Known): GuideLine | null {
  const { deal, lease, customer, company } = known
  if (deal) {
    return line(`I wanted to follow up on ${deal.name}.`, 'HubSpot: deal', 'deal')
  }
  if (lease && lease.months <= LEASE_REASON_MONTHS) {
    return line(
      `Your ${officeName(lease.office)} lease ends in ${monthYear(lease.date)}, so I wanted to check in early.`,
      leaseWhy(lease),
      'lease',
    )
  }
  if (customer) {
    const office = company.offices[0]
    const where = office ? `the ${officeName(office)} office` : 'the office'
    return line(
      `I wanted to check in on how ${where} is working for the team.`,
      'A Contour customer',
      'customer',
    )
  }
  return null
}

function opener(known: Known): GuideLine[] {
  const { person, me, call, callDay } = known
  const reason = hook(known)
  if (!person) {
    return [
      line(
        `Hi, it's ${me} from Contour. We design and build offices. Could I speak to whoever looks after your office space?`,
        null,
        'standard',
      ),
      line(
        `When you're put through: ${reason ? reason.text : "I'd like to introduce Contour before your next office move."}`,
        reason?.why ?? null,
        reason?.icon ?? 'standard',
      ),
    ]
  }
  const first = firstName(person.name)
  let hello: GuideLine
  if (
    call &&
    callDay &&
    call.person === person.name &&
    call.outcome &&
    CONNECTED.test(call.outcome)
  ) {
    hello = line(
      `Hi ${first}, it's ${me} from Contour. We spoke on ${dayMonth(callDay)}.`,
      `HubSpot call, ${fullDay(callDay)}`,
      'call',
    )
  } else if (
    call &&
    callDay &&
    call.person === person.name &&
    call.outcome &&
    VOICEMAIL.test(call.outcome)
  ) {
    hello = line(
      `Hi ${first}, it's ${me} from Contour. We left you a message on ${dayMonth(callDay)}.`,
      `HubSpot call, ${fullDay(callDay)}`,
      'call',
    )
  } else {
    hello = line(
      `Hi ${first}, it's ${me} from Contour. We design and build offices.`,
      null,
      'standard',
    )
  }
  return reason ? [hello, reason] : [hello]
}

function whyNow(known: Known): GuideLine[] {
  const { company, lease, deal, today } = known
  const reasons: GuideLine[] = []
  if (lease && lease.months <= LEASE_REASON_MONTHS) {
    reasons.push(
      line(
        `The ${officeName(lease.office)} lease ends in ${monthYear(lease.date)}, in ${String(lease.months)} ${lease.months === 1 ? 'month' : 'months'}.`,
        leaseWhy(lease),
        'lease',
      ),
    )
  }
  if (deal) {
    const money = shortMoney(deal.amount_aud)
    reasons.push(
      line(
        `Open deal: ${deal.name}${deal.stage ? `, at ${deal.stage}` : ''}${money ? `, ${money}` : ''}.`,
        'HubSpot: deal',
        'deal',
      ),
    )
  }
  if (company.lead) {
    const lead = company.lead
    reasons.push(
      line(
        lead.best_sign
          ? sentence(`The ${lead.title} found a sign: ${lead.best_sign}`)
          : `The ${lead.title} rated it ${lead.result_label}.`,
        `${lead.title}, ${fullDay(lead.found_at.slice(0, 10))}`,
        'lead',
      ),
    )
  }
  const note = company.notes[0]
  if (note) {
    reasons.push(
      line(
        sentence(cut(note.text, NEWS_CHARS)),
        `Saved research${note.date ? `, ${fullDay(note.date)}` : ''}`,
        'news',
      ),
    )
  }
  if (growing(company) && company.staff !== null && company.linkedin_staff !== null) {
    reasons.push(
      line(
        `LinkedIn shows ${company.linkedin_staff.toLocaleString('en-AU')} staff in Australia, and HubSpot has ${company.staff.toLocaleString('en-AU')}. They may be growing.`,
        'HubSpot and LinkedIn',
        'staff',
      ),
    )
  }
  const poor = upgradeOffice(company)
  if (poor?.quality) {
    reasons.push(
      line(
        `The ${officeName(poor)} office is rated "${poor.quality}" in HubSpot.`,
        `HubSpot: ${officeName(poor)} office`,
        'office',
      ),
    )
  }
  if (company.last_talk && monthsBetween(company.last_talk, today) >= QUIET_MONTHS) {
    reasons.push(
      line(
        `No talk on record since ${fullDay(company.last_talk)}, ${agoWords(company.last_talk, today)}.`,
        'HubSpot: last contacted',
        'quiet',
      ),
    )
  }
  return reasons.slice(0, MAX_WHY)
}

function questions(known: Known): GuideQuestion[] {
  const { company, person, lease, deal, customer, call, callDay, today } = known
  const out: GuideQuestion[] = []
  if (person && call && callDay && call.person === person.name) {
    out.push(
      question(
        `Last time we spoke was on ${dayMonth(callDay)}. What has changed since then?`,
        `HubSpot call, ${fullDay(callDay)}`,
        'call',
        [
          { answer: 'Something has changed', ask: "What's driving it, and who is involved?" },
          { answer: 'Nothing yet', ask: 'When would be a good time to check in again?' },
        ],
      ),
    )
  }
  if (deal) {
    const when =
      deal.close_date && deal.close_date >= today
        ? ` Is ${monthYear(deal.close_date)} still the plan?`
        : ''
    out.push(
      question(`Where are things at with ${deal.name}?${when}`, 'HubSpot: deal', 'deal', [
        { answer: 'On track', ask: 'What do you need from us before then?' },
        { answer: 'Delayed', ask: "What changed, and what's the new timing?" },
      ]),
    )
  }
  if (lease && lease.months <= LEASE_REASON_MONTHS) {
    out.push(
      question(
        `Your ${officeName(lease.office)} lease ends in ${monthYear(lease.date)}. Are you planning to renew, or to move?`,
        leaseWhy(lease),
        'lease',
        [
          { answer: 'Renew', ask: 'What would make the current space work better for the team?' },
          { answer: 'Move', ask: 'Have you started looking? Who is helping you with it?' },
          { answer: 'Not sure yet', ask: 'When do you need to decide by?' },
        ],
      ),
    )
  } else if (!lease && company.offices.length > 0) {
    const office = company.offices[0]
    if (office) {
      out.push(
        question(
          `When does the lease on your ${officeName(office)} office end?`,
          `HubSpot: ${officeName(office)} office, no lease date`,
          'lease',
          [
            { answer: 'Within 2 years', ask: 'Are you thinking about renewing, or moving?' },
            { answer: 'Not sure', ask: 'Who looks after the lease?' },
          ],
        ),
      )
    }
  } else if (!lease) {
    out.push(
      question(
        'Where is the team based now, and when does that lease end?',
        'No office on record',
        'lease',
        [
          { answer: 'Gives a date', ask: 'Is a move or a refresh on the cards before then?' },
          { answer: 'Not sure', ask: 'Who looks after the lease?' },
        ],
      ),
    )
  }
  if (growing(company) && company.staff !== null && company.linkedin_staff !== null) {
    out.push(
      question(
        `Are you growing? LinkedIn shows ${company.linkedin_staff.toLocaleString('en-AU')} staff in Australia, and HubSpot has ${company.staff.toLocaleString('en-AU')}.`,
        'HubSpot and LinkedIn',
        'staff',
        [
          { answer: 'Yes', ask: 'Is the current office still big enough?' },
          { answer: 'No', ask: 'How is the space working for the team?' },
        ],
      ),
    )
  }
  const poor = upgradeOffice(company)
  if (poor?.quality) {
    out.push(
      question(
        `Your ${officeName(poor)} office is rated "${poor.quality}". Is a refresh on the list for next year?`,
        `HubSpot: ${officeName(poor)} office`,
        'office',
        [
          { answer: 'Yes', ask: 'What would you most like to change?' },
          { answer: 'No', ask: 'What would make it a priority?' },
        ],
      ),
    )
  }
  if (customer) {
    const office = company.offices[0]
    out.push(
      question(
        `How is the ${office ? `${officeName(office)} ` : ''}office working for the team?`,
        'A Contour customer',
        'customer',
        [
          { answer: 'Going well', ask: 'Is anything changing with team size or sites this year?' },
          { answer: 'Some issues', ask: 'What would you change first?' },
        ],
      ),
    )
  }
  out.push(
    person
      ? question('Who else is involved in decisions about the office?', STANDARD, 'people', [
          { answer: 'Gives names', ask: 'Would it help if I spoke with them too?' },
          { answer: 'Just them', ask: 'What would you need to see to move ahead?' },
        ])
      : question('Who looks after the office, and when is the next move?', STANDARD, 'people', [
          { answer: 'Gives a name', ask: "What's the best way to reach them directly?" },
          { answer: 'Not sure', ask: 'Who would know?' },
        ]),
  )
  return out.slice(0, MAX_QUESTIONS)
}

function objections(known: Known): GuideObjection[] {
  const { person, lease, customer, company, today } = known
  if (!person) {
    return [
      {
        theySay: "We're not interested.",
        answer: line(
          'No problem. Who looks after the office, so I can send something they can keep for later?',
          null,
          'standard',
        ),
      },
      {
        theySay: 'Can you just email it?',
        answer: line(
          'Happy to. Who should it go to, so it reaches the person who looks after the office?',
          null,
          'standard',
        ),
      },
    ]
  }
  const out: GuideObjection[] = []
  if (customer) {
    out.push({
      theySay: "We're happy with the office.",
      answer: line(
        'Great to hear. Is anything changing with team size or sites this year?',
        null,
        'standard',
      ),
    })
  } else {
    // Check in again 18 months before the lease ends, but not sooner than 3 months from now.
    const later = lease ? monthsAfter(lease.date, -18) : null
    const soonest = monthsAfter(today, 3)
    const checkIn = later && later > soonest ? later : soonest
    out.push({
      theySay: "We're not ready to think about it yet.",
      answer: lease
        ? line(
            `Understood. With the lease ending in ${monthYear(lease.date)}, could I check in again in ${monthYear(checkIn)}?`,
            leaseWhy(lease),
            'lease',
          )
        : line('Understood. When would be a good time to check in again?', null, 'standard'),
    })
    out.push({
      theySay: 'We already have a builder.',
      answer: line(
        `That's fine. Could I send a few of our ${company.city ? `${company.city} ` : ''}projects, so you have a second option when the time comes?`,
        null,
        'standard',
      ),
    })
  }
  out.push({
    theySay: 'Just send me an email.',
    answer: line(
      `Happy to. So I send the right thing: is it ${lease ? `the ${officeName(lease.office)} lease` : 'more space'} or the fitout itself you're thinking about first?`,
      lease ? leaseWhy(lease) : null,
      lease ? 'lease' : 'standard',
    ),
  })
  return out.slice(0, MAX_OBJECTIONS)
}

function goal(known: Known): GuideLine {
  const { person, deal, customer, lease } = known
  if (!person) {
    return line(
      'Get the name of the person who looks after the office, and a good time to call them.',
      null,
      'people',
    )
  }
  if (deal?.next_step)
    return line(sentence(cut(deal.next_step, NEWS_CHARS)), 'HubSpot: deal, next step', 'deal')
  if (customer)
    return line(
      'Ask for a referral, and a heads-up on any new office.',
      'A Contour customer',
      'customer',
    )
  if (lease && lease.months <= LEASE_MEETING_MONTHS) {
    return line('Book a 30-minute meeting about the lease options.', leaseWhy(lease), 'lease')
  }
  return line('Book a first meeting.', null, 'standard')
}

/** The free call script for one call, from what we know about the company. */
export function buildGuide(input: GuideInput): CallGuide {
  const known = know(input)
  return {
    madeFrom: 'hubspot',
    opener: opener(known),
    whyNow: whyNow(known),
    questions: questions(known),
    ifTheySay: objections(known),
    goal: goal(known),
    dropped: 0,
  }
}

// --- Claude's script, in the same shape ---------------------------------------------------------

/** The icon for one of call prep's lines, from its first source. */
function iconFor(why: string | null, sources: string[]): GuideIcon {
  if (sources.some((id) => id.startsWith('W'))) return 'web'
  const label = why?.toLowerCase() ?? ''
  if (label.includes('call')) return 'call'
  if (label.includes('deal')) return 'deal'
  if (label.includes('office')) return 'lease'
  if (label.includes('lead finder')) return 'lead'
  if (label.includes('research') || label.includes('prep')) return 'news'
  return 'standard'
}

function fromLine(item: ScriptLine, labels: ReadonlyMap<string, string>): GuideLine {
  const why = item.sources.map((id) => labels.get(id)).find(Boolean) ?? null
  return { text: item.text, why, sources: item.sources, icon: iconFor(why, item.sources) }
}

/** Call prep's script (Claude's), shown the same way as the free one. */
export function guideFromPrep(script: PrepScript, labels: ReadonlyMap<string, string>): CallGuide {
  return {
    madeFrom: 'claude',
    opener: script.opener.map((item) => fromLine(item, labels)),
    whyNow: script.why_now.map((item) => fromLine(item, labels)),
    questions: script.questions.map((item) => ({
      ...fromLine(item, labels),
      // A backend from before 9 Nov sends no follow-ups.
      followUps: ((item.follow_ups as FollowUpOut[] | undefined) ?? []).map((follow) => ({
        answer: follow.if_they_say,
        ask: follow.ask,
      })),
    })),
    ifTheySay: script.if_they_say.map((item) => ({
      theySay: item.they_say,
      answer: fromLine(item.answer, labels),
    })),
    goal: script.goal ? fromLine(script.goal, labels) : null,
    dropped: script.dropped,
  }
}

/** The script as plain text, for "Copy script". */
export function guideText(guide: CallGuide, who: string): string {
  const list = (lines: GuideLine[]): string => lines.map((item) => `- ${item.text}`).join('\n')
  const parts = [
    `Call: ${who}`,
    `1. Opener\n${list(guide.opener)}`,
    guide.whyNow.length ? `2. Why now\n${list(guide.whyNow)}` : null,
    `3. Guided questions\n${guide.questions
      .map((item, index) =>
        [
          `${String(index + 1)}) ${item.text}`,
          ...item.followUps.map((follow) => `   If "${follow.answer}": ${follow.ask}`),
        ].join('\n'),
      )
      .join('\n')}`,
    `4. If they say\n${guide.ifTheySay.map((item) => `- "${item.theySay}" ${item.answer.text}`).join('\n')}`,
    guide.goal ? `5. Goal of the call\n- ${guide.goal.text}` : null,
  ]
  return parts.filter(Boolean).join('\n\n')
}
