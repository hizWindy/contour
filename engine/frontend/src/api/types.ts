/**
 * Short names for the types the pages use most. They all come from `schema.d.ts`, which
 * `npm run types` generates from `openapi.json`. Nothing here is written by hand, so a change in
 * the backend contract shows up as a type error here and in the pages.
 *
 * Until PLAN-V16's M1, the types its contract changes come from `v16.ts` instead (marked "V16"
 * below). M1 points each back at `Schemas[...]` and deletes `v16.ts`.
 */
import type { components, operations, paths } from './schema'
import type * as V16 from './v16'

export type { components, operations, paths }
export type Schemas = components['schemas']

// Runs
export type Run = V16.Run // V16
export type RunStatus = Run['status']
export type RunCaps = Schemas['RunCaps']
export type RunCounts = Schemas['RunCounts']
export type RunCreate = Schemas['RunCreate']
export type RunEstimate = V16.RunEstimate // V16
export type RunSourceId = V16.RunSourceId // V16
export type RunPage = V16.RunPage // V16
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
export type LeadRow = V16.LeadRow // V16
export type LeadDetail = V16.LeadDetail // V16
export type LeadPage = V16.LeadPage // V16
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
export type RunOptions = V16.RunOptions // V16
export type CityOption = V16.CityOption // V16
export type CityGroup = V16.CityGroup // V16
export type Tier = V16.Tier // V16
export type Confidence = V16.Confidence // V16
export type Exclusion = V16.Exclusion // V16
// The lead card's new parts (PLAN-V16 contract parts 1 and 3)
export type PropertySource = V16.PropertySource // V16
export type SourceStatus = V16.SourceStatus // V16
export type PropertyRecord = V16.PropertyRecord // V16
export type RecordKind = V16.RecordKind // V16
export type Office = V16.Office // V16
export type ChangeKind = V16.ChangeKind // V16
export type FilterState = V16.FilterState // V16
export type DampenerStrength = V16.DampenerStrength // V16
// Sources for Admin (PLAN-V16 contract part 4)
export type SourceOut = V16.SourceOut // V16
export type SourceList = V16.SourceList // V16

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
export type LeadFinderRound = V16.RoundOut // V16
export type LeadFinderRoundIn = V16.RoundIn // V16
export type RoundCity = V16.RoundCityPlan // V16

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
