/**
 * Short names for the types the pages use most. They all come from `schema.d.ts`, which
 * `npm run types` generates from `openapi.json`. Nothing here is written by hand, so a change in
 * the backend contract shows up as a type error here and in the pages.
 */
import type { components, operations, paths } from './schema'

export type { components, operations, paths }
export type Schemas = components['schemas']

// Runs
export type Run = Schemas['RunOut']
export type RunStatus = Run['status']
export type RunCaps = Schemas['RunCaps']
export type RunCounts = Schemas['RunCounts']
export type RunCreate = Schemas['RunCreate']
export type RunEstimate = Schemas['RunEstimate']
export type RunSourceId = NonNullable<Schemas['LeadFinderRunParams']['sources']>[number]
export type RunPage = Schemas['RunPage']
export type RunSummary = Schemas['RunSummary']
export type EventLog = Schemas['EventLog']

/** The events of a run. `type` tells them apart, and `data` is typed by `type`. */
export type RunEvent = Schemas['RunEvent']
export type RunEventType = RunEvent['type']
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>

// Problems
export type ProblemDetails = Schemas['ProblemDetails']
export type FieldError = Schemas['FieldError']

// Leads
export type LeadRow = Schemas['LeadRow']
export type LeadDetail = Schemas['LeadDetail']
export type LeadPage = Schemas['LeadPage']
export type LeadFacets = Schemas['LeadFacets']
export type LeadPatch = Schemas['LeadPatch']
export type MapPoint = Schemas['MapPoint']
export type MapOut = Schemas['MapOut']
export type LeadResult = LeadRow['result']
export type LeadStatus = LeadRow['status']
export type HubSpotStatus = LeadRow['hubspot_status']
/** Where the company came from: the HubSpot watchlist, found on the web, or typed by a person. */
export type LeadOrigin = LeadRow['origin']

// Lead Finder
export type RunOptions = Schemas['RunOptions']
export type CityOption = Schemas['CityOption']
export type CityGroup = CityOption['group']
export type LeadFinderRules = Schemas['LeadFinderRules']
export type SignStrength = Schemas['Sign']['strength']
export type Tier = NonNullable<LeadRow['tier']>
export type Confidence = NonNullable<LeadRow['confidence']>
export type Exclusion = Schemas['Excluded']
// The lead card's new parts (PLAN-V16 contract parts 1 and 3)
export type PropertySource = Schemas['PropertyRecord']['source']
export type SourceStatus = Schemas['SourceChecks']['property_daily']
export type PropertyRecord = Schemas['PropertyRecord']
export type RecordKind = Schemas['PropertyRecord']['kind']
export type Office = Schemas['Office']
export type ChangeKind = Schemas['WhatChanged']['kind']
export type FilterState = Schemas['FilterResult']['state']
export type DampenerStrength = NonNullable<Schemas['Dampener']['strength']>
// Sources for Admin (PLAN-V16 contract part 4)
export type ToolOut = Schemas['ToolOut']
export type ToolList = Schemas['ToolList']

// Settings, searches, memory, HubSpot, tests
export type SettingsOut = Schemas['SettingsOut']
export type SettingField = Schemas['SettingField']
export type SettingValue = Schemas['SettingValue']
export type SearchPage = Schemas['SearchPage']
export type SearchOut = Schemas['SearchOut']
export type MemoryHit = Schemas['MemoryHitOut']
export type HubSpotSummary = Schemas['HubSpotSummary']
/** The HubSpot connection (GET /hubspot/status). Not the lead's HubSpotStatus above. */
export type HubSpotConnection = Schemas['HubSpotStatus']
export type HubSpotScope = Schemas['ScopeOut']
export type HubSpotProject = Schemas['ProjectReadiness']
export type HubSpotSync = Schemas['SyncOut']
export type HubSpotWrite = Schemas['WriteOut']
export type HubSpotWritePlan = Schemas['WritePlan']
export type HubSpotFieldChange = Schemas['FieldChange']
export type HubSpotStep = Schemas['StepResult']
export type ImportResult = Schemas['ImportResult']
export type WatchlistOut = Schemas['WatchlistOut']
export type TestPage = Schemas['TestPage']
export type TestReport = Schemas['TestReport']

