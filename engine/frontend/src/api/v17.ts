/**
 * PLAN-V17's contract, written by hand until the tracks meet at M1.
 *
 * Track 2 (the Companies backend) builds these routes and Track 1 (HubSpot) the Admin parts, while
 * Track 3 builds the website against them with `mockApi`. At M1, `npm run types` makes them from
 * the real backend: each type here then becomes its plain `Schemas[...]` in types.ts, this file
 * goes, and the casts marked "until M1" go with it. A name that differs from the backend's shows
 * up then as a type error, which M1 fixes. Part 3 (meetings, Stage B) is joined the same way at
 * M5.
 *
 * Where the contract left a name open, the choice here is written in the plan's Track 3 Log and
 * sent to the track that builds it.
 */
import type { components } from './schema'

type Schemas = components['schemas']

// --- Part 2: call notes (Track 2 builds, Track 3 reads). All under /api/v1/companies. ---------

/** How the note came in. A transcript is a past meeting's (Stage B). */
export type CallNoteSource = 'mic' | 'typed' | 'transcript'

/**
 * sorting: the sorter is working on it. to_confirm: waiting in the batch. sending: being written
 * to HubSpot. logged: every step landed. partial: some steps landed. failed: nothing landed.
 * uncertain: HubSpot may or may not have one step, and a person decides.
 */
export type CallNoteStatus =
  'sorting' | 'to_confirm' | 'sending' | 'logged' | 'partial' | 'failed' | 'uncertain'

/** The tabs on Activity, and the `state` filter of GET /call-notes. */
export type CallNoteState = 'to_confirm' | 'logged' | 'needs_look'

export type TaskKind = 'call' | 'email' | 'todo'

/** A field a call may change (choice 3): each office's lease end, last move and staff count. */
export interface NoteField {
  /** Like lease_end. */
  id: string
  /** Like "Lease end". */
  label: string
  kind: 'date' | 'number'
}

/** GET /call-notes/options */
export interface CallNoteOptions {
  /** call_notes_enabled: Log call and Activity show. */
  enabled: boolean
  /** call_notes_ai_enabled: Claude sorts a note. Off: the rep sorts it by hand. */
  ai_enabled: boolean
  /** HubSpot write access and its scopes are there, so the batch can be sent. */
  sending_ready: boolean
  /** One plain sentence when sending isn't ready, like "Waiting for HubSpot write access." */
  waiting_for: string | null
  /** HubSpot's call outcome names, in order (Connected, No answer, Left voicemail and the rest). */
  outcomes: string[]
  fields: NoteField[]
  /** When the timer turns Ochre (notes_soft_seconds). */
  soft_seconds: number
  /** The longest note (notes_max_chars). */
  max_chars: number
}

/** POST /call-notes. An Idempotency-Key header makes a double press one note. */
export interface CallNoteIn {
  company_key: string
  contact_id: string | null
  prep_id: string | null
  text: string
  source: CallNoteSource
  /** When the call was (ISO date and time). */
  called_at: string
  outcome: string | null
}

export interface CallNotePerson {
  id: string
  name: string
  title: string | null
}

/** One field change: what HubSpot has, and what the rep's call says. */
export interface CallNoteChange {
  id: string
  /** The field's id from the options, like lease_end. */
  field: string
  label: string
  /** The office it is for, like "Perth", or none for the company. */
  office: string | null
  /** What HubSpot has now (from the last preview, else our copy). */
  current: string | null
  value: string
  /** HubSpot's value moved since the rep saw it: the change is held and shown again. */
  current_changed: boolean
}

export interface CallNoteTask {
  id: string
  subject: string
  /** The day it is due (ISO date). */
  due: string
  /** The words it came from, like "next Tuesday", or none. */
  due_words: string | null
  kind: TaskKind
  /** Who it is for, by name. None: the rep. */
  owner: string | null
}

/** One step of the write to HubSpot, in plain words. */
export interface CallNoteStep {
  /** call, fields, task:1, task:2 and so on, then note. */
  step: string
  status: 'pending' | 'done' | 'failed' | 'uncertain' | 'skipped'
  /** What happened, like "Logged the call." or "HubSpot didn't answer." */
  words: string
}

export interface CallNoteOut {
  id: string
  company_key: string
  company_name: string
  person: CallNotePerson | null
  text: string
  source: CallNoteSource
  called_at: string
  status: CallNoteStatus
  sorted_by: 'ai' | 'person'
  /** One sentence when the sorter was unsure, or none. Unsure notes sort first. */
  unsure: string | null
  call: { summary: string; outcome: string | null }
  changes: CallNoteChange[]
  tasks: CallNoteTask[]
  /** Left out of this batch (X). It stays to confirm. */
  left_out: boolean
  steps: CallNoteStep[]
  hubspot_url: string | null
  /** Who logged it, by name. */
  made_by: string | null
  created_at: string
  confirmed_at: string | null
}

