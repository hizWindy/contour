/**
 * The Assistant as a module of the website (PLAN-V22 T2-1, from Levi's 18 Nov meeting and
 * Al-khair's answers of 19 Nov): the rep's daily work in one tab. Its pages are Today
 * (`/assistant`), Meetings (`/assistant/meetings`, a pre-read at `/assistant/meetings/{form_id}`)
 * and Call logs (`/assistant/call-logs`). The router, the sidebar, the command menu and Home read
 * it from src/modules.ts, where it comes after Companies and before the Lead Finder (choice 1).
 *
 * - **Where the code lives:** Today here, and later the voice. Meetings and Call logs keep their
 *   code in `apps/companies/` (choice 3: they share parts with call prep and the company record),
 *   and the API keeps its `/api/v1/companies/...` paths. This file holds what sat in the Companies
 *   module until PLAN-V22: their menu entries and addresses, their late prefetches, the Ctrl+K
 *   entries, the account menu's row and the frame's part (`links.tsx`, through `parts.ts`).
 * - **Who sees it:** anyone with the Call logs or the Meetings tick (choice 4). Today needs either,
 *   Meetings its own tick and Call logs its own. The ticks keep their names (`companies.*`), so the
 *   backend's project is still `companies`. Call logs alone gives the Assistant with Today and Call
 *   logs, and no Companies. Companies alone gives no Assistant.
 * - **The switches:** Meetings and Call logs stay in the menu while call notes or pre-meeting forms
 *   are off (each page says so), so the menu never changes shape once it has loaded. Ctrl+K's
 *   entries follow the switches (`links.tsx`).
 * - **The old addresses** under `/companies/...` send you on with their query (`old-addresses.ts`).
 *   Ctrl+K still finds the pages by their old words: "activity", "relationships" (the menu group
 *   Meetings and Call logs sat in), "call logs" and "meetings".
 * - **The first visit:** this file, the addresses, the old addresses' route and the V key's small
 *   listener (`voice/key.tsx`, PLAN-V22 T3-1) are in it. The pages, their prefetches, the parts
 *   around the app and the voice bar itself load late.
 */
import { CalendarCheck, Headset, ListTodo, PhoneLog } from 'lucide-react'
import type { PrefetchArgs, RouteHandle } from '@/shell/crumbs'
import type { AppModule } from '@/shell/nav'
import { page } from '@/shell/page-route'
import { AssistantFrame } from './frame'
import { MovedAddress } from './old-route'
import {
  AssistantAccountItems,
  AssistantCommands,
  AssistantHomeCard,
  SpeakButton,
  ToConfirmCount,
} from './parts'
import { CALL_LOGS_PATH, MEETINGS_PATH, TODAY_PATH } from './paths'
import { ASSISTANT_KEYWORDS, ASSISTANT_NAME, TODAY, TODAY_PURPOSE } from './words'

type Prefetch = (args: PrefetchArgs) => void

/**
 * A page's prefetch whose query options load with it, in a small file of its own: this module is
 * in the first visit, and the call notes and meetings hooks are not (PLAN-V17 T3-5's rule).
 */
function late(load: () => Promise<Prefetch>): Prefetch {
  return (args) => {
    void load()
      .then((start) => {
        start(args)
      })
      .catch(() => undefined)
  }
}

const prefetchMeetings = late(
  async () => (await import('@/apps/companies/meetings/prefetch')).prefetchMeetings,
)
const prefetchPreRead = late(
  async () => (await import('@/apps/companies/meetings/prefetch')).prefetchPreRead,
)
const prefetchCallLogs = late(
  async () => (await import('@/apps/companies/call-logs/prefetch')).prefetchCallLogs,
)