// Schedules
export type Schedule = Schemas['ScheduleOut']
export type ScheduleEstimate = Schemas['ScheduleEstimate']
export type ScheduleEdit = Schemas['ScheduleEdit']
export type RunNow = Schemas['RunNow']
export type LeadFinderRound = Schemas['RoundOut']
export type LeadFinderRoundIn = Schemas['RoundIn']
export type RoundCity = Schemas['RoundCityOut']

// Health (PLAN-V13 T1-2)
export type HealthDetails = Schemas['HealthDetails']
export type SystemCheck = Schemas['SystemCheckOut']
export type HealthState = SystemCheck['state']
export type EndpointTraffic = Schemas['EndpointTrafficOut']
export type ApiTraffic = Schemas['ApiTrafficOut']

// Companies (PLAN-V10)
export type CompanyRow = Schemas['CompanyRow']
export type CompanyPage = Schemas['CompanyPage']
export type CompanyFacets = Schemas['CompanyFacets']
export type CompanyDetail = Schemas['CompanyDetail']
export type CompanyOffice = Schemas['CompanyOffice']
export type CompanyDeal = Schemas['CompanyDeal']
export type CompanyNote = Schemas['CompanyNote']
export type CompanyPerson = Schemas['CompanyPerson']
export type CompanyCall = Schemas['CompanyCall']
export type CompanyLead = Schemas['CompanyLead']
export type CompanySearch = Schemas['CompanySearch']
export type CompanyHit = Schemas['CompanyHit']
export type PersonHit = Schemas['PersonHit']
export type DealState = CompanyRow['deal']
export type PrepFacts = Schemas['PrepFacts']
export type PrepFact = Schemas['PrepFact']
export type PrepSource = Schemas['PrepSource']
export type PrepOut = Schemas['PrepOut']
export type PrepScript = Schemas['PrepScript']
export type ScriptLine = Schemas['ScriptLine']
export type PrepChip = Schemas['PrepChip']
export type PrepAsk = Schemas['PrepAsk']
// Script edits and style notes (PLAN-V14 T1-3).
export type NewsLine = Schemas['NewsLine']
export type StyleUsed = Schemas['StyleUsed']
export type ScriptEditIn = Schemas['ScriptEditIn']
export type ScriptEditOut = Schemas['ScriptEditOut']
export type ScriptStyleOut = Schemas['ScriptStyleOut']
export type StyleNoteOut = Schemas['StyleNoteOut']
export type StyleNoteStatus = StyleNoteOut['status']

/** The query string of an operation, by its operationId. */
export type QueryOf<Name extends keyof operations> = operations[Name]['parameters']['query']