/** GET /call-notes: a page, with `limit` and `offset`. Filters: state, company_key, mine. */
export interface CallNotePage {
  total: number
  items: CallNoteOut[]
}

/** A change as the rep edits it: no id is a new one. */
export interface CallNoteChangeIn {
  id?: string | null
  field: string
  office: string | null
  value: string
}

/** A task as the rep edits it: no id is a new one. */
export interface CallNoteTaskIn {
  id?: string | null
  subject: string
  /** ISO date. */
  due: string
  due_words?: string | null
  kind: TaskKind
}

/** PATCH /call-notes/{note_id}: only what is sent changes. Changes and tasks replace the lists. */
export interface CallNotePatch {
  summary?: string
  outcome?: string | null
  contact_id?: string | null
  changes?: CallNoteChangeIn[]
  tasks?: CallNoteTaskIn[]
  left_out?: boolean
}

/** POST /call-notes/preview and /call-notes/confirm */
export interface CallNoteIds {
  ids: string[]
}

/** POST /call-notes/preview: each note with HubSpot's values now. */
export interface CallNotePreview {
  items: CallNoteOut[]
  sending_ready: boolean
  waiting_for: string | null
  totals: { calls: number; tasks: number; changes: number }
}

/** POST /call-notes/confirm: answers at once; the notes go one after another. */
export interface CallNoteConfirm {
  /** How many notes started sending. */
  sending: number
  /** True when a batch was already sending: nothing new started. */
  already_sending: boolean
}

/** POST /call-notes/{note_id}/resolve: whether an uncertain step is in HubSpot. */
export interface CallNoteResolve {
  step: string
  landed: boolean
}

/** GET /call-notes/summary: the counts for Home and the menu. */
export interface CallNoteSummary {
  to_confirm: number
  needs_look: number
  logged_today: number
}

/** PrepFacts.my_last_note: the rep's newest note on this company not in HubSpot yet. */
export interface MyLastNote {
  id: string
  summary: string
  called_at: string
  outcome: string | null
}

export type PrepFactsV17 = Schemas['PrepFacts'] & { my_last_note?: MyLastNote | null }

// --- Part 3: meetings and the pre-meeting form (Track 2 builds, Track 3 reads). -------------
// All under /api/v1/companies, behind the Companies tick. While `meeting_forms_enabled` is off,
// every route but the options answers 409 `meeting_forms_off`.

/**
 * Where a meeting is (Track 1 reads it from HubSpot): `online` is a video call, `in_person` is at
 * an address, and `unknown` is anything else, a phone call included.
 */
export type MeetingWhere = 'online' | 'in_person' | 'unknown'

/**
 * A meeting (contract part 1, `core/hubspot/meetings.py`), from our copy of HubSpot. A meeting a
 * rep typed in with New pre-read isn't in HubSpot: it has no `id` and no `hubspot_url`.
 */
export interface Meeting {
  /** HubSpot's id, or none for a meeting typed in. */
  id: string | null
  /** The HubSpot company it is with, or none (a typed meeting with a Lead Finder lead). */
  company_id: string | null
  contact_ids: string[]
  /** The HubSpot owner it belongs to, or none. */
  owner_id: string | null
  title: string
  starts_at: string
  /** None for a typed meeting. */
  ends_at: string | null
  where: MeetingWhere
  location: string | null
  /**
   * HubSpot's outcome, as it names it: SCHEDULED, COMPLETED, RESCHEDULED, NO_SHOW or CANCELED, or
   * none. The page only reads CANCELED.
   */
  outcome: string | null
  /** The meeting's notes, as plain text, or none. */
  notes: string | null
  hubspot_url: string | null
  /**
   * The Contour people on it, by their HubSpot owner ids (Track 1's model). Track 2 decides
   * whether it reaches a row. The page doesn't read it yet.
   */
  attendee_owner_ids?: string[]
  /** HubSpot links it to more than one company, and the first is used (Track 1's model). */
  more_companies?: boolean
}

/** drafting: the summaries are being written. draft: ready to check. sent: emailed. failed. */
export type MeetingFormStatus = 'drafting' | 'draft' | 'sent' | 'failed'

/** A meeting's form, in short, on a row of Meetings. */
export interface MeetingFormRef {
  id: string
  status: MeetingFormStatus
}

/** Someone we meet: a name and a job title. Never an email address or a phone number. */
export interface MeetingPerson {
  name: string
  title: string | null
}

