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

/**
 * A note the preview or the confirm won't send, with why in plain words (T3-11), like "A change on
 * this note isn't one a call may change. Remove it, then send the note again." It is in neither
 * `items` nor the totals.
 */
export interface CallNoteSkipped {
  id: string
  why: string
}

/** POST /call-notes/preview: each note with HubSpot's values now. */
export interface CallNotePreview {
  items: CallNoteOut[]
  sending_ready: boolean
  waiting_for: string | null
  /** A logged meeting's notes count as one call. */
  totals: { calls: number; tasks: number; changes: number }
  /** The notes it won't send, with why. Optional in the contract. */
  skipped?: CallNoteSkipped[]
}

/** POST /call-notes/confirm: answers at once; the notes go one after another. */
export interface CallNoteConfirm {
  /** How many notes started sending. */
  sending: number
  /** True when a batch was already sending: nothing new started. */
  already_sending: boolean
  /** The batch being sent. Optional in the contract. */
  batch_id?: string | null
  /** The notes that started sending, in order. Optional in the contract. */
  notes?: CallNoteOut[]
  /** The notes left out, with why: they stay to confirm. Optional in the contract. */
  skipped?: CallNoteSkipped[]
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
// As Track 2 built them (T2-10 to T2-14, `aaba2ca`): every name, optional or nullable field, path
// key and status code here follows the contract generated from those routes, so M5 swaps each
// type for its `Schemas[...]` with no change to the pages. All under /api/v1/companies, behind
// the Companies tick. There is no options route: while pre-meeting forms are switched off, every
// meetings route answers 409 `meeting_forms_off`, and the pages read the switch from that.

/**
 * Where a meeting is: `online` is a video call (Teams, Meet or Zoom), `in_person` is at an
 * address, and `unknown` is anything else, a phone call included.
 */
export type MeetingWhere = 'online' | 'in_person' | 'unknown'

/**
 * A client meeting as HubSpot has it, from our copy (Track 1's `core/hubspot/meetings.py`). A
 * meeting typed in with New pre-read isn't in HubSpot: its `id` is empty and it has no link.
 */
export interface Meeting {
  /** HubSpot's id. Empty for a meeting typed in. */
  id: string
  /**
   * The company it is with: its key on the Companies page. A HubSpot company's key is its HubSpot
   * id; a meeting typed in carries its company's key here, which may be a Lead Finder lead's
   * (`lead:<id>`).
   */
  company_id?: string | null
  contact_ids?: string[]
  /** The HubSpot owner it belongs to. */
  owner_id?: string | null
  title: string
  starts_at: string
  ends_at?: string | null
  where: MeetingWhere
  location?: string | null
  /** HubSpot's outcome, like scheduled, completed or canceled. The pages read only cancelled. */
  outcome?: string | null
  /** The meeting's notes, as plain text. */
  notes?: string | null
  hubspot_url?: string | null
}

/** An upcoming meeting's day, by the Melbourne date (to Sunday for this_week). The server says. */
export type MeetingGroup = 'today' | 'tomorrow' | 'this_week' | 'later'

/** drafting: being written. draft: ready to check. sent: emailed. failed: the draft failed. */
export type MeetingFormStatus = 'drafting' | 'draft' | 'sent' | 'failed'

/** A meeting's pre-read, in short, on a list. */
export interface MeetingFormState {
  id: string
  status: MeetingFormStatus
}

/** One client meeting on a list: the meeting as HubSpot has it, and where its pre-read is. */
export interface MeetingItem {
  meeting: Meeting
  /** The company it is linked to, from our copy. */
  company_name: string
  /** An upcoming meeting's day. None for a past one. */
  group: MeetingGroup | null
  /** Its pre-read, or none yet ("Needs pre-read"). */
  form: MeetingFormState | null
  /** A call note is linked to it (a past meeting's "Log meeting", T3-11). */
  notes_logged: boolean
  /** A meeting typed in for New pre-read: not in HubSpot, `meeting.id` empty, `form` its pre-read. */
  typed: boolean
  /**
   * Whose meeting it is: its owner, as our copy of HubSpot's owners names them. Null for a typed
   * one (always the rep's own) or an owner we don't know. Optional in the contract; the server
   * always sends it (Track 2, `3431528`).
   */
  owner_name?: string | null
}

/**
 * Whether HubSpot's meetings are read: ready, waiting (a permission or the first read is
 * missing) or off (HubSpot isn't connected). Not the pre-meeting forms switch.
 */
export type MeetingsState = 'ready' | 'waiting' | 'off'

export type MeetingWhen = 'upcoming' | 'past'

/**
 * GET /companies/meetings. `mine` is true by default; false is the team's, the rep's own first.
 * `q`: each word must start a word of the company's name, the title or the date in words
 * ("sample 26 nov", "thu", "26/11"), in plain code on the server.
 */
export interface MeetingQuery {
  when?: MeetingWhen
  mine?: boolean
  q?: string | null
  limit?: number
  offset?: number
}

/** GET /companies/meetings: a page of meetings, and whether HubSpot's meetings are read. */
export interface MeetingPage {
  items: MeetingItem[]
  /** How many match, on every page. */
  total: number
  meetings_state: MeetingsState
  /**
   * One plain sentence when the list can't show what was asked: HubSpot's meetings aren't read
   * yet, or the rep's own can't be picked out (their account has no HubSpot owner yet).
   */
  sentence: string | null
}

/**
 * The meeting a pre-read is for, as it was when the form was made: from HubSpot, or typed in.
 * It has no HubSpot link: GET /companies/meetings/{meeting_id} has it.
 */
export interface FormMeeting {
  /** HubSpot's meeting, or none for a meeting typed in. */
  meeting_id: string | null
  /** The company's key on the Companies page (a HubSpot id, or `lead:<id>`). */
  company_key: string
  company_name: string
  title: string
  starts_at: string
  ends_at: string | null
  where: MeetingWhere
}

/** A fact on the pre-read, with no AI: like When, Where, Who we meet, Staff, Lease end. */
export interface FormFact {
  label: string
  value: string
  /** Where it comes from, in words, like "HubSpot meeting". */
  source: string
}

/** ai: written by AI. person: the rep wrote or changed it, and a redraft leaves it alone. */
export type SummaryBy = 'ai' | 'person'

/** One of the pre-read's three summaries. */
export interface FormSummary {
  /** Empty until it is written. */
  text: string
  by: SummaryBy
  /** The facts it rests on, as call prep's sources. */
  sources: Schemas['PrepSource'][]
}

export interface FormSummaries {
  what_they_do: FormSummary
  /** What we know about the project. */
  what_we_know: FormSummary
  talks_so_far: FormSummary
}

/** Someone a sent pre-read went to: a Contour address, with their name when they have an account. */
export interface FormRecipient {
  email: string
  name: string | null
}

/** Where the copy of a sent pre-read stands in HubSpot (a note on the company, choice 9). */
export interface HubSpotCopy {
  /** saved; waiting (writing to HubSpot isn't on: the email still went); off; or failed. */
  state: 'saved' | 'waiting' | 'off' | 'failed'
  /** One plain sentence, unless it is saved. */
  sentence: string | null
}

/**
 * A pre-read (contract part 3): the meeting, the facts, the three summaries, the rep's two blanks,
 * and who it went to. Its page is /companies/meetings/{form_id} (T3-10), where Track 2's morning
 * email links.
 */
export interface MeetingFormOut {
  id: string
  meeting: FormMeeting
  status: MeetingFormStatus
  /** Empty until the draft has read them, a moment after it starts. */
  facts: FormFact[]
  summaries: FormSummaries
  /** The ideal next step: the rep's, never the AI's. */
  next_step: string | null
  /** Who is going: the rep's, never the AI's. */
  going: string | null
  sent_to: FormRecipient[]
  sent_at: string | null
  /** Who sent it, by name. */
  sent_by: string | null
  /** None until it is sent. */
  hubspot_copy: HubSpotCopy | null
  /**
   * What the pre-read has cost, as a decimal string. Track 2 adds each draft's cost to it, so
   * after a redraft it is the drafts' total, not the last one's (a question for Track 2).
   */
  cost_usd: string
  /** Why the draft failed, in plain words. */
  error: string | null
}

/** GET /companies/meetings/{meeting_id}: a HubSpot meeting, its company, and its pre-read. */
export interface MeetingDetail {
  meeting: Meeting
  company_name: string
  form: MeetingFormOut | null
}

/**
 * POST /companies/meetings/forms: for a HubSpot meeting (`meeting_id`), or for one typed in
 * (`company_key`, `title`, `starts_at`, and `ends_at` when known). It answers 201 with the form
 * still drafting, or 200 with a HubSpot meeting's own form when it has one. `where` has a default
 * on the server (`unknown`), which makes it a field to send: a HubSpot meeting's own place is used
 * whatever is sent.
 */
export interface MeetingFormStart {
  meeting_id?: string | null
  company_key?: string | null
  title?: string | null
  /** With its time zone. */
  starts_at?: string | null
  ends_at?: string | null
  where: MeetingWhere
}

/** The new text of each summary the rep changed. Null or empty clears it. */
export interface FormSummariesPatch {
  what_they_do?: string | null
  what_we_know?: string | null
  talks_so_far?: string | null
}

/**
 * PATCH /companies/meetings/forms/{form_id}: only the parts sent change. A summary sent here is
 * the rep's own from then on (`by: person`), and keeps its sources. A sent pre-read that changes is
 * a draft again, so sending it again emails the new words.
 */
export interface MeetingFormPatch {
  summaries?: FormSummariesPatch | null
  next_step?: string | null
  going?: string | null
}

/**
 * POST .../preview (T3-11): the addresses the rep added, each checked against Contour's own
 * domains. Empty: only the people on the meeting. At most 20, each at most 254 characters.
 */
export interface FormPreviewIn {
  to?: string[]
}

/** Someone the pre-read would go to (T3-11). */
export interface FormPerson {
  email: string
  /** Their name, when they have an account here. */
  name: string | null
  /** Like "on the meeting", "typed this meeting in" or "added by you". */
  why: string
  /** Ticked to get it. The server ticks an address it refuses too: only `allowed` ones can be. */
  ticked: boolean
  /** False for an address that isn't Contour's: it can't get it. */
  allowed: boolean
}

/**
 * The email as it would arrive (T3-11): a subject, the plain text, HTML with every value escaped,
 * and the people. The page shows the plain text only, never the HTML.
 */
export interface FormEmailPreview {
  subject: string
  text: string
  html: string
  people: FormPerson[]
  /**
   * One sentence saying Send also adds this pre-read to the meeting's internal notes in HubSpot,
   * or null when Send won't touch the meeting. Until M5: Track 2 adds it then (Track 1's security
   * review), so it is optional here.
   */
  meeting_note?: string | null
}

/**
 * POST .../send (T3-11): Contour addresses only, 1 to 20, each at most 254 characters. One that
 * isn't refuses the whole send (422 `outside_address`, naming it). Sent already and unchanged:
 * nobody is emailed again, and a copy in HubSpot that waits or failed is tried again.
 */
export interface FormSendIn {
  to: string[]
}

/** GET /companies/meetings/summary: the counts for Home (T3-11). */
export interface MeetingSummary {
  need_pre_read: number
  draft_ready: number
}

/**
 * CompanyDetail gains `meetings` (T3-11): its next three, soonest first, then its last three,
 * newest first. A past one has no group. Empty while meetings are off or not read yet.
 */
export type CompanyDetailV17 = Schemas['CompanyDetail'] & { meetings?: MeetingItem[] }

/**
 * POST /companies/meetings/{meeting_id}/transcript (T3-11, "Log meeting"): a past HubSpot
 * meeting's transcript, pasted, or the text of a .txt or .vtt file the website read (never the
 * file itself). The server cleans a .vtt (`file_name`, or text that starts "WEBVTT") of its times,
 * then takes up to 60,000 characters (`transcript_max_chars`, TBC; the contract doesn't say it).
 * `text` itself may hold up to 200,000, for a .vtt before its times are taken out.
 */
export interface MeetingTranscriptIn {
  text: string
  /** The file it came from, if any, at most 255 characters. */
  file_name?: string | null
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

/** `Ok` is the route's success status, or several (Start a pre-read answers 200 or 201). */
type Operation<
  Out,
  Body = never,
  Path = never,
  Query = never,
  Header = never,
  Ok extends number = 200,
> = {
  parameters: { query?: Query; header?: Header; cookie?: never } & PathPart<Path>
  responses: { [Status in Ok]: Json<Out> } & Errors
} & BodyPart<Body>

interface NoContent<Path> {
  parameters: { query?: never; header?: never; path: Path; cookie?: never }
  requestBody?: never
  responses: { 204: { headers: Record<string, unknown>; content?: never } } & Errors
}

/**
 * The path keys, as the backend names them (Track 2: `note_id`, `meeting_id` and `form_id`,
 * Track 1: `user_id`).
 */
type NoteId = { note_id: string }
type MeetingId = { meeting_id: string }
type FormId = { form_id: string }
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
  '/companies/meetings': {
    parameters: NoParameters
    get: Operation<MeetingPage, never, never, MeetingQuery>
  }
  '/companies/meetings/summary': { parameters: NoParameters; get: Operation<MeetingSummary> }
  '/companies/meetings/forms': {
    parameters: NoParameters
    post: Operation<MeetingFormOut, MeetingFormStart, never, never, never, 200 | 201>
  }
  '/companies/meetings/forms/{form_id}': {
    parameters: NoParameters
    get: Operation<MeetingFormOut, never, FormId>
    patch: Operation<MeetingFormOut, MeetingFormPatch, FormId>
  }
  '/companies/meetings/forms/{form_id}/redraft': {
    parameters: NoParameters
    post: Operation<MeetingFormOut, never, FormId, never, never, 202>
  }
  '/companies/meetings/forms/{form_id}/preview': {
    parameters: NoParameters
    post: Operation<FormEmailPreview, FormPreviewIn, FormId>
  }
  '/companies/meetings/forms/{form_id}/send': {
    parameters: NoParameters
    post: Operation<MeetingFormOut, FormSendIn, FormId>
  }
  '/companies/meetings/{meeting_id}': {
    parameters: NoParameters
    get: Operation<MeetingDetail, never, MeetingId>
  }
  '/companies/meetings/{meeting_id}/transcript': {
    parameters: NoParameters
    post: Operation<
      CallNoteOut,
      MeetingTranscriptIn,
      MeetingId,
      never,
      IdempotencyHeader,
      200 | 201
    >
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
