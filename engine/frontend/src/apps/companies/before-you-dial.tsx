/**
 * "Before you dial" (PLAN-V10 F1): Levi's 4 questions, in 4 tiles. On a rushed call that is all
 * anyone reads. Moved out of `prep-card.tsx` by PLAN-V14 T2-2, with no change.
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
import type { ReactNode } from 'react'
import type { CompanyDetail, PrepFacts, PrepScript } from '@/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { agoWords, talkStale } from './dates'
import { GuideText } from './guide-parts'
import { STILL_WORDS } from './script-text'

type Tone = 'quiet' | 'attention' | 'alert'

const ICON_TONES: Record<Tone, string> = {
  quiet: 'text-muted-foreground',
  attention: 'text-review',
  alert: 'text-destructive',
}

interface TileProps {
  label: string
  icon: LucideIcon
  tone?: Tone
  value: ReactNode
  sub?: ReactNode
  loading?: boolean
}

function Tile({ label, icon: Icon, tone = 'quiet', value, sub, loading }: TileProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-3 transition-colors',
        tone === 'alert' ? 'border-destructive bg-destructive-soft' : 'bg-card',
      )}
    >
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {loading ? (
          <span className="flex flex-col gap-1.5" aria-hidden="true">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : (
          <span className="flex animate-in flex-col gap-1 duration-150 fade-in-0">
            <span className="flex min-w-0 items-start gap-1.5 text-ui font-semibold">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ICON_TONES[tone])} />
              <span className="line-clamp-2 min-w-0">{value}</span>
            </span>
            {sub ? (
              <span className="line-clamp-2 text-caption text-muted-foreground">{sub}</span>
            ) : null}
          </span>
        )}
      </dd>
    </div>
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
}

function stillTile({ facts, script, checking, person, company }: BeforeYouDialProps): TileProps {
  if (!person) {
    return {
      label: 'Who',
      icon: Users,
      tone: 'attention',
      value: 'Nobody named',
      sub: 'Ask the switchboard for whoever looks after the office.',
    }
  }
  if (script && script.still_there !== 'not_checked') {
    const note = script.still_there_note ? (
      <GuideText line={{ ...script.still_there_note, why: null, icon: 'web' }} />
    ) : null
    if (script.still_there === 'yes') {
      return { label: 'Still there?', icon: CircleCheck, value: STILL_WORDS.yes, sub: note }
    }
    if (script.still_there === 'no') {
      return { label: 'Still there?', icon: UserX, tone: 'alert', value: STILL_WORDS.no, sub: note }
    }
    return {
      label: 'Still there?',
      icon: CircleHelp,
      value: STILL_WORDS.unknown,
      sub: 'The web check found nothing sure.',
    }
  }
  if (checking) return { label: 'Still there?', icon: CircleDashed, value: '', loading: true }
  const activity = company?.people.find((item) => item.id === person.id)?.last_activity
  return {
    label: 'Still there?',
    icon: CircleDashed,
    value: STILL_WORDS.not_checked,
    sub: activity
      ? `Last HubSpot activity ${formatDate(activity)}.`
      : facts?.names_ok === false
        ? "Names don't go to Claude yet, so there is no web check."
        : facts?.prep_enabled
          ? 'Call prep checks this on the web.'
          : 'Call prep is off, so there is no web check.',
  }
}

function talkTile({ company, facts, today }: BeforeYouDialProps): TileProps {
  const date = facts?.last_call?.called_at?.slice(0, 10) ?? company?.last_talk ?? null
  if (!date) {
    return {
      label: 'Last talk',
      icon: History,
      tone: 'attention',
      value: 'None on record',
      sub: company?.source === 'lead' ? 'Not in HubSpot yet.' : 'No call logged in HubSpot.',
    }
  }
  const stale = talkStale(date, today)
  const owner = facts?.last_call?.owner ?? company?.owner
  return {
    label: 'Last talk',
    icon: stale ? History : MessageSquare,
    tone: stale ? 'attention' : 'quiet',
    value: formatDate(date),
    sub: `${agoWords(date, today)}${owner ? ` · ${owner}` : ''}`,
  }
}

function newsTile({ company, facts, script, checking }: BeforeYouDialProps): TileProps {
  const news = script?.news[0]
  if (news) {
    return {
      label: 'News',
      icon: Newspaper,
      value: <GuideText line={{ ...news, why: null, icon: 'news' }} />,
    }
  }
  if (script) {
    return {
      label: 'News',
      icon: Newspaper,
      value: 'Nothing new',
      sub: 'None found in the last 90 days.',
    }
  }
  if (checking) return { label: 'News', icon: Newspaper, value: '', loading: true }
  const note = company?.notes[0]
  if (note) {
    return {
      label: 'News',
      icon: Newspaper,
      value: note.text,
      sub: `Saved research${note.date ? `, ${formatDate(note.date)}` : ''}.`,
    }
  }
  return {
    label: 'News',
    icon: Newspaper,
    value: 'Not checked',
    sub: facts?.prep_enabled
      ? 'Call prep looks for news.'
      : 'Call prep is off, so there is no web check.',
  }
}

/** Levi's 4 questions, in 4 tiles. */
export function BeforeYouDial(props: BeforeYouDialProps) {
  return (
    <section aria-labelledby="before-you-dial" className="flex flex-col gap-3">
      <h3 id="before-you-dial" className="text-ui font-semibold text-foreground">
        Before you dial
      </h3>
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile {...stillTile(props)} />
        <Tile {...talkTile(props)} />
        <Tile {...newsTile(props)} />
        <Tile
          label="Connections"
          icon={Link2}
          value="Not checked yet"
          sub="Waiting for the customer list."
        />
      </dl>
    </section>
  )
}