/** One row of Meetings: the meeting, its company, who we meet, and its form. */
export interface MeetingItem extends Meeting {
  company_key: string
  company_name: string
  /** It is the signed-in rep's own meeting. */
  mine: boolean
  /** Whose meeting it is, by name, or none. */
  owner: string | null
  people: MeetingPerson[]
  /** Its form, or none yet ("Needs pre-read"). */
  form: MeetingFormRef | null
  /** For a past meeting: what was said is logged (T3-11's Log meeting). */
  notes_logged: boolean
}

/**
 * Whether meetings can be read from HubSpot (Track 1's `meetings.status`), which is not the
 * pre-meeting forms switch (`enabled`). waiting: a permission or the first read is missing. off:
 * HubSpot isn't connected (no key, and nothing read yet). The page shows both the same way: one
 * quiet line in the server's words, the rows it has, and New pre-read, which works in all three.
 */
export type MeetingsStatus = 'ready' | 'waiting' | 'off'

/** GET /companies/meetings/options: the switch, and whether meetings come from HubSpot yet. */
export interface MeetingOptions {
  /** meeting_forms_enabled: Meetings and the pre-read work. Off: the page says so. */
  enabled: boolean
  status: MeetingsStatus
  /**
   * One plain sentence while `status` isn't ready, like "HubSpot isn't connected, so meetings
   * can't be read from it."
   */
  waiting_for: string | null
}

export type MeetingWhen = 'upcoming' | 'past'

/**
 * GET /companies/meetings. `q` finds a meeting by words in the company's name, the title and the
 * date ("vitera 26 nov"), in plain code on the server.
 */
export interface MeetingQuery {
  when?: MeetingWhen
  /** True: the rep's own meetings. False: the team's. */
  mine?: boolean
  q?: string
  limit?: number
  offset?: number
}

/** GET /companies/meetings: a page of meetings, and whether they come from HubSpot yet. */
export interface MeetingPage {
  total: number
  items: MeetingItem[]
  status: MeetingsStatus
  waiting_for: string | null
}

/** One fact on the form, from HubSpot or our copy, never from AI. */
export interface MeetingFormFact {
  label: string
  value: string
  /** Where it came from, in words. */
  source: string
}

/** One of the form's three summaries. */
export interface MeetingFormSummary {
  text: string
  /** ai: "Written by AI". person: the rep edited it, and a redraft leaves it alone. */
  by: 'ai' | 'person'
  /** The facts it rests on. */
  sources: string[]
}

export interface MeetingFormSummaries {
  what_they_do: MeetingFormSummary
  what_we_know: MeetingFormSummary
  talks_so_far: MeetingFormSummary
}

/** Where the copy of a sent pre-read stands in HubSpot (a note on the company, choice 9). */
export interface MeetingFormHubSpotCopy {
  state: 'saved' | 'waiting' | 'off' | 'failed'
  /** One plain sentence. */
  words: string
}

/** The pre-meeting form (contract part 3). Its page is /companies/pre-reads/{form_id} (T3-10). */
export interface MeetingFormOut {
  id: string
  /** The meeting: from HubSpot, or the one typed in (no id). */
  meeting: Meeting
  status: MeetingFormStatus
  facts: MeetingFormFact[]
  /** None while it drafts, or when the draft failed. */
  summaries: MeetingFormSummaries | null
  /** The two blanks for the rep. Never filled by AI. */
  next_step: string | null
  going: string | null
  sent_to: string[]
  sent_at: string | null
  /** Who sent it, by name. */
  sent_by: string | null
  hubspot_copy: MeetingFormHubSpotCopy
  /** What the draft cost, as a decimal string. */
  cost_usd: string
  /** Why the draft failed, in plain words, or none. */
  error: string | null
}

/** GET /companies/meetings/{meeting_id}: the meeting, and its form if it has one. */
export interface MeetingDetail {
  meeting: MeetingItem
  form: MeetingFormOut | null
}

/**
 * POST /companies/meetings/forms: starts a draft, for a meeting in HubSpot (`meeting_id`), or for
 * a new one typed in. The same HubSpot meeting twice gives back its form. A typed one carries an
 * `Idempotency-Key`, so a retry is one form.
 */
export type MeetingFormStart =
  | { meeting_id: string }
  | { company_key: string; title: string; starts_at: string; where: MeetingWhere }

/** GET /companies/meetings/summary: the counts for Home (T3-11). */
export interface MeetingSummary {
  need_pre_read: number
  draft_ready: number
}

// --- Part 4: Admin (Track 1 builds, Track 3 reads) ------------------------------------------

/** How a person's HubSpot owner was found: by their email, set by a person, or not found. */
export interface HubSpotOwnerLink {
  id: string
  name: string
  matched_by: 'email' | 'person' | null
}

