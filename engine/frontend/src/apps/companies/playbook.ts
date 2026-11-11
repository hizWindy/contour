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
 * The wording follows "The script technique" in PLAN-V14, the same ideas Claude's prompt uses:
 * the opener asks for two minutes, the questions go situation, problem, what the problem costs,
 * what fixing it is worth (SPIN), then who else decides; each pushback answer names the feeling,
 * agrees with what is fair and asks one question; a tone line says warm for a returning client
 * and light for a cold call. A feeling is only ever a question. The wording is TBC with Levi.
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
  /** How to sound: warm for a returning client, light for a cold call. Advice, not said aloud. */
  tone: GuideLine | null
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
/** Saved research older than this says how old it is. */
const OLD_NEWS_DAYS = 90
const MAX_WHY = 3
/** At most 2 situation questions, then problem, cost, worth and who else decides. */
const MAX_SITUATION = 2
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

/** Whole days from `date` to `today`. */
function daysAgo(date: string, today: string): number {
  const from = dateParts(date)
  const to = dateParts(today)
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  )
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
/** The reason to call when no fact gives one. */
const NO_REASON = "I'm calling to see what's ahead for your office over the next year or two."
/** Asking for time first lowers the pressure of the call. */
const TIME_ASK = 'Do you have two minutes, or is there a better time?'
const AFTER_NO = 'After a second no, thank them and let it go.'

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
  /** The last call was with this person. */
  theirCall: boolean
  /** ...and they picked up. */
  spoke: boolean
}

function know(input: GuideInput): Known {
  const call = lastCall(input.company, input.person)
  const callDay = call?.called_at ? call.called_at.slice(0, 10) : null
  const theirCall = Boolean(input.person && call && callDay && call.person === input.person.name)
  return {
    company: input.company,
    person: input.person,
    me: input.caller?.trim() ? firstName(input.caller) : YOUR_NAME,
    today: input.today,
    lease: nearestLease(input.company, input.today),
    deal: openDeal(input.company),
    customer: isCustomer(input.company),
    call,
    callDay,
    theirCall,
    spoke: theirCall && Boolean(call?.outcome && CONNECTED.test(call.outcome)),
  }
}

