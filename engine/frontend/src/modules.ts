/**
 * The projects on the website, in menu order. Each one is a module from its own folder under
 * src/apps/. The router, the sidebar, the command menu and Home all read this list, so adding a
 * project is its folder plus one line here.
 */
import { Briefcase, CalendarDays, ClipboardList, Megaphone, Mic, Telescope } from 'lucide-react'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import type { AppModule, PlannedModule } from '@/shell/nav'

export const MODULES: readonly AppModule[] = [LEAD_FINDER]

/**
 * The projects still to be developed, in Levi's order: the 30 Oct meeting put calendar scheduling
 * and call notes right after the Lead Finder. Sources: PROJECTS.md and the meeting notes in
 * "minutes of meeting/". When one is built, it moves to MODULES.
 */
export const PLANNED: readonly PlannedModule[] = [
  {
    id: 'calendar',
    name: 'Calendar',
    icon: CalendarDays,
    to: '/calendar',
    description:
      'Set up meetings and calendar invites in Outlook from the app, like "a meeting with James on Tuesday at 10".',
    status: 'Next after the Lead Finder (Levi, 30 Oct). Needs Outlook admin access (TBC).',
  },
  {
    id: 'call-notes',
    name: 'Call notes',
    icon: Mic,
    to: '/call-notes',
    description:
      'Dictate notes after a call or meeting. It logs them in HubSpot, creates the follow-up task and updates details like a lease expiry, so nobody has to type and click.',
    status: 'Next after the Lead Finder (Levi, 30 Oct). Needs HubSpot write access (TBC).',
  },
  {
    id: 'meeting-prep',
    name: 'Meeting prep',
    icon: ClipboardList,
    to: '/meeting-prep',
    description:
      "A one-page brief before each meeting or call: who they are, the history in HubSpot, recent news, the last contact and the questions to ask. It's saved in HubSpot and sent to the team.",
    status: 'On hold (Levi, 23 Oct).',
  },
  {
    id: 'deal-review',
    name: 'Deal review',
    icon: Briefcase,
    to: '/deal-review',
    description:
      'Reads every open deal in HubSpot and rates it green, amber or red, with the main flags and a next step. A daily task list shows deals nobody has spoken to for weeks.',
    status: "Third in Levi's list. Needs good HubSpot data first.",
  },
  {
    id: 'research',
    name: 'Research',
    icon: Telescope,
    to: '/research',
    description:
      'Customer connections, prospect ranking and market research, on the same research engine as the Lead Finder.',
    status: 'Later. Not described in detail yet (TBC).',
  },
  {
    id: 'company-hub',
    name: 'Company hub',
    icon: Megaphone,
    to: '/company-hub',
    description: 'Company announcements, and an onboarding guide for new starters.',
    status: 'An idea from Levi (30 Oct). Not planned yet.',
  },
]
