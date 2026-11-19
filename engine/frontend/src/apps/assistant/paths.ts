/**
 * The Assistant's addresses (PLAN-V22 T2-1, choice 2). One place for them: the menu, Home, Ctrl+K
 * and each page's own `params.ts` read these, so a link never points at an old address.
 *
 * The code of Meetings and Call logs stays in `apps/companies/` (choice 3: it shares parts with
 * call prep and the company record), and the API keeps its `/api/v1/companies/...` paths. Only
 * the pages' addresses moved. The old ones still work (`old-addresses.ts`).
 *
 * This file is in the first visit (the menu reads it), so it holds the addresses and nothing else.
 */

/** Today, the Assistant's first page. */
export const TODAY_PATH = '/assistant'

/** Meetings: the client meetings and their pre-reads. A pre-read is `MEETINGS_PATH/{form_id}`. */
export const MEETINGS_PATH = '/assistant/meetings'

/**
 * The router's state on the way to Meetings that opens its "New pre-read" with the company filled
 * in (PLAN-V23 T4-2): the review card's "New pre-read", for a company with no meeting ahead. A
 * type only, so nothing more is in the first visit. Null: the dialog opens with no company.
 */
export interface NewPreReadState {
  newPreRead: { key: string; name: string } | null
}

/** Call logs: the calls a rep logged, to confirm, send to HubSpot and look back at. */
export const CALL_LOGS_PATH = '/assistant/call-logs'
