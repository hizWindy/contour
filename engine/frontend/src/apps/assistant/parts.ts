/**
 * The Assistant's parts around the app load late, in files of their own (PLAN-V22 T2-1; Companies'
 * until then): call notes' (PLAN-V17 T3-7: Call logs' count in the menu, Home's quick buttons,
 * Ctrl+K's entries and the mic check, in `links.tsx`), and the pre-read's (T3-11: Ctrl+K's
 * "Pre-read for a meeting", there too, and Home's "Upcoming meetings" card, in
 * `apps/companies/meetings/upcoming-card.tsx`), with the hooks, words and icons they bring. The
 * menu, Home and Ctrl+K are in the first visit, and these parts show only after a request or two
 * anyway, so their code downloads just before those, and the first visit stays as it was (the same
 * pattern as Results' `lazy-parts.ts`).
 *
 * A part is downloaded only when it is drawn, so never for a person who doesn't see the Assistant.
 * If its file can't be downloaded (an old file gone after a deploy), it shows nothing, as when its
 * switch is off. Each is drawn inside a `Suspense` with no fallback.
 */
import { lazy, type ComponentType } from 'react'
import type { CommandsProps } from '@/shell/nav'

export const loadAssistantLinks = () => import('./links')
export const loadUpcomingCard = () => import('@/apps/companies/meetings/upcoming-card')

type Links = Awaited<ReturnType<typeof loadAssistantLinks>>

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

export const ToConfirmCount = late(loadAssistantLinks, (links) => links.ToConfirmCount)
export const CallNoteButtons = late(loadAssistantLinks, (links) => links.CallNoteButtons)
export const AssistantCommands = late<Links, CommandsProps>(
  loadAssistantLinks,
  (links) => links.AssistantCommands,
)
export const UpcomingMeetings = late(loadUpcomingCard, (card) => card.UpcomingMeetings)
// "Check my mic" (PLAN-V18 T3-4): the account menu's row, and the card the frame draws.
export const MicCheckMenuItem = late(loadAssistantLinks, (links) => links.MicCheckMenuItem)
export const MicCheckHost = late(loadAssistantLinks, (links) => links.MicCheckHost)
// "Speak (V)" in the top bar (PLAN-V22 T3-1, choice 13).
export const SpeakButton = late(loadAssistantLinks, (links) => links.SpeakButton)
