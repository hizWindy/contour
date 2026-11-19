/**
 * Made-up data for the review card's tests (PLAN-V22 T3-3 to T3-5): Sample Logistics Pty Ltd, Jo
 * Sample and their team. Only tests import it; the app never does.
 */
import type {
  AssistantCommand,
  AssistantCompanyAdded,
  AssistantCompanyPreview,
  CallNoteChange,
  CallNoteOptions,
  CallNoteOut,
  CallNotePreview,
  CallNoteTask,
  CompanyHit,
  HubSpotWrite,
  TeamEmail,
  TeamMember,
} from '@/api/types'

/**
 * A fake clock for the card's own waits (all `setTimeout`) and the date: `vi.useFakeTimers(CLOCK)`.
 * jsdom draws its animation frames on `setInterval`, so faking that too would leave the motion
 * library waiting for a frame that never comes once the test ends, and every dialog after it would
 * never close.
 */
export const CLOCK: {
  shouldAdvanceTime: true
  toFake: ('setTimeout' | 'clearTimeout' | 'Date')[]
} = { shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] }

export const API = {
  options: '/api/v1/companies/call-notes/options',
  summary: '/api/v1/companies/call-notes/summary',
  command: '/api/v1/companies/assistant/command',
  taskPreview: '/api/v1/companies/assistant/tasks/preview',
  tasks: '/api/v1/companies/assistant/tasks',
  emailPreview: '/api/v1/companies/assistant/email/preview',
  email: '/api/v1/companies/assistant/email',
  notes: '/api/v1/companies/call-notes',
  notePreview: '/api/v1/companies/call-notes/preview',
  confirm: '/api/v1/companies/call-notes/confirm',
  team: '/api/v1/companies/team',
  search: '/api/v1/companies/search',
  forms: '/api/v1/companies/meetings/forms',
  // PLAN-V23 Part 1: adding a company from the card, and the names the mic learns.
  companies: '/api/v1/companies/assistant/companies',
  companyPreview: '/api/v1/companies/assistant/companies/preview',
  learned: '/api/v1/companies/assistant/learned',
}

export const NOTE_ID = '7d0c5b8e-0000-4000-8000-000000000001'

export function notePath(id: string = NOTE_ID): string {
  return `${API.notes}/${id}`
}

export const SAMPLE: CompanyHit = {
  key: '201',
  name: 'Sample Logistics Pty Ltd',
  city: 'Perth',
  industry: 'Logistics',
  source: 'hubspot',
}

export const OTHER_SAMPLE: CompanyHit = {
  key: '202',
  name: 'Sample Freight Pty Ltd',
  city: 'Melbourne',
  industry: 'Freight',
  source: 'hubspot',
}

/** A company only HubSpot had, until the command read it into our copy (PLAN-V23 T1-3). */
export const NORTHWIND: CompanyHit = {
  key: '301',
  name: 'Northwind Pty Ltd',
  city: 'Perth',
  industry: 'Freight',
  source: 'hubspot',
}

/** What adding a company would do (PLAN-V23 T1-4): nothing like it, and adding is on. */
export function companyPreview(
  change: Partial<AssistantCompanyPreview> = {},
): AssistantCompanyPreview {
  return {
    name: 'North Wind',
    city: null,
    similar: [],
    exists: null,
    can_write: true,
    waiting_for: null,
    sentence: null,
    ...change,
  }
}

/** The company the card added to HubSpot. */
export function companyAdded(name = 'North Wind', key = '401'): AssistantCompanyAdded {
  return {
    company_key: key,
    company: { key, name, city: null, industry: null, source: 'hubspot' },
    hubspot_url: null,
  }
}

export const JO = { id: 'c-1', name: 'Jo Sample', title: 'Office manager' }
export const JAMES = { id: 'c-2', name: 'James Sample', title: 'Director' }
export const JAMES_TOO = { id: 'c-3', name: 'James Example', title: 'Facilities lead' }

export const SAM: TeamMember = {
  owner_id: 'o-2',
  name: 'Sam Sample',
  has_account: true,
  is_me: false,
}
export const SAM_TOO: TeamMember = {
  owner_id: 'o-3',
  name: 'Sam Example',
  has_account: true,
  is_me: false,
}

export function options(change: Partial<CallNoteOptions> = {}): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Busy', 'Connected', 'Left live message', 'Left voicemail', 'No answer'],
    fields: [
      { id: 'lease_end', label: 'Lease end', kind: 'date' },
      { id: 'staff', label: 'Staff', kind: 'number' },
    ],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: 'browser_service',
    ...change,
  }
}

