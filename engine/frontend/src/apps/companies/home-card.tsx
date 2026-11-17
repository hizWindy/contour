/**
 * The Relationships card on Home (the "bento" Home, 11 Nov; it was titled Companies until 17 Nov
 * 2026, when the group took the name Relationships, with the handshake icon): how many companies we have and how fresh
 * the HubSpot copy is, a box to find a company, the calls I prepped today, and, while call notes
 * are on (PLAN-V17 T3-7), a quick button for each kind of work waiting: "7 calls to confirm",
 * "2 need a look". Those come last: they arrive after two requests, and at the foot of the card
 * they push nothing inside it. Their code loads late (`call-note-parts.ts`).
 *
 * The count asks for the Companies page's own first page (the same request), so opening Companies
 * from here shows the list at once. The box opens Companies with the name typed in its search, and
 * a call prepped today opens that company.
 */
import { ArrowRight, Handshake, Search } from 'lucide-react'
import { Suspense, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCompanies, useHubSpotSyncs, useTodayPreps } from '@/api/hooks'
import type { PrepChip } from '@/api/types'
import { useCan } from '@/auth/can'
// By its own file: this card is in the first visit (see the kit's index.ts).
import { RollingNumber } from '@/components/motion/rolling-number'
import { PendingText } from '@/components/skeletons'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
import { CallNoteButtons } from './call-note-parts'
import { HOME_COMPANIES } from './prefetch'

const TITLE_ID = 'home-companies'

/** "copied from HubSpot 2 hours ago", or how a running sync is going. */
function useCopyWords(): string | null {
  const syncs = useHubSpotSyncs()
  const list = syncs.data ?? []
  if (list.some((sync) => sync.status === 'running')) return 'A HubSpot sync is running now.'
  const last = list.find((sync) => sync.status === 'done')
  if (last?.finished_at) return `Copied from HubSpot ${formatRelative(last.finished_at)}.`
  return syncs.isSuccess ? 'Not copied from HubSpot yet.' : null
}

function Count() {
  const companies = useCompanies(HOME_COMPANIES)
  const copy = useCopyWords()
  if (companies.isPending) return <PendingText className="h-9 w-32" />
  if (companies.isError) {
    return <p className="text-ui text-muted-foreground">Can't load the companies right now.</p>
  }
  const { total, leads_shown: withLeads } = companies.data
  return (
    <div className="flex flex-col gap-1">
      <p className="text-display font-semibold text-foreground">
        <RollingNumber value={total} />
      </p>
      <p className="text-ui text-muted-foreground">
        {withLeads
          ? "clients and prospects, with the Lead Finder's leads"
          : 'clients and prospects'}
        {copy ? (
          <>
            <br />
            {copy}
          </>
        ) : null}
      </p>
    </div>
  )
}

/** The box: Enter opens Companies with the name in its search. */
function FindCompany() {
  const navigate = useNavigate()
  const inputId = useId()
  const [text, setText] = useState('')
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = text.trim()
    void navigate(q ? `/companies?${new URLSearchParams({ q }).toString()}` : '/companies')
  }
  return (
    <form
      role="search"
      aria-label="Find a company"
      onSubmit={onSubmit}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={inputId} className="text-caption text-muted-foreground">
        Find a company and prep a call
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={inputId}
          type="search"
          value={text}
          placeholder="Company name"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => {
            setText(event.target.value)
          }}
          className="pl-9"
        />
      </div>
    </form>
  )
}

function chipName(chip: PrepChip): string {
  return chip.person_name ? `${chip.person_name}, ${chip.company_name}` : chip.company_name
}

/** The calls I prepped today, newest first. */
function Today({ linkToCompany }: { linkToCompany: boolean }) {
  const preps = useTodayPreps()
  if (preps.isPending || preps.isError) return null
  const chips = preps.data
  if (chips.length === 0) {
    return <p className="font-serif text-ui text-muted-foreground">No calls prepped today.</p>
  }
  return (
    <section aria-labelledby="home-preps" className="flex flex-col gap-1.5">
      <h3 id="home-preps" className="text-caption text-muted-foreground">
        Prepped today
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {chips.slice(0, 4).map((chip) => (
          <li key={chip.id}>
            {linkToCompany ? (
              <Link
                to={`/companies?${new URLSearchParams({ company: chip.company_key }).toString()}`}
                className="inline-flex max-w-56 items-center rounded-md border px-2 py-1 text-caption text-foreground transition-colors duration-150 hover:bg-muted"
              >
                <span className="truncate">{chipName(chip)}</span>
              </Link>
            ) : (
              <span className="inline-flex max-w-56 items-center rounded-md border px-2 py-1 text-caption text-foreground">
                <span className="truncate">{chipName(chip)}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CompaniesHomeCard() {
  const canCompanies = useCan('companies.companies')
  const canPrep = useCan('companies.call_prep')
  const canCallLogs = useCan('companies.call_logs')
  const canMeetings = useCan('companies.meetings')
  const openTo = canCompanies
    ? { to: '/companies', label: 'Open Companies' }
    : canCallLogs
      ? { to: '/companies/call-logs', label: 'Open Call logs' }
      : canMeetings
        ? { to: '/companies/meetings', label: 'Open Meetings' }
        : null
  return (
    <Card role="region" aria-labelledby={TITLE_ID} className="h-full gap-5">
      <div className="flex items-center gap-3 px-6">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            TONE_CLASSES.companies.tile,
          )}
        >
          <Handshake className="size-5" />
        </span>
        <h2 id={TITLE_ID} className="flex-1 text-section font-semibold text-foreground">
          Relationships
        </h2>
        {openTo ? (
          <Link
            to={openTo.to}
            aria-label={openTo.label}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline"
          >
            Open
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
      </div>
      <div className="flex flex-col gap-5 px-6">
        {canCompanies ? (
          <>
            <Count />
            <FindCompany />
          </>
        ) : canCallLogs && !canPrep ? (
          <p className="text-ui text-muted-foreground">Calls to confirm and call history.</p>
        ) : null}
        {canPrep ? <Today linkToCompany={canCompanies} /> : null}
        {canCallLogs ? (
          <Suspense fallback={null}>
            <CallNoteButtons />
          </Suspense>
        ) : null}
      </div>
    </Card>
  )
}
