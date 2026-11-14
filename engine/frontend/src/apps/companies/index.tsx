/**
 * Companies (PLAN-V10 B4): every client and prospect in the HubSpot copy, and, for people with
 * the Lead Finder tick, its good leads that aren't in HubSpot yet.
 *
 * - The prep box at the top preps a call. The filter bar under it only filters the list.
 * - The filters, sort, page and the open company live in the address (`params.ts`), so a link or
 *   Back shows the same list.
 * - "Prep" on every row (or P on the active row) opens call prep in a narrow panel on the right.
 *   The list stays usable beside it, so the next row's Prep switches the panel to that company.
 * - A click on a row opens the company's record in a dialog in the middle. J and K move through
 *   the rows, Enter opens the active one and Esc closes what is open. A pointer resting on a row,
 *   or focus moving to it, loads the company first, so both open filled.
 * - One at a time: opening the company closes call prep, and "Prep a call" in the company's
 *   dialog closes the dialog first.
 * - On a phone (PLAN-V10 G1) the list is cards (`company-cards.tsx`), the filters sit behind one
 *   Filters button, and the prep box stays pinned to the top while the list scrolls.
 */
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { Building2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { companyQueryOptions, useCompanies, useCompanyFacets } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson, CompanyRow } from '@/api/types'
import { DataTable, DensityToggle } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { melbourneDate } from '@/lib/format'
import { PHONE, REDUCED_MOTION, useMediaQuery } from '@/lib/use-media-query'
import { sparing } from '@/shell/preload'
import { companyColumns } from './columns'
import { CompanyCards } from './company-cards'
import { CompanyDialog } from './company-dialog'
import { FilterBar } from './filter-bar'
import { HubSpotSync } from './hubspot-sync'
import {
  activeFilterCount,
  FIRST_ORDER,
  listQuery,
  NO_FILTERS,
  PAGE_SIZE,
  readCompanies,
  SORT_KEYS,
  writeCompanies,
  type CompaniesState,
  type CompanyFilters,
} from './params'
import { PrepBox, type PrepTarget } from './prep-box'
import { PrepSheet } from './prep-sheet'

const COMPACT_KEY = 'companies.compact'

function savedCompact(): boolean {
  try {
    return window.localStorage.getItem(COMPACT_KEY) === 'true'
  } catch {
    return false
  }
}

function saveCompact(compact: boolean): void {
  try {
    window.localStorage.setItem(COMPACT_KEY, String(compact))
  } catch {
    // A browser that blocks storage just forgets the choice.
  }
}

function Empty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return filtered ? (
    <EmptyState
      title="No companies match these filters."
      description="Clear a filter or two to see more."
      headingLevel={3}
      action={
        <Button type="button" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      title="No companies yet."
      description="The list fills from the HubSpot copy, which syncs every morning at 6:00."
      headingLevel={3}
    />
  )
}

