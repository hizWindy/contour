/**
 * Companies' parts around the app load late, in files of their own: call notes' (PLAN-V17 T3-7:
 * Call logs' count in the menu, Home's quick buttons, Ctrl+K's entries, in `call-note-links.tsx`),
 * and the pre-read's (T3-11: Ctrl+K's "Pre-read for a meeting", there too, and Home's "Upcoming
 * meetings" card, in `meetings/upcoming-card.tsx`), with the hooks, words and icons they bring.
 * The menu, Home and Ctrl+K are in the first visit, and these parts show only after a request or
 * two anyway, so their code downloads just before those, and the first visit stays as it was (the
 * same pattern as Results' `lazy-parts.ts`).
 *
 * A part is downloaded only when it is drawn, so never for a person who doesn't see Companies. If
 * its file can't be downloaded (an old file gone after a deploy), it shows nothing, as when its
 * switch is off. Each is drawn inside a `Suspense` with no fallback.
 */
import { lazy, type ComponentType } from 'react'
import type { CommandsProps } from '@/shell/nav'

export const loadCallNoteLinks = () => import('./call-note-links')
export const loadUpcomingCard = () => import('./meetings/upcoming-card')

type Links = Awaited<ReturnType<typeof loadCallNoteLinks>>

/** What a part shows when its file can't be downloaded. */
function Nothing(): null {
  return null
}

function late<Parts, P extends object>(
  load: () => Promise<Parts>,
  pick: (parts: Parts) => ComponentType<P>,
) {
  return lazy(async (): Promise<{ default: ComponentType<P> }> => {
    try {
      return { default: pick(await load()) }
    } catch {
      return { default: Nothing }
    }
  })
}

export const ToConfirmCount = late(loadCallNoteLinks, (links) => links.ToConfirmCount)
export const CallNoteButtons = late(loadCallNoteLinks, (links) => links.CallNoteButtons)
export const CompaniesCommands = late<Links, CommandsProps>(
  loadCallNoteLinks,
  (links) => links.CompaniesCommands,
)
export const UpcomingMeetings = late(loadUpcomingCard, (card) => card.UpcomingMeetings)
