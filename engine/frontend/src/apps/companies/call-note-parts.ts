/**
 * Call notes around the app (PLAN-V17 T3-7) load late, in a file of their own: Activity's count in
 * the menu, Home's quick buttons and the Ctrl+K entries (`call-note-links.tsx`), with the hooks,
 * words and icons they bring. The menu, Home and Ctrl+K are in the first visit, and these parts
 * show only after two requests anyway (the switches, then the counts), so their code downloads
 * just before those, and the first visit stays as it was (the same pattern as Results'
 * `lazy-parts.ts`).
 *
 * A part is downloaded only when it is drawn, so never for a person who doesn't see Companies. If
 * its file can't be downloaded (an old file gone after a deploy), it shows nothing, as when call
 * notes are off. Each is drawn inside a `Suspense` with no fallback.
 */
import { lazy, type ComponentType } from 'react'
import type { CommandsProps } from '@/shell/nav'

export const loadCallNoteLinks = () => import('./call-note-links')

type Links = Awaited<ReturnType<typeof loadCallNoteLinks>>

/** What a part shows when its file can't be downloaded. */
function Nothing(): null {
  return null
}

function late<P extends object>(pick: (links: Links) => ComponentType<P>) {
  return lazy(async (): Promise<{ default: ComponentType<P> }> => {
    try {
      return { default: pick(await loadCallNoteLinks()) }
    } catch {
      return { default: Nothing }
    }
  })
}

export const ToConfirmCount = late((links) => links.ToConfirmCount)
export const CallNoteButtons = late((links) => links.CallNoteButtons)
export const CallNoteCommands = late<CommandsProps>((links) => links.CallNoteCommands)
