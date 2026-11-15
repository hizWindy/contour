/**
 * How long the rep has spent on this note. It counts up from when the view opened (PLAN-V17,
 * "A timer counts up"). At the soft limit (`soft_seconds`, 3 minutes for now, TBC with Levi) it
 * turns Ochre, its icon changes, and it says "That's 3 minutes. Wrap up when you can.", once, to a
 * screen reader too. It never cuts the rep off.
 *
 * It is a component of its own, so only it draws again each second, not the note view.
 */
import { Hourglass, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { clockText, wrapUpWords } from './words'

const TICK_MS = 1000

export function NoteTimer({ softSeconds, className }: { softSeconds: number; className?: string }) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const late = softSeconds > 0 && seconds >= softSeconds
  const Icon = late ? Hourglass : Timer
  return (
    <div
      data-slot="note-timer"
      data-late={late || undefined}
      className={cn(
        'flex min-w-0 items-start gap-2 text-ui',
        late ? 'text-review-ink' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="shrink-0 tabular-nums">
        <span className="sr-only">Time on this note: </span>
        <span role="timer">{clockText(seconds)}</span>
      </span>
      {/* Read once, when it turns. The seconds are never read out. */}
      <span role="status" className="min-w-0 text-pretty">
        {late ? wrapUpWords(softSeconds) : ''}
      </span>
    </div>
  )
}
