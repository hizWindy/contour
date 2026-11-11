/**
 * The score as one bar split into its parts, adding up to 100 (PLAN-V13 T2-6). Pointing at a
 * part, or choosing it with the keyboard, lights it in the accent (the rest stay muted) and
 * shows its checks with their points under the bar. The parts grow once when the page opens.
 *
 * The parts are tabs (arrows move between them), and the checks are the open tab's panel, so a
 * screen reader hears the part's name and points, then its checks.
 */
import { m } from 'motion/react'
import { useId, useState } from 'react'
import { handleRovingKey, INSTANT, springs, useStill } from '@/components/motion'
import { cn } from '@/lib/utils'
import { partChecks, type Criteria } from './words'

export function ScoreBar({ score }: { score: Criteria['score'] }) {
  const still = useStill()
  const id = useId()
  const parts = Object.entries(score.parts)
  const total = parts.reduce((sum, [, part]) => sum + part.points, 0)
  const [active, setActive] = useState(parts[0]?.[0] ?? '')
  const disabled = parts.map(() => false)
  const checks = partChecks(score, active)
  const activePart = score.parts[active]

  function pick(index: number) {
    const key = parts[index]?.[0]
    if (key) {
      setActive(key)
      document.getElementById(`${id}-tab-${key}`)?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="The score's parts"
        className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md"
      >
        {parts.map(([key, part], index) => {
          const selected = key === active
          return (
            <m.button
              key={key}
              id={`${id}-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              aria-label={`${part.label}: ${part.points} points`}
              title={`${part.label}: ${part.points} points`}
              onMouseEnter={() => setActive(key)}
              onFocus={() => setActive(key)}
              onClick={() => setActive(key)}
              onKeyDown={(event) => handleRovingKey(event, index, disabled, pick)}
              style={{ flexBasis: `${(part.points / total) * 100}%`, transformOrigin: 'left' }}
              initial={still ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={still ? INSTANT : { ...springs.smooth, delay: index * 0.04 }}
              className={cn(
                'flex min-w-0 items-center justify-center text-caption font-semibold tabular-nums transition-colors',
                selected ? 'bg-accent-strong text-primary-foreground' : 'bg-border text-foreground',
              )}
            >
              <span className="truncate px-1">{part.points}</span>
            </m.button>
          )
        })}
      </div>
      <ol className="grid gap-x-4 gap-y-1 text-caption sm:grid-cols-2 lg:grid-cols-3">
        {parts.map(([key, part]) => (
          <li
            key={key}
            className={cn(
              'flex items-baseline justify-between gap-2 border-l-2 pl-2 transition-colors',
              key === active
                ? 'border-accent-strong text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            <span className="truncate">{part.label}</span>
            <span className="tabular-nums">{part.points}</span>
          </li>
        ))}
      </ol>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        className="rounded-md border-l-2 border-accent-strong bg-accent-soft px-3 py-2 text-ui"
      >
        <p className="font-semibold text-accent-ink">
          {activePart?.label}: {activePart?.points} points, from
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {checks.map((check) => (
            <li key={check.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span>
                {check.label}
                {check.unseen ? (
                  <span className="text-caption text-muted-foreground">
                    {' '}
                    (can&apos;t be judged yet)
                  </span>
                ) : null}
              </span>
              <span className="text-caption tabular-nums">{check.points}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