export default function CompaniesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const state = readCompanies(params)
  const [compact, setCompact] = useState(savedCompact)
  const [active, setActive] = useState<string | null>(null)
  const [prep, setPrep] = useState<PrepTarget | null>(null)
  const queryClient = useQueryClient()
  // A phone gets cards instead of the table (PLAN-V10 G1).
  const phone = useMediaQuery(PHONE)
  const listTop = useRef<HTMLDivElement>(null)
  const today = melbourneDate()

  const go = (next: CompaniesState): void => {
    setParams(writeCompanies(next), { replace: true, preventScrollReset: true })
  }
  const changeFilters = (change: Partial<CompanyFilters>): void => {
    go({ ...state, filters: { ...state.filters, ...change }, page: 0 })
  }
  const clearFilters = (): void => {
    go({ ...state, filters: NO_FILTERS, page: 0 })
  }
  // A pointer resting on a row, or focus moving to it: what Prep and the dialog show starts loading.
  const startCompany = (key: string): void => {
    if (!sparing()) {
      void queryClient.prefetchQuery(companyQueryOptions(key))
    }
  }
  const openCompany = useCallback(
    (key: string): void => {
      setActive(key)
      setPrep(null)
      go({ ...state, company: key })
    },
    // `go` only wraps setParams, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  )
  const closeCompany = (): void => {
    if (state.company !== null) {
      go({ ...state, company: null })
    }
  }
  // The full page opens after the list has dropped the dialog from its address, so Back returns to
  // the list as it was.
  const openFullPage = (key: string): void => {
    void (async () => {
      await navigate(
        { search: writeCompanies({ ...state, company: null }).toString() },
        { replace: true, preventScrollReset: true },
      )
      await navigate(`/companies/${encodeURIComponent(key)}`)
    })()
  }
  // "Prep" on a row, or P: the company, nobody picked yet. The row becomes the active one.
  const prepRow = useCallback((row: CompanyRow): void => {
    setActive(row.key)
    setPrep({ companyKey: row.key, companyName: row.name, person: null })
  }, [])
  // "Prep a call" in the company's dialog: the dialog closes first.
  const prepCall = (company: CompanyDetail, person: CompanyPerson | null): void => {
    closeCompany()
    setPrep({
      companyKey: company.key,
      companyName: company.name,
      person: person ? { id: person.id, name: person.name, title: person.title } : null,
    })
  }

  const companies = useCompanies(listQuery(state))
  const facets = useCompanyFacets()
  const page = companies.data
  const leadsShown = page?.leads_shown ?? facets.data?.leads_shown ?? false
  // "Prep" at the end of each name, and "Open in HubSpot" at the end of a row (PLAN-V13 T2-8).
  const columns = useMemo(
    () => companyColumns({ leadsShown, handlers: { onPrep: prepRow, onOpen: openCompany } }),
    [leadsShown, prepRow, openCompany],
  )
  const rows = page?.items
  // P on the active row: the same as its Prep button.
  const rowLetters = useMemo(
    () => ({
      p: (key: string) => {
        const row = rows?.find((item) => item.key === key)
        if (row) prepRow(row)
      },
    }),
    [rows, prepRow],
  )
  const filtered = activeFilterCount(state.filters) > 0
  const activeRow = state.company ?? active

  const sorting: SortingState = [{ id: state.sort, desc: state.order === 'desc' }]
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater
    const key = SORT_KEYS.find((item) => item === next[0]?.id)
    if (!key) return
    const order = key === state.sort ? (state.order === 'desc' ? 'asc' : 'desc') : FIRST_ORDER[key]
    go({ ...state, sort: key, order, page: 0 })
  }

  return (
    <>
      <PageHeader
        icon={Building2}
        tone="companies"
        title="Companies"
        description={
          phone
            ? undefined
            : 'Every client and prospect in HubSpot. Open one to see what we know, or prep a call before you ring.'
        }
        actions={<HubSpotSync />}
      />
      <PrepBox onPick={setPrep} />
      <FilterBar
        filters={state.filters}
        facets={facets.data}
        leadsShown={leadsShown}
        onChange={changeFilters}
        onClear={clearFilters}
        total={page?.total}
        trailing={
          <DensityToggle
            compact={compact}
            onCompactChange={(next) => {
              setCompact(next)
              saveCompact(next)
            }}
          />
        }
      />
      {companies.error ? (
        <ErrorState
          error={companies.error}
          context="The companies couldn't be loaded."
          onRetry={() => void companies.refetch()}
        />
      ) : phone ? (
        <div ref={listTop} className="scroll-mt-32">
          <CompanyCards
            rows={page?.items}
            total={page?.total ?? 0}
            pageIndex={state.page}
            pageSize={PAGE_SIZE}
            loading={companies.isFetching}
            leadsShown={leadsShown}
            activeKey={activeRow}
            today={today}
            onOpen={openCompany}
            onIntent={startCompany}
            onPrep={prepRow}
            onPageChange={(pageIndex) => {
              go({ ...state, page: pageIndex })
              listTop.current?.scrollIntoView({
                block: 'start',
                behavior: window.matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth',
              })
            }}
            empty={<Empty filtered={filtered} onClear={clearFilters} />}
          />
        </div>
      ) : (
        <div
          onFocusCapture={(event) => {
            const row = (event.target as Element).closest<HTMLElement>('[data-row-id]')
            if (row?.dataset.rowId) startCompany(row.dataset.rowId)
          }}
        >
          <DataTable
            label="Companies"
            columns={columns}
            data={page?.items ?? []}
            getRowId={(row) => row.key}
            sorting={sorting}
            onSortingChange={onSortingChange}
            page={{ pageIndex: state.page, pageSize: PAGE_SIZE, total: page?.total ?? 0 }}
            onPageChange={(pageIndex) => {
              go({ ...state, page: pageIndex })
            }}
            compact={compact}
            activeRowId={activeRow}
            onActiveRowChange={(key) => {
              setActive(key)
              startCompany(key)
            }}
            onOpenRow={openCompany}
            onRowIntent={startCompany}
            onEscape={closeCompany}
            rowLetters={rowLetters}
            loading={companies.isFetching}
            empty={<Empty filtered={filtered} onClear={clearFilters} />}
          />
        </div>
      )}
      <CompanyDialog
        companyKey={state.company}
        onClose={closeCompany}
        onOpenFullPage={openFullPage}
        onPrep={prepCall}
        rows={page?.items}
      />
      <PrepSheet
        target={prep}
        onClose={() => {
          setPrep(null)
        }}
        onChangeTarget={setPrep}
        onOpenCompany={(key) => {
          setPrep(null)
          openCompany(key)
        }}
      />
    </>
  )
}
