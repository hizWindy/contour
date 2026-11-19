/**
 * The Assistant's parts around the app load late, in files of their own (PLAN-V22 T2-1; Companies'
 * until then): call notes' (PLAN-V17 T3-7: Call logs' count in the menu, Ctrl+K's entries and the
 * mic check, in `links.tsx`), the pre-read's (T3-11: Ctrl+K's "Pre-read for a meeting", there
 * too), "Speak (V)" in the top bar (PLAN-V22 T3-1, there too), and Home's Assistant card (T2-3,
 * `home-card.tsx`, which took over Home's quick buttons and the "Upcoming meetings" card), with
 * the hooks, words and icons they bring. The menu, Home and Ctrl+K are in the first visit, and
 * these parts show only after a request or two anyway, so their code downloads just before those,
 * and the first visit stays as it was (the same pattern as Results' `lazy-parts.ts`).
 *
 * A part is downloaded only when it is drawn, so never for a person who doesn't see the Assistant.
 * If its file can't be downloaded (an old file gone after a deploy), it shows nothing, as when its
 * switch is off. Each is drawn inside a `Suspense` with no fallback.
 */
import { lazy, type ComponentType } from 'react'
import type { CommandsProps } from '@/shell/nav'

export const loadAssistantLinks = () => import('./links')
export const loadHomeCard = () => import('./home-card')

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
export const AssistantCommands = late<Links, CommandsProps>(
  loadAssistantLinks,
  (links) => links.AssistantCommands,
)
// "Check my mic" (PLAN-V18 T3-4): the account menu's row, and the card the frame draws.
export const MicCheckMenuItem = late(loadAssistantLinks, (links) => links.MicCheckMenuItem)
// The account menu's rows: "Use V to speak" (PLAN-V23 T4-1), then "Check my mic".
export const AssistantAccountItems = late(
  loadAssistantLinks,
  (links) => links.AssistantAccountItems,
)
export const MicCheckHost = late(loadAssistantLinks, (links) => links.MicCheckHost)
// "Speak (V)" in the top bar (PLAN-V22 T3-1, choice 13).
export const SpeakButton = late(loadAssistantLinks, (links) => links.SpeakButton)
// Home's Assistant card (PLAN-V22 T2-3, choice 5).
export const AssistantHomeCard = late(loadHomeCard, (card) => card.AssistantHomeCard)