export const ASSISTANT: AppModule = {
  id: 'assistant',
  // The ticks are still Companies' (choice 4), so the backend's project is too.
  app: 'companies',
  name: ASSISTANT_NAME,
  // A headset: the rep's own kit for calls and, from Part 3, the voice (TBC at Al-khair's look).
  icon: Headset,
  // Its pages have carried Heath since PLAN-V17. A colour of its own would be a new rule (TBC).
  tone: 'companies',
  // Its pages' first reads are cheap, so while someone is on one, the code and first reads of the
  // others are fetched quietly (Improvements 1, #10): a switch between them finds both.
  warm: true,
  description:
    'Your work for the day: tasks and meetings, the pre-read for each client meeting, and the calls you logged.',
  // Today's counts and "Press V to speak" (PLAN-V22 T2-3, choice 5). It comes late, after the other
  // cards, where "Upcoming meetings" was, and its code loads late too.
  homeCards: [{ id: 'assistant', component: AssistantHomeCard, late: true }],
  pages: [
    {
      to: TODAY_PATH,
      label: TODAY,
      icon: ListTodo,
      features: ['companies.call_logs', 'companies.meetings'],
      keywords: ['tasks', 'to do', 'daily', 'deals', ...ASSISTANT_KEYWORDS],
      purpose: TODAY_PURPOSE,
      // Its address holds the other two: on Meetings or Call logs, Today isn't the page you are on.
      notActiveOn: [MEETINGS_PATH, CALL_LOGS_PATH],
    },
    {
      to: MEETINGS_PATH,
      label: 'Meetings',
      icon: CalendarCheck,
      features: ['companies.meetings'],
      keywords: [
        'pre-read',
        'pre-meeting form',
        'client meeting',
        'teams',
        'in person',
        ...ASSISTANT_KEYWORDS,
      ],
      purpose: 'Draft the pre-read for each client meeting, then send it to the team.',
    },
    {
      to: CALL_LOGS_PATH,
      label: 'Call logs',
      icon: PhoneLog,
      features: ['companies.call_logs'],
      // "activity" is its old name (PLAN-V18 T3-2), so old habits still find it.
      keywords: [
        'activity',
        'call notes',
        'log a call',
        'confirm',
        'history',
        'send',
        'hubspot',
        ...ASSISTANT_KEYWORDS,
      ],
      purpose: 'Check the calls you logged, send them to HubSpot, and look back at old ones.',
      count: ToConfirmCount,
    },
  ],
  commands: AssistantCommands,
  // "Use V to speak" (PLAN-V23 T4-1) and "Check my mic" (PLAN-V18 T3-4): rows in the account
  // menu. The mic check's card is drawn by the frame.
  accountItems: AssistantAccountItems,
  // The mic check's card, and the V key with its voice bar (PLAN-V22 T3-1), on every page.
  frame: AssistantFrame,
  // "Speak (V)" in the top bar (choice 13): it opens the voice bar, as V does.
  topBar: SpeakButton,
  routes: [
    {
      path: TODAY_PATH.slice(1),
      // The tab's name, so Meetings reads "Assistant > Meetings", and the tab title the page's own.
      handle: { crumb: ASSISTANT_NAME } satisfies RouteHandle,
      children: [
        {
          index: true,
          handle: { crumb: TODAY } satisfies RouteHandle,
          ...page(() => import('./today')),
        },
        {
          path: 'meetings',
          handle: { crumb: 'Meetings' } satisfies RouteHandle,
          children: [
            {
              index: true,
              handle: { prefetch: prefetchMeetings } satisfies RouteHandle,
              ...page(() => import('@/apps/companies/meetings')),
            },
            {
              // A pre-read's own page (PLAN-V17 T3-10), where the morning email links.
              path: ':formId',
              handle: { crumb: 'Pre-read', prefetch: prefetchPreRead } satisfies RouteHandle,
              ...page(() => import('@/apps/companies/meetings/pre-read')),
            },
          ],
        },
        {
          path: 'call-logs',
          handle: { crumb: 'Call logs', prefetch: prefetchCallLogs } satisfies RouteHandle,
          ...page(() => import('@/apps/companies/call-logs')),
        },
      ],
    },
    // The old addresses (under Companies until PLAN-V22), sent on with their query. Each is more
    // exact than a company's own address (`/companies/:key`), so none is ever read as a company.
    { path: 'companies/meetings', element: <MovedAddress /> },
    { path: 'companies/meetings/:formId', element: <MovedAddress /> },
    { path: 'companies/call-logs', element: <MovedAddress /> },
    { path: 'companies/activity', element: <MovedAddress /> },
  ],
}
