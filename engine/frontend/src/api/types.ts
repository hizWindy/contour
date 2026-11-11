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

/** The query string of an operation, by its operationId. */
export type QueryOf<Name extends keyof operations> = operations[Name]['parameters']['query']