export function command(change: Partial<AssistantCommand>): AssistantCommand {
  return {
    action: 'unknown',
    read_back: '',
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

/** "Add a task to send Sample Logistics the quote on Friday". */
export function taskCommand(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return command({
    action: 'task',
    read_back: 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.',
    company: { found: SAMPLE, choices: [], from_page: false, heard: 'Sample Logistics' },
    task: {
      subject: 'Send Sample Logistics the quote',
      due: '2099-11-27',
      due_words: 'Friday',
      kind: 'email',
      owner: null,
      owner_id: null,
    },
    ...change,
  })
}

/** "Log a call with Jo from Sample Logistics, follow up Friday". */
export function callCommand(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return command({
    action: 'log_call',
    read_back: 'Log a call with Jo Sample at Sample Logistics. Follow-up task on Fri 27 Nov.',
    company: { found: SAMPLE, choices: [], from_page: false, heard: 'Sample Logistics' },
    person: { found: JO, choices: [], heard: 'Jo' },
    note_text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
    ...change,
  })
}

/** "Email Sam that the floor plan is ready". */
export function emailCommand(change: Partial<AssistantCommand> = {}): AssistantCommand {
  return command({
    action: 'email',
    read_back: 'Email Sam Sample: The Sample Logistics floor plan.',
    email: {
      to: [{ heard: 'Sam', found: SAM, choices: [], address: null, problem: null }],
      subject: 'The Sample Logistics floor plan',
      body: 'The floor plan is ready. <b>Have a look</b> before Friday.',
    },
    ...change,
  })
}

export const LEASE: CallNoteChange = {
  id: 'c1',
  field: 'lease_end',
  label: 'Lease end',
  office: 'Perth',
  current: '2026-06-30',
  current_changed: false,
  in_hubspot: false,
  value: '2027-06-30',
}

export const FOLLOW_UP: CallNoteTask = {
  id: 't1',
  subject: 'Call Jo about the lease',
  due: '2099-11-27',
  due_words: 'Friday',
  kind: 'call',
  owner: null,
  in_hubspot: false,
}

export function note(change: Partial<CallNoteOut> = {}): CallNoteOut {
  return {
    id: NOTE_ID,
    call: {
      in_hubspot: false,
      outcome: 'Connected',
      summary: 'Jo says the lease ends in June 2027.',
    },
    called_at: '2026-11-19T01:00:00Z',
    changes: [LEASE],
    company_key: SAMPLE.key,
    company_name: SAMPLE.name,
    confirmed_at: null,
    created_at: '2026-11-19T01:00:00Z',
    hubspot_url: null,
    left_out: false,
    made_by: null,
    person: JO,
    sorted_by: 'ai',
    source: 'mic',
    status: 'to_confirm',
    steps: [],
    tasks: [FOLLOW_UP],
    text: 'Spoke to Jo, the lease ends June 2027. Follow up Friday.',
    unsure: null,
    ...change,
  }
}

export function notePreview(
  item: CallNoteOut = note(),
  change: Partial<CallNotePreview> = {},
): CallNotePreview {
  return {
    items: [item],
    sending_ready: true,
    waiting_for: null,
    skipped: [],
    totals: { calls: 1, changes: item.changes.length, tasks: item.tasks.length },
    ...change,
  }
}

export function write(change: Partial<HubSpotWrite> = {}): HubSpotWrite {
  return {
    app: 'companies',
    applied_at: null,
    can_write: true,
    created_at: '2026-11-19T01:00:00Z',
    error: null,
    finished_at: null,
    hubspot_company_id: SAMPLE.key,
    hubspot_url: null,
    id: '7d0c5b8e-0000-4000-8000-000000000002',
    plan: {
      action: 'create',
      company_id: SAMPLE.key,
      company_name: SAMPLE.name,
      company_url: null,
      domain: null,
      fields: [],
      kind: 'task',
      list_id: null,
      list_name: null,
      tasks: ['Email: Send Sample Logistics the quote, due Fri 27 Nov, for you'],
      warnings: [],
    },
    status: 'previewed',
    steps: [],
    subject: 'Send Sample Logistics the quote',
    waiting_for: null,
    ...change,
  }
}

export function teamEmail(change: Partial<TeamEmail> = {}): TeamEmail {
  return {
    can_send: true,
    company: null,
    html: '<p>The floor plan is ready.</p>',
    people: [{ address: 'sam@contour.example', name: 'Sam Sample', owner_id: SAM.owner_id }],
    reply_to_me: true,
    sends_left: 29,
    sent_at: null,
    subject: 'The Sample Logistics floor plan',
    text: 'The floor plan is ready.\n\nSent by Jo Sample from Contour HQ',
    waiting_for: null,
    ...change,
  }
}
