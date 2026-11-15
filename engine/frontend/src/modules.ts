/**
 * The projects on the website, in menu order. Each one is a module from its own folder under
 * src/apps/. The router, the sidebar, the command menu and Home all read this list, so adding a
 * project is its folder plus one line here.
 */
import { Briefcase, CalendarDays, LayoutDashboard, Megaphone, Telescope } from 'lucide-react'
import { COMPANIES } from '@/apps/companies/module'
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import type { AppModule, PlannedModule } from '@/shell/nav'

export const MODULES: readonly AppModule[] = [LEAD_FINDER, COMPANIES]

/**
 * The projects still to be developed, in Levi's order: the 30 Oct meeting put calendar scheduling
 * and call notes right after the Lead Finder. Sources: PROJECTS.md and the meeting notes in
 * "minutes of meeting/". Dashboards was added at the end on 5 Nov and is not from those notes.
 * When one is built, it moves to MODULES. On Home, a project with `when` gets its own card and the
 * rest share one "Later" card. Meeting prep left the list on 9 Nov: the Companies page
 * and its call prep replace it (PLAN-V10 B1). Call notes left it on 15 Nov: Log call and the
 * Activity page, under Companies, replace it (PLAN-V17 T3-7).
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
    when: 'Next',
    short: 'Set up meetings and invites in Outlook, like "a meeting with James on Tuesday at 10".',
    needs: 'Needs Outlook admin access (TBC)',
  },
  {
    id: 'deal-review',
    name: 'Deal review',
    icon: Briefcase,
    to: '/deal-review',
    description:
      'Reads every open deal in HubSpot and rates it green, amber or red, with the main flags and a next step. A daily task list shows deals nobody has spoken to for weeks.',
    status: "Third in Levi's list. Needs good HubSpot data first.",
    when: 'Third',
    short: 'Rates every open deal green, amber or red, with the main flags and a next step.',
    needs: 'Needs good HubSpot data first',
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
  {
    id: 'dashboards',
    name: 'Dashboards',
    icon: LayoutDashboard,
    to: '/dashboards',
    description:
      'Different dashboards in one place: dashboards for the company, and dashboards for sales.',
    status: 'Not planned yet. Which dashboards, and which numbers they show, are TBC.',
  },
]
