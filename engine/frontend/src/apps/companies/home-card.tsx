/**
 * The Companies page on Home (the "bento" Home, 11 Nov): how many companies we have and how fresh
 * the HubSpot copy is, a box to find a company, and the calls I prepped today.
 *
 * The count asks for the Companies page's own first page (the same request), so opening Companies
 * from here shows the list at once. The box opens Companies with the name typed in its search, and
 * a call prepped today opens that company.
 */
import { ArrowRight, Building2, Search } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCompanies, useHubSpotSyncs, useTodayPreps } from '@/api/hooks'
import type { PrepChip } from '@/api/types'
import { RollingNumber } from '@/components/motion'
import { PendingText } from '@/components/skeletons'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TONE_CLASSES } from '@/shell/tone'
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
function Today() {
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
            <Link
              to={`/companies?${new URLSearchParams({ company: chip.company_key }).toString()}`}
              className="inline-flex max-w-56 items-center rounded-md border px-2 py-1 text-caption text-foreground transition-colors duration-150 hover:bg-muted"
            >
              <span className="truncate">{chipName(chip)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CompaniesHomeCard() {
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
          <Building2 className="size-5" />
        </span>
        <h2 id={TITLE_ID} className="flex-1 text-section font-semibold text-foreground">
          Companies
        </h2>
        <Link
          to="/companies"
          aria-label="Open Companies"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-ui text-link underline-offset-4 hover:underline"
        >
          Open
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="flex flex-col gap-5 px-6">
        <Count />
        <FindCompany />
        <Today />
      </div>
    </Card>
  )
}