// Call notes, meetings and the pre-read (PLAN-V17). Track 3 typed them by hand until the
// tracks met; the names stay, so the pages didn't change.
export type CallNoteSource = CallNoteOut['source']
export type CallNoteStatus = CallNoteOut['status']
export type CallNoteState = NonNullable<CallNoteQuery['state']>
/** History's "how it went" filter: one of the outcomes, or `none` for a call with none (PLAN-V18). */
export type CallNoteOutcomeFilter = NonNullable<CallNoteQuery['outcome']>
export type TaskKind = Schemas['CallNoteTask']['kind']
export type NoteField = Schemas['NoteFieldOption']
export type CallNoteOptions = Schemas['CallNoteOptions']
/** Which voice to text tool the mic uses (PLAN-V18, the contract part 4). */
export type VoiceToolKind = CallNoteOptions['voice_tool']
export type CallNoteIn = Schemas['CallNoteIn']
export type CallNotePerson = Schemas['PrepPerson']
export type CallNoteChange = Schemas['CallNoteChange']
export type CallNoteTask = Schemas['CallNoteTask']
export type CallNoteStep = Schemas['CallNoteStep']
export type CallNoteOut = Schemas['CallNoteOut']
export type CallNotePage = Schemas['CallNotePage']
export type CallNoteChangeIn = Schemas['CallNoteChangeIn']
export type CallNoteTaskIn = Schemas['CallNoteTaskIn']
export type CallNotePatch = Schemas['CallNotePatch']
export type CallNoteIds = Schemas['CallNoteIds']
export type CallNoteSkipped = Schemas['CallNoteSkipped']
export type CallNotePreview = Schemas['CallNotePreview']
export type CallNoteConfirm = Schemas['CallNoteConfirm']
export type CallNoteResolve = Schemas['CallNoteResolve']
export type CallNoteSummary = Schemas['CallNoteSummary']
export type MyLastNote = Schemas['MyLastNote']
export type MeetingWhere = Schemas['FormMeeting']['where']
export type Meeting = Schemas['Meeting']
export type MeetingGroup = NonNullable<MeetingItem['group']>
export type MeetingFormStatus = MeetingFormOut['status']
export type MeetingFormState = Schemas['MeetingFormState']
export type MeetingItem = Schemas['MeetingItem']
export type MeetingsState = MeetingPage['meetings_state']
export type MeetingWhen = NonNullable<MeetingQuery['when']>
/** Whose meetings a list shows: everyone's (the default), the rep's own, or their team's (PLAN-V18). */
export type MeetingWho = NonNullable<MeetingQuery['who']>
export type MeetingQuery = NonNullable<operations['list_meetings']['parameters']['query']>
export type MeetingPage = Schemas['MeetingPage']
/** A person who owns a meeting in the list's window, for the Owner filter (Improvements 1, #5). */
export type MeetingOwner = Schemas['MeetingOwner']
/** Where "My team" stands for the rep. `none_in_hubspot`: HubSpot has no teams, so it is hidden. */
export type TeamState = MeetingPage['team_state']
/** What a press of Sync on Meetings answers (PLAN-V18 T1-5). */
export type MeetingsSyncOut = Schemas['MeetingsSyncOut']
export type FormMeeting = Schemas['FormMeeting']
export type FormFact = Schemas['FormFact']
export type SummaryBy = FormSummary['by']
export type FormSummary = Schemas['FormSummary']
export type FormSummaries = Schemas['FormSummaries']
export type FormRecipient = Schemas['FormRecipient']
export type TaskSendState = FormRecipient['task']
export type TeamMember = Schemas['TeamMember']
export type HubSpotCopy = Schemas['HubSpotCopy']
export type MeetingFormOut = Schemas['MeetingFormOut']
export type MeetingDetail = Schemas['MeetingDetail']
export type MeetingFormStart = Schemas['MeetingFormStart']
export type FormSummariesPatch = Schemas['FormSummariesPatch']
export type MeetingFormPatch = Schemas['MeetingFormPatch']
export type FormPreviewIn = Schemas['FormPreviewIn']
export type FormPerson = Schemas['FormPerson']
export type FormEmailPreview = Schemas['FormEmailPreview']
export type FormSendIn = Schemas['FormSendIn']
export type MeetingSummary = Schemas['MeetingSummary']
export type MeetingTranscriptIn = Schemas['MeetingTranscriptIn']
export type HubSpotOwnerLink = Schemas['HubSpotOwnerLink']
export type HubSpotOwnerOption = Schemas['HubSpotOwnerChoice']
export type HubSpotOwnerList = Schemas['HubSpotOwnerList']
export type HubSpotOwnerIn = Schemas['HubSpotOwnerIn']
export type CallNoteQuery = NonNullable<operations['list_call_notes']['parameters']['query']>