/** GET /hubspot/owners (Admin): ids and names only, never an email. */
export interface HubSpotOwnerOption {
  id: string
  name: string
}

export interface HubSpotOwnerList {
  owners: HubSpotOwnerOption[]
}

/** PUT /people/{user_id}/hubspot-owner (Admin): sets it, or clears it with null. */
export interface HubSpotOwnerIn {
  owner_id: string | null
}

// --- The routes, in openapi-typescript's shape, for `apiV17` (v17-client.ts) -----------------

interface Json<T> {
  headers: Record<string, unknown>
  content: { 'application/json': T }
}

type Problem = Json<Schemas['ProblemDetails']>

interface NoParameters {
  query?: never
  header?: never
  path?: never
  cookie?: never
}

interface Errors {
  401: Problem
  403: Problem
  404: Problem
  409: Problem
  422: Problem
}

/*
  The same shape openapi-typescript writes: a route with no path parameters has `path?: never`,
  and one with no body has `requestBody?: never`. (A required `path: never` made every call to such
  a route fail to type-check: found in T3-5.)
*/
type PathPart<Path> = [Path] extends [never] ? { path?: never } : { path: Path }

type BodyPart<Body> = [Body] extends [never]
  ? { requestBody?: never }
  : { requestBody: { content: { 'application/json': Body } } }

type Operation<Out, Body = never, Path = never, Query = never, Header = never> = {
  parameters: { query?: Query; header?: Header; cookie?: never } & PathPart<Path>
  responses: { 200: Json<Out> } & Errors
} & BodyPart<Body>

interface NoContent<Path> {
  parameters: { query?: never; header?: never; path: Path; cookie?: never }
  requestBody?: never
  responses: { 204: { headers: Record<string, unknown>; content?: never } } & Errors
}

/**
 * The path keys, as the backend names them (Track 2: `note_id` and `meeting_id`, Track 1:
 * `user_id`).
 */
type NoteId = { note_id: string }
type MeetingId = { meeting_id: string }
type UserId = { user_id: string }

/** Lower case, as the backend's generated contract writes headers (see `create_run`). */
type IdempotencyHeader = { 'idempotency-key'?: string | null }

export interface CallNoteQuery {
  state?: CallNoteState
  company_key?: string
  mine?: boolean
  limit?: number
  offset?: number
}

export interface V17Paths {
  '/companies/call-notes/options': { parameters: NoParameters; get: Operation<CallNoteOptions> }
  '/companies/call-notes': {
    parameters: NoParameters
    get: Operation<CallNotePage, never, never, CallNoteQuery>
    post: Operation<CallNoteOut, CallNoteIn, never, never, IdempotencyHeader>
  }
  '/companies/call-notes/summary': { parameters: NoParameters; get: Operation<CallNoteSummary> }
  '/companies/call-notes/preview': {
    parameters: NoParameters
    post: Operation<CallNotePreview, CallNoteIds>
  }
  '/companies/call-notes/confirm': {
    parameters: NoParameters
    post: Operation<CallNoteConfirm, CallNoteIds>
  }
  '/companies/call-notes/{note_id}': {
    parameters: NoParameters
    get: Operation<CallNoteOut, never, NoteId>
    patch: Operation<CallNoteOut, CallNotePatch, NoteId>
    delete: NoContent<NoteId>
  }
  '/companies/call-notes/{note_id}/retry': {
    parameters: NoParameters
    post: Operation<CallNoteOut, never, NoteId>
  }
  '/companies/call-notes/{note_id}/resolve': {
    parameters: NoParameters
    post: Operation<CallNoteOut, CallNoteResolve, NoteId>
  }
  // The fixed paths before `{meeting_id}`, so "options" is never read as a meeting's id.
  '/companies/meetings/options': { parameters: NoParameters; get: Operation<MeetingOptions> }
  '/companies/meetings/summary': { parameters: NoParameters; get: Operation<MeetingSummary> }
  '/companies/meetings': {
    parameters: NoParameters
    get: Operation<MeetingPage, never, never, MeetingQuery>
  }
  '/companies/meetings/forms': {
    parameters: NoParameters
    post: Operation<MeetingFormOut, MeetingFormStart, never, never, IdempotencyHeader>
  }
  '/companies/meetings/{meeting_id}': {
    parameters: NoParameters
    get: Operation<MeetingDetail, never, MeetingId>
  }
  '/hubspot/owners': { parameters: NoParameters; get: Operation<HubSpotOwnerList> }
  '/people/{user_id}/hubspot-owner': {
    parameters: NoParameters
    put: Operation<
      Schemas['PersonOut'] & { hubspot_owner?: HubSpotOwnerLink | null },
      HubSpotOwnerIn,
      UserId
    >
  }
}
