/**
 * "Before you dial" (PLAN-V10 F1, moved into the card's header by PLAN-V14 T2-3): Still there?,
 * Last talk and News, in one row under the person's name. On a rushed call that is all anyone
 * reads, so it stays in view while the script scrolls.
 *
 * - Each answer shows its value first (one line, two for News) and a small detail line under it.
 *   A press opens it in full, with its sources, in a small popover.
 * - **News** (PLAN-V14 T2-5) is the newest item, however old, with its date and age ("14 Jun 2026,
 *   5 months ago"). The others sit behind "+2 more", in the popover with each date and source.
 *   With nothing on the web, the Lead Finder's newest saved note shows ("Saved research, 3 Oct"),
 *   and with none either, "No news found".
 * - **On a phone** the three stack as short rows of one line each, so nothing scrolls sideways.
 * - **Connections** waits for Levi's customer list (PREP.md, **TBC**). Its answer is here, ready,
 *   and shows with `connections`.
 *
 * Colour only where something needs attention: Ochre for no talk in 6 months or nobody named,
 * Terracotta for a person who has left. Every status has an icon and words.
 */
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  History,
  Link2,
  MessageSquare,
  Newspaper,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useContext, type ReactNode } from 'react'
import type { CompanyDetail, CompanyNote, PrepFacts, PrepScript } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { agoWords, talkStale } from './dates'
import { GuideText } from './guide-parts'
import { SourcesContext } from './guide-sources'
import { STILL_WORDS } from './script-text'

type Tone = 'quiet' | 'attention' | 'alert'

const ICON_TONES: Record<Tone, string> = {
  quiet: 'text-muted-foreground',
  attention: 'text-review',
  alert: 'text-destructive',
}

interface Answer {
  label: string
  icon: LucideIcon
  tone?: Tone
  /** The answer in a few words. */
  value: string
  /** The small line under it. */
  detail?: string
  /** The sources of the value, or of the detail. Shown as still marks; the popover links them. */
  sources?: { value?: string[]; detail?: string[] }
  /**
   * The value and the detail in full, with their source marks, for the popover. Or `body`, which
   * takes the place of both (News, with every item).
   */
  full?: { value?: ReactNode; detail?: ReactNode; body?: ReactNode }
  /** Call prep is still looking. */
  loading?: boolean
  /** News gets two lines for its value, and on a phone its detail keeps a line of its own. */
  lines?: 1 | 2
}

/**
 * A line's source ids (W1, F3) as still marks, inside the button. The popover has the real ones,
 * with their labels and links. Hidden from screen readers, which hear them in the popover.
 */
function Marks({ ids }: { ids: string[] | undefined }) {
  if (!ids?.length) return null
  return (
    <span aria-hidden="true">
      {ids.map((id) => (
        <span
          key={id}
          className="ml-1 inline-flex h-5 items-center rounded-sm border border-input px-1 align-middle text-caption leading-none font-semibold text-muted-foreground tabular-nums"
        >
          {id}
        </span>
      ))}
    </span>
  )
}