/** Warm for a returning client (a customer, someone we've spoken to, an open deal), else light. */
function tone(known: Known): GuideLine {
  const { customer, spoke, callDay, deal } = known
  if (customer) {
    return line(
      `Warm. They are a client, so catch up before the questions. ${AFTER_NO}`,
      'A Contour customer',
      'customer',
    )
  }
  if (spoke && callDay) {
    return line(
      `Warm. You have spoken before, so pick up where you left off. ${AFTER_NO}`,
      `HubSpot call, ${fullDay(callDay)}`,
      'call',
    )
  }
  if (deal) {
    return line(
      `Warm. There is a deal in progress, so pick up where it stands. ${AFTER_NO}`,
      'HubSpot: deal',
      'deal',
    )
  }
  return line(
    `Light. A cold call: keep it short and friendly, and listen more than you talk. ${AFTER_NO}`,
    null,
    'standard',
  )
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

/** Who, then why, then ask for two minutes. */
function opener(known: Known): GuideLine[] {
  const { person, me, call, callDay, theirCall, spoke } = known
  const reason = hook(known)
  if (!person) {
    return [
      line(
        `Hi, it's ${me} from Contour. We design and build offices. Could I speak to whoever looks after your office space?`,
        null,
        'standard',
      ),
      line(
        `When you're put through: ${reason ? reason.text : NO_REASON}`,
        reason?.why ?? null,
        reason?.icon ?? 'standard',
      ),
      line(`Then: ${TIME_ASK}`, null, 'standard'),
    ]
  }
  const first = firstName(person.name)
  let hello: GuideLine
  if (spoke && callDay) {
    hello = line(
      `Hi ${first}, it's ${me} from Contour. We spoke on ${dayMonth(callDay)}.`,
      `HubSpot call, ${fullDay(callDay)}`,
      'call',
    )
  } else if (theirCall && callDay && call?.outcome && VOICEMAIL.test(call.outcome)) {
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
  return [hello, reason ?? line(NO_REASON, null, 'standard'), line(TIME_ASK, null, 'standard')]
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
    // Old news says how old it is, so nobody calls it recent.
    const old = note.date && daysAgo(note.date, today) > OLD_NEWS_DAYS
    reasons.push(
      line(
        sentence(cut(note.text, NEWS_CHARS)),
        `Saved research${note.date ? `, ${fullDay(note.date)}` : ''}${old && note.date ? `, ${agoWords(note.date, today)}` : ''}`,
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

/** The fact the problem, cost and worth questions are built on: the strongest one known. */
type Theme = 'deal' | 'lease' | 'office' | 'growth' | 'customer' | 'none'

function theme(known: Known): Theme {
  if (known.deal) return 'deal'
  if (known.lease && known.lease.months <= LEASE_REASON_MONTHS) return 'lease'
  if (upgradeOffice(known.company)) return 'office'
  if (growing(known.company)) return 'growth'
  if (known.customer) return 'customer'
  return 'none'
}

/** Situation questions, in the order they are asked, and the one the theme needs. */
function situation(known: Known, about: Theme): GuideQuestion[] {
  const { company, lease, deal, callDay, theirCall, today } = known
  const spokeQ =
    theirCall && callDay
      ? question(
          `Last time we spoke was on ${dayMonth(callDay)}. What has changed since then?`,
          `HubSpot call, ${fullDay(callDay)}`,
          'call',
          [
            { answer: 'Something has changed', ask: "What's driving it, and who is involved?" },
            { answer: 'Nothing yet', ask: 'When would be a good time to check in again?' },
          ],
        )
      : null
  let dealQ: GuideQuestion | null = null
  if (deal) {
    const when =
      deal.close_date && deal.close_date >= today
        ? ` Is ${monthYear(deal.close_date)} still the plan?`
        : ''
    dealQ = question(`Where are things at with ${deal.name}?${when}`, 'HubSpot: deal', 'deal', [
      { answer: 'On track', ask: 'What do you need from us before then?' },
      { answer: 'Delayed', ask: "What changed, and what's the new timing?" },
    ])
  }
  let leaseQ: GuideQuestion | null = null
  const office = company.offices[0]
  if (lease && lease.months <= LEASE_REASON_MONTHS) {
    leaseQ = question(
      `Your ${officeName(lease.office)} lease ends in ${monthYear(lease.date)}. Are you planning to renew, or to move?`,
      leaseWhy(lease),
      'lease',
      [
        { answer: 'Renew', ask: 'What would make the current space work better for the team?' },
        { answer: 'Move', ask: 'Have you started looking? Who is helping you with it?' },
        { answer: 'Not sure yet', ask: 'When do you need to decide by?' },
      ],
    )
  } else if (!lease && office) {
    leaseQ = question(
      `When does the lease on your ${officeName(office)} office end?`,
      `HubSpot: ${officeName(office)} office, no lease date`,
      'lease',
      [
        { answer: 'Within 2 years', ask: 'Are you thinking about renewing, or moving?' },
        { answer: 'Not sure', ask: 'Who looks after the lease?' },
      ],
    )
  } else if (!lease) {
    leaseQ = question(
      'Where is the team based now, and when does that lease end?',
      'No office on record',
      'lease',
      [
        { answer: 'Gives a date', ask: 'Is a move or a refresh on the cards before then?' },
        { answer: 'Not sure', ask: 'Who looks after the lease?' },
      ],
    )
  }
  const growthQ =
    growing(company) && company.staff !== null && company.linkedin_staff !== null
      ? question(
          `Are you growing? LinkedIn shows ${company.linkedin_staff.toLocaleString('en-AU')} staff in Australia, and HubSpot has ${company.staff.toLocaleString('en-AU')}.`,
          'HubSpot and LinkedIn',
          'staff',
          [
            { answer: 'Yes', ask: 'How many more people do you expect this year?' },
            { answer: 'No', ask: 'Is the team settled where it is?' },
          ],
        )
      : null
  const own =
    about === 'deal' ? dealQ : about === 'lease' ? leaseQ : about === 'growth' ? growthQ : null
  const picked = [spokeQ, dealQ, leaseQ, growthQ]
    .filter((item): item is GuideQuestion => item !== null)
    .slice(0, MAX_SITUATION)
  if (own && !picked.includes(own)) picked.splice(MAX_SITUATION - 1, 1, own)
  return picked
}

const WORTH_FOLLOW_UPS: FollowUp[] = [
  { answer: 'It would matter', ask: 'What would the first step be?' },
  { answer: 'Not much', ask: 'What would make it worth a look?' },
]
const WHAT_ISNT_WORKING: FollowUp[] = [
  { answer: 'Names something', ask: 'How long has it been like that?' },
  { answer: 'It works fine', ask: 'If you could change one thing, what would it be?' },
]
const WHAT_IT_COSTS: FollowUp[] = [
  { answer: 'It gets in the way', ask: 'Has that been hanging over the team?' },
  { answer: 'Not much', ask: 'What would make it a priority?' },
]
const IF_LATE: FollowUp[] = [
  { answer: 'It would be a problem', ask: 'Has that been hanging over the team?' },
  { answer: 'We would manage', ask: 'What would you do instead?' },
]

/** The problem question for an office HubSpot rates poorly. */
function poorOffice(office: CompanyOffice, quality: string): GuideQuestion {
  return question(
    `Your ${officeName(office)} office is rated "${quality}". What isn't working in it today?`,
    `HubSpot: ${officeName(office)} office`,
    'office',
    WHAT_ISNT_WORKING,
  )
}

/** The problem, what it costs them and what fixing it is worth, all from the same fact. */
function spin(known: Known, about: Theme): [GuideQuestion, GuideQuestion, GuideQuestion] {
  const { company, lease, deal } = known
  if (about === 'deal' && deal) {
    const late =
      lease && lease.months <= LEASE_REASON_MONTHS
        ? question(
            `What happens if ${deal.name} isn't finished before the ${officeName(lease.office)} lease ends in ${monthYear(lease.date)}?`,
            leaseWhy(lease),
            'lease',
            IF_LATE,
          )
        : question('What would a delay cost the team?', 'HubSpot: deal', 'deal', IF_LATE)
    return [
      question(
        `Is anything holding up ${deal.name}, or still undecided?`,
        'HubSpot: deal',
        'deal',
        [
          { answer: 'Something is', ask: 'What would help move it along?' },
          { answer: 'All clear', ask: 'What do you need from us next?' },
        ],
      ),
      late,
      question(
        `If ${deal.name} runs to plan, what does that mean for the team?`,
        'HubSpot: deal',
        'deal',
        WORTH_FOLLOW_UPS,
      ),
    ]
  }
  const poor = upgradeOffice(company)
  if (about === 'lease' && lease) {
    const why = leaseWhy(lease)
    return [
      poor?.quality
        ? poorOffice(poor, poor.quality)
        : question(
            `What isn't working as well as it should in the ${officeName(lease.office)} office today?`,
            why,
            'lease',
            WHAT_ISNT_WORKING,
          ),
      question(
        'What happens if the lease ends before the new space is ready?',
        why,
        'lease',
        IF_LATE,
      ),
      question(
        `If the new space were ready well before ${monthYear(lease.date)}, what would that mean for the team?`,
        why,
        'lease',
        WORTH_FOLLOW_UPS,
      ),
    ]
  }
  if (about === 'office' && poor?.quality) {
    const why = `HubSpot: ${officeName(poor)} office`
    return [
      poorOffice(poor, poor.quality),
      question('How does that affect the team day to day?', why, 'office', WHAT_IT_COSTS),
      question(
        'If the office worked the way you want, what would that be worth to the team?',
        why,
        'office',
        WORTH_FOLLOW_UPS,
      ),
    ]
  }
  if (about === 'growth') {
    const why = 'HubSpot and LinkedIn'
    return [
      question('Is the current office still big enough for the team?', why, 'staff', [
        {
          answer: "It's tight",
          ask: 'Where does it pinch most: desks, meeting rooms or something else?',
        },
        { answer: "It's fine", ask: 'How much room is left before it gets tight?' },
      ]),
      question(
        'What happens if the team outgrows the space before there is a plan?',
        why,
        'staff',
        IF_LATE,
      ),
      question(
        'If the space grew with the team, what would that mean for you?',
        why,
        'staff',
        WORTH_FOLLOW_UPS,
      ),
    ]
  }
  if (about === 'customer') {
    const office = company.offices[0]
    const why = 'A Contour customer'
    return [
      question(
        `How is the ${office ? `${officeName(office)} ` : ''}office working for the team?`,
        why,
        'customer',
        [
          { answer: 'Going well', ask: 'Is anything changing with team size or sites this year?' },
          { answer: 'Some issues', ask: 'What would you change first?' },
        ],
      ),
      question(
        "If something isn't working, how does it affect the team day to day?",
        why,
        'customer',
        WHAT_IT_COSTS,
      ),
      question(
        'If that were fixed, what would it be worth to the team?',
        why,
        'customer',
        WORTH_FOLLOW_UPS,
      ),
    ]
  }
  return [
    question(
      "What isn't working as well as it should in the current office?",
      STANDARD,
      'standard',
      WHAT_ISNT_WORKING,
    ),
    question('What does that cost the team, day to day?', STANDARD, 'standard', WHAT_IT_COSTS),
    question(
      'If that were fixed, what would it be worth to the team?',
      STANDARD,
      'standard',
      WORTH_FOLLOW_UPS,
    ),
  ]
}

/** Who else decides: after the worth, while the call is warm. */
function decision(known: Known): GuideQuestion {
  return known.person
    ? question('Who else is involved in decisions about the office?', STANDARD, 'people', [
        { answer: 'Gives names', ask: 'Would it help if I spoke with them too?' },
        { answer: 'Just them', ask: 'What would you need to see to move ahead?' },
      ])
    : question('Who looks after the office, and when is the next move?', STANDARD, 'people', [
        { answer: 'Gives a name', ask: "What's the best way to reach them directly?" },
        { answer: 'Not sure', ask: 'Who would know?' },
      ])
}

/** The questions in a fixed order: situation, problem, cost, worth, then who decides. */
function questions(known: Known): GuideQuestion[] {
  const about = theme(known)
  return [...situation(known, about), ...spin(known, about), decision(known)]
}

/** Pushback in three beats: name the feeling, agree with what is fair, ask one question. */
function beats(feeling: string, fair: string, ask: string): string {
  return `Sounds like ${feeling}. ${fair} ${ask}`
}

function objections(known: Known): GuideObjection[] {
  const { person, lease, customer, company, today } = known
  if (!person) {
    return [
      {
        theySay: "We're not interested.",
        answer: line(
          beats(
            'you get a lot of these calls',
            'Fair enough.',
            'Who looks after the office, so I can send something they can keep for later?',
          ),
          null,
          'standard',
        ),
      },
      {
        theySay: 'Can you just email it?',
        answer: line(
          beats(
            "it's a busy day",
            'Happy to email.',
            'Who should it go to, so it reaches the person who looks after the office?',
          ),
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
        beats(
          "it's working well",
          "That's great to hear.",
          'Is anything changing with team size or sites this year?',
        ),
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
            beats(
              "the timing isn't right yet",
              "That's fair.",
              `With the lease ending in ${monthYear(lease.date)}, could I check in again in ${monthYear(checkIn)}?`,
            ),
            leaseWhy(lease),
            'lease',
          )
        : line(
            beats(
              'the timing is tight',
              "That's fair.",
              'What would need to be true for it to be worth a look?',
            ),
            null,
            'standard',
          ),
    })
    out.push({
      theySay: 'We already have a builder.',
      answer: line(
        beats(
          'you have someone you trust',
          "That's fair, and worth keeping.",
          `Could I send a few of our ${company.city ? `${company.city} ` : ''}projects, so you have a second option when the time comes?`,
        ),
        null,
        'standard',
      ),
    })
  }
  out.push({
    theySay: 'Just send me an email.',
    answer: line(
      beats(
        "now isn't a good time",
        'Fair enough.',
        `So I send the right thing: is it ${lease ? `the ${officeName(lease.office)} lease` : 'more space'} or the fitout itself you're thinking about first?`,
      ),
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
    tone: tone(known),
    opener: opener(known),
    whyNow: whyNow(known),
    questions: questions(known),
    ifTheySay: objections(known),
    goal: goal(known),
    dropped: 0,
  }
}

/** The tone line alone, for Claude's script, whose answer form has none (same rule, same words). */
export function guideTone(input: GuideInput): GuideLine {
  return tone(know(input))
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
    tone: null,
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
    `Call: ${who}${guide.tone ? `\nTone: ${guide.tone.text}` : ''}`,
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
