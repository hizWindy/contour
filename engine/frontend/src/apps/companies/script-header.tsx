/**
 * The script column's header (PLAN-V14 T2-2 and T2-4): the title, a status line beside it, and
 * "Research again" at the top right, where people look for it. The modal draws it above
 * `<SalesScript>`, inside the section it names.
 *
 * - **Research again** makes a new web check and a new script in one request (`refresh`). Its
 *   hint says what it does and what it costs (`prep_cap_usd`). No confirm box: it costs at most
 *   US$0.25 (**TBC** with Al-khair).
 * - **It is always there.** Call prep off: greyed out, and the hint says an admin can switch it
 *   on. Names off: it still writes a new script, with no web check. While it runs, the 3-step bar.
 *   After a failure, "Try again".
 * - **On a phone** the button is full width under the title.
 */
import { CircleCheck, CircleDashed, RefreshCw } from 'lucide-react'
import { useId } from 'react'
import type { ToneKey } from '@/api/hooks/script'
import type { PrepOut, StyleUsed } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatRelative, formatTime } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { CallGuide } from './playbook'
import { toneHint } from './style-words'

/** The id of the title, for the section's `aria-labelledby`. */
export const SCRIPT_TITLE_ID = 'sales-script'

const STEPS = ['Facts from HubSpot', 'Web check', 'Script'] as const

/** The bar that fills one step at a time: facts, web check, script. It never loops. */
function Searching({ stage }: { stage: number }) {
  const done = Math.max(0, Math.min(3, stage))
  const now = STEPS[Math.min(done, STEPS.length - 1)]
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={Math.max(8, (done / 3) * 100)} aria-label={`Call prep: ${now}`} />
      <ol className="grid grid-cols-3 gap-2 text-caption">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              'flex items-center gap-1 transition-colors',
              index < done ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {index < done ? (
              <CircleCheck aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleDashed aria-hidden="true" className="size-3.5" />
            )}
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function styleWords(style: StyleUsed | undefined): string {
  if (!style) return ''
  const team = style.team_notes > 0
  if (team && style.mine) return ' Written with the team style and yours.'
  if (team) return ' Written with the team style.'
  if (style.mine) return ' Written with your style.'
  return ''
}

/** "Made 2 days ago by Tom. Written with the team style." */
function madeWords(prep: PrepOut, now: Date = new Date()): string {
  const style = styleWords(prep.style_used)
  if (prep.trigger === 'search_ahead') {
    return `Searched ahead at ${formatTime(prep.created_at)}.${style}`
  }
  // After a week, formatRelative gives a date: "Made on 3 Oct 2026".
  const when = formatRelative(prep.created_at, now)
  const at = /\d$/.test(when) ? `on ${when}` : when
  return `Made ${at}${prep.made_by ? ` by ${prep.made_by}` : ''}.${style}`
}

export interface ScriptHeaderProps {
  madeFrom: CallGuide['madeFrom']
  /** Call prep's prep for this call, once there is one. */
  prep: PrepOut | undefined
  /** Call prep is switched on, or null before the facts say. */
  enabled: boolean | null
  /** HubSpot names may go to Claude, so there is a web check. */
  namesOk: boolean
  /** The most one prep may cost (`prep_cap_usd`), or null before the facts say. */
  capUsd: string | null
  /** Call prep is checking now: the first prep, or a Research again. */
  running: boolean
  /** The step the 3-step bar is on. */
  stage: number
  /** The last try failed: the request was refused, or the prep failed. */
  failed: boolean
  /** The tone my scripts use now (PLAN-V15), or null before the style loads. */
  toneNow?: ToneKey | null
  onResearch: () => void
}

function hintWords({ enabled, namesOk, capUsd, running }: ScriptHeaderProps): string {
  if (enabled === false) return 'Call prep is off. An admin can switch it on.'
  if (running) return 'Call prep is checking the web and writing a new script.'
  const cost = capUsd === null ? '' : ` Costs up to ${formatMoney(capUsd)}.`
  if (!namesOk) return `Names don't go to Claude yet, so there is no web check.${cost}`
  return `New news, a new "still there?" check and a new script.${cost}`
}

function statusWords({ madeFrom, prep, running }: ScriptHeaderProps): string {
  if (madeFrom === 'claude' && prep) return madeWords(prep)
  if (running) return 'Written from our HubSpot copy until the new one is ready.'
  return 'Written from our HubSpot copy.'
}

export function ScriptHeader(props: ScriptHeaderProps) {
  const { enabled, running, stage, failed, onResearch } = props
  const hint = useId()
  const tone = props.madeFrom === 'claude' ? toneHint(props.prep?.tone_used, props.toneNow) : null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id={SCRIPT_TITLE_ID} className="text-body font-semibold text-foreground">
            Sales script
          </h3>
          <p role="status" className="text-caption text-muted-foreground">
            {statusWords(props)}
          </p>
          {tone ? <p className="basis-full text-caption text-foreground">{tone}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:w-64 sm:items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-sm:w-full"
            disabled={enabled !== true || running}
            aria-describedby={hint}
            onClick={onResearch}
          >
            <RefreshCw aria-hidden="true" />
            {running ? 'Researching...' : failed ? 'Try again' : 'Research again'}
          </Button>
          <p id={hint} className="text-caption text-muted-foreground">
            {hintWords(props)}
          </p>
        </div>
      </div>
      {running ? <Searching stage={stage} /> : null}
    </div>
  )
}
