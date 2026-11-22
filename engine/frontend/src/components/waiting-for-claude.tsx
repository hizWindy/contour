/**
 * "Waiting for Claude: 1 ahead of you." (PLAN-V26 T1-2): a prep or a Research again that waits for
 * a place in its lane. The backend names a number only after a second's wait, so work that starts
 * at once never shows the words.
 *
 * The count can fall while it waits. The line follows it, but a screen reader hears only the first
 * one: the live part keeps that text until the wait is over. The live part is always in the page,
 * because one added together with its words often isn't read. It has no role, so it isn't taken
 * for the screen's own status line.
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'

function waitWords(ahead: number): string {
  return `Waiting for Claude: ${String(ahead)} ahead of you.`
}

export function WaitingForClaude({
  ahead,
  className,
}: {
  ahead: number | null | undefined
  className?: string
}) {
  const now = ahead ?? null
  const [heard, setHeard] = useState(now)
  if ((now === null) !== (heard === null)) setHeard(now) // a wait began or ended
  return (
    <>
      {now !== null ? (
        <p aria-hidden="true" className={cn('text-caption text-foreground', className)}>
          {waitWords(now)}
        </p>
      ) : null}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {heard !== null && now !== null ? waitWords(heard) : ''}
      </p>
    </>
  )
}