/** One answer: a button that opens it in full. While call prep looks, a still grey line. */
function AnswerItem({ answer }: { answer: Answer }) {
  const {
    label,
    icon: Icon,
    tone = 'quiet',
    value,
    detail,
    sources,
    full,
    loading,
    lines = 1,
  } = answer
  const box =
    'flex w-full min-w-0 rounded-lg border p-2.5 text-left max-sm:min-h-11 max-sm:items-center max-sm:gap-3 sm:flex-col sm:gap-1 sm:p-3'
  if (loading) {
    return (
      <div className={cn(box, 'bg-card')}>
        <span className="text-caption text-muted-foreground max-sm:w-20 max-sm:shrink-0">
          {label}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:w-full" aria-hidden="true">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2 max-sm:hidden" />
        </span>
        <span className="sr-only">Call prep is checking.</span>
      </div>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            box,
            'animate-in transition-colors duration-150 fade-in-0',
            tone === 'alert'
              ? 'border-destructive bg-destructive-soft hover:bg-destructive-soft/70'
              : 'bg-card hover:bg-muted',
          )}
        >
          <span className="text-caption text-muted-foreground max-sm:w-20 max-sm:shrink-0">
            {label}
          </span>
          <span
            className={cn(
              'flex min-w-0 flex-1 gap-x-1.5 sm:w-full sm:flex-col sm:gap-y-1',
              // News keeps its date and age on a phone: a second line, not cut off.
              lines === 2 ? 'max-sm:flex-col max-sm:gap-y-0.5' : 'max-sm:items-center',
            )}
          >
            <span className="flex min-w-0 items-start gap-1.5 text-ui font-semibold max-sm:shrink-0 max-sm:max-w-full">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ICON_TONES[tone])} />
              <span
                className={cn(
                  'min-w-0 max-sm:truncate',
                  lines === 2 ? 'sm:line-clamp-2' : 'sm:line-clamp-1',
                )}
              >
                {value}
                <Marks ids={sources?.value} />
              </span>
            </span>
            {detail ? (
              <span className="min-w-0 truncate text-caption text-muted-foreground">
                {lines === 2 ? null : (
                  <span aria-hidden="true" className="sm:hidden">
                    ·{' '}
                  </span>
                )}
                {detail}
                <Marks ids={sources?.detail} />
              </span>
            ) : null}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        className="w-80 max-w-[calc(100vw-2rem)] gap-1.5"
      >
        <p className="text-caption text-muted-foreground">{label}</p>
        {full?.body ?? (
          <>
            <p className="flex items-start gap-1.5 font-semibold">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ICON_TONES[tone])} />
              <span className="min-w-0">{full?.value ?? value}</span>
            </p>
            {full?.detail || detail ? (
              <p className="text-caption text-muted-foreground">{full?.detail ?? detail}</p>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export interface BeforeYouDialProps {
  company: CompanyDetail | undefined
  facts: PrepFacts | undefined
  /** Call prep's script, once it is ready. */
  script: PrepScript | null
  /** Call prep is checking the web now. */
  checking: boolean
  person: { id: string; name: string } | null
  today: string
  /** Show Connections. Off until Levi's customer list is loaded (PREP.md, TBC). */
  connections?: boolean
}

function stillAnswer({ facts, script, checking, person, company }: BeforeYouDialProps): Answer {
  if (!person) {
    return {
      label: 'Who',
      icon: Users,
      tone: 'attention',
      value: 'Nobody named',
      detail: 'Ask for whoever looks after the office.',
      full: { detail: 'Ask the switchboard for whoever looks after the office.' },
    }
  }
  if (script && script.still_there !== 'not_checked') {
    const note = script.still_there_note
    const fromNote = note
      ? {
          detail: note.text,
          sources: { detail: note.sources },
          full: { detail: <GuideText line={{ ...note, why: null, icon: 'web' }} /> },
        }
      : {}
    if (script.still_there === 'yes') {
      return { label: 'Still there?', icon: CircleCheck, value: STILL_WORDS.yes, ...fromNote }
    }
    if (script.still_there === 'no') {
      return {
        label: 'Still there?',
        icon: UserX,
        tone: 'alert',
        value: STILL_WORDS.no,
        ...fromNote,
      }
    }
    return {
      label: 'Still there?',
      icon: CircleHelp,
      value: STILL_WORDS.unknown,
      detail: 'The web check found nothing sure.',
    }
  }
  if (checking) return { label: 'Still there?', icon: CircleDashed, value: '', loading: true }
  const activity = company?.people.find((item) => item.id === person.id)?.last_activity
  if (activity) {
    return {
      label: 'Still there?',
      icon: CircleDashed,
      value: STILL_WORDS.not_checked,
      detail: `Last HubSpot activity ${formatDate(activity)}.`,
    }
  }
  if (facts?.names_ok === false) {
    return {
      label: 'Still there?',
      icon: CircleDashed,
      value: STILL_WORDS.not_checked,
      detail: "Names don't go to Claude yet.",
      full: { detail: "Names don't go to Claude yet, so there is no web check." },
    }
  }
  return {
    label: 'Still there?',
    icon: CircleDashed,
    value: STILL_WORDS.not_checked,
    detail: facts?.prep_enabled ? 'Call prep checks the web.' : 'Call prep is off.',
    full: {
      detail: facts?.prep_enabled
        ? 'Call prep checks this on the web.'
        : 'Call prep is off, so there is no web check.',
    },
  }
}

function talkAnswer({ company, facts, today }: BeforeYouDialProps): Answer {
  const date = facts?.last_call?.called_at?.slice(0, 10) ?? company?.last_talk ?? null
  if (!date) {
    return {
      label: 'Last talk',
      icon: History,
      tone: 'attention',
      value: 'None on record',
      detail: company?.source === 'lead' ? 'Not in HubSpot yet.' : 'No call logged in HubSpot.',
    }
  }
  const stale = talkStale(date, today)
  const owner = facts?.last_call?.owner ?? company?.owner
  return {
    label: 'Last talk',
    icon: stale ? History : MessageSquare,
    tone: stale ? 'attention' : 'quiet',
    value: formatDate(date),
    detail: `${agoWords(date, today)}${owner ? ` · ${owner}` : ''}`,
  }
}

type NewsItem = PrepScript['news'][number]

/** "14 Jun 2026, 5 months ago", or "No date" when none of the pages it cites has one. */
function whenWords(date: string | null | undefined, today: string): string {
  return date ? `${formatDate(date)}, ${agoWords(date, today)}` : 'No date'
}

/** Every news item, newest first, each with its date, its age and where it comes from. */
function NewsList({ items, today }: { items: NewsItem[]; today: string }) {
  const sources = useContext(SourcesContext)
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const from = item.sources
          .map((id) => sources.get(id)?.label)
          .filter(Boolean)
          .join(', ')
        return (
          <li key={item.text} className="flex items-start gap-1.5">
            <Newspaper
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>
                <GuideText line={{ ...item, why: null, icon: 'news' }} />
              </span>
              <span className="text-caption text-muted-foreground">
                {whenWords(item.date, today)}
                {from ? ` · ${from}` : ''}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The Lead Finder's newest saved note, when the web has nothing (or isn't checked). */
function noteAnswer(note: CompanyNote): Answer {
  const saved = `Saved research${note.date ? `, ${formatDate(note.date)}` : ''}`
  return { label: 'News', icon: Newspaper, value: note.text, lines: 2, detail: saved }
}

function newsAnswer({ company, facts, script, checking, today }: BeforeYouDialProps): Answer {
  const items = script?.news ?? []
  const [newest] = items
  if (newest) {
    const more = items.length - 1
    return {
      label: 'News',
      icon: Newspaper,
      value: newest.text,
      lines: 2,
      detail: `${whenWords(newest.date, today)}${more > 0 ? ` · +${String(more)} more` : ''}`,
      sources: { value: newest.sources },
      full: { body: <NewsList items={items} today={today} /> },
    }
  }
  if (checking) return { label: 'News', icon: Newspaper, value: '', loading: true }
  const note = company?.notes[0]
  if (note) return noteAnswer(note)
  if (script) {
    return {
      label: 'News',
      icon: Newspaper,
      value: 'No news found',
      detail: 'Nothing on the web or in saved research.',
    }
  }
  return {
    label: 'News',
    icon: Newspaper,
    value: 'Not checked',
    detail: facts?.prep_enabled ? 'Call prep looks for news.' : 'Call prep is off.',
    full: {
      detail: facts?.prep_enabled
        ? 'Call prep looks for news.'
        : 'Call prep is off, so there is no web check.',
    },
  }
}

const CONNECTIONS: Answer = {
  label: 'Connections',
  icon: Link2,
  value: 'Not checked yet',
  detail: 'Waiting for the customer list.',
}

/** Still there?, Last talk and News: Levi's questions, in the card's header. */
export function BeforeYouDial(props: BeforeYouDialProps) {
  const answers = [stillAnswer(props), talkAnswer(props), newsAnswer(props)]
  if (props.connections) answers.push(CONNECTIONS)
  return (
    <ul
      aria-label="Before you dial"
      className={cn(
        'grid grid-cols-1 gap-2',
        props.connections ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3',
      )}
    >
      {answers.map((answer) => (
        <li key={answer.label} className="flex min-w-0">
          <AnswerItem answer={answer} />
        </li>
      ))}
    </ul>
  )
}
