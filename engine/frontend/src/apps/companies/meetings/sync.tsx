/**
 * Meetings' Sync (PLAN-V18 T2-3): read HubSpot's meetings now, with a button at the toolbar's
 * right end and a quiet line under the toolbar that says when they were last read.
 *
 * - **A press answers at once:** the refresh icon turns once (`SpinOnce`, one turn a press, never
 *   a loop) and the button reads "Checking HubSpot". The server answers at once too
 *   (`useSyncMeetings`): `started`, `running` (a read was going already: "Already checking
 *   HubSpot."), or `fresh` (one finished under a minute ago, so HubSpot isn't asked: "Up to date.
 *   Checked a moment ago."). While a read runs the list asks again every 2 seconds, and stops once
 *   the server says it is done.
 * - **Done:** "Up to date" with a tick that draws once (`TickIn`), for 4 seconds, then "Sync"
 *   again. The line then says the new time, "Checked 2:14 pm". It always shows once the page knows
 *   the time, and keeps its height before that, so nothing under it jumps.
 * - **Problems, in plain words:** a read that failed or waits for a permission shows the server's
 *   own sentence in the line (`sync_problem`, "HubSpot didn't answer, so this list is from 9:02
 *   am. Try Sync again in a minute."), with an Ochre mark, never colour alone. A press that didn't
 *   reach the server says why and what to do. The list on screen stays as it was.
 * - **The button keeps its width:** each of its words is there unseen, so the widest sets it, and
 *   a new word fades in where the old one was. A read that someone else started (the 6:00 am
 *   sync) shows the same way.
 *
 * With reduced motion the icon stays still, the tick is simply there, and only the words change.
 */
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { SpinOnce, TickIn } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { MeetingsSync, SyncLineWords, SyncLook } from './use-sync'
import { CHECKING_HUBSPOT, SYNC, SYNC_NOTE, UP_TO_DATE } from './words'

const WORDS: Readonly<Record<SyncLook, string>> = {
  idle: SYNC,
  checking: CHECKING_HUBSPOT,
  done: UP_TO_DATE,
}

/**
 * The outline button at the toolbar's right end, with the icon that turns once a press. What it
 * does is its description, for the pointer (a tooltip) and for a screen reader.
 */
export function SyncButton({ sync, className }: { sync: MeetingsSync; className?: string }) {
  const noteId = useId()
  const icon =
    sync.look === 'done' ? (
      <TickIn className="text-pass-ink" />
    ) : (
      <SpinOnce turns={sync.turns}>
        <RefreshCw aria-hidden="true" className="size-4" />
      </SpinOnce>
    )
  return (
    <div data-slot="meetings-sync" className={cn('flex', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            data-look={sync.look}
            disabled={sync.disabled}
            aria-describedby={noteId}
            className="touch:h-11 max-sm:flex-1"
            onClick={sync.press}
          >
            {icon}
            <span className="grid">
              {/* Every word, unseen, so the button keeps the width of the widest. */}
              {Object.values(WORDS).map((word) => (
                <span key={word} aria-hidden="true" className="invisible col-start-1 row-start-1">
                  {word}
                </span>
              ))}
              {/* A new word fades in where the old one was (150ms), and never waits on the old. */}
              <span
                key={sync.look}
                className="col-start-1 row-start-1 animate-in text-left duration-150 fade-in-0"
              >
                {WORDS[sync.look]}
              </span>
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{SYNC_NOTE}</TooltipContent>
      </Tooltip>
      {/* Beside the button, not in it: inside, it would be read as part of the button's name. */}
      <span id={noteId} className="sr-only">
        {SYNC_NOTE}
      </span>
    </div>
  )
}

/**
 * The quiet line under the toolbar: when HubSpot's meetings were last read, what the last press
 * answered, or why a read didn't go (an Ochre mark and the words). It keeps its height while
 * empty, so the list under it never moves when the time arrives.
 */
export function SyncLine({ line }: { line: SyncLineWords | null }) {
  return (
    <p
      role="status"
      data-slot="sync-line"
      data-problem={line?.problem || undefined}
      className="flex min-h-5 items-start gap-1.5 text-caption text-muted-foreground"
    >
      {line?.problem ? (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-review" />
      ) : null}
      {line?.words ?? null}
    </p>
  )
}
