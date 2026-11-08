/**
 * Companies (PLAN-V10 B4): every client and prospect in the HubSpot copy, and, for people with
 * the Lead Finder tick, its good leads that aren't in HubSpot yet.
 *
 * - The prep box at the top preps a call. The filter bar under it only filters the list.
 * - The filters, sort, page and the open company live in the address (`params.ts`), so a link or
 *   Back shows the same list.
 * - A click on a row opens the company panel. J and K move through the rows, Enter opens the
 *   active one and Esc closes the panel. A pointer resting on a row, or focus moving to it, loads
 *   the company first, so the panel opens filled.
 */
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { Building2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { companyQueryOptions, useCompanies, useCompanyFacets } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson } from '@/api/types'
import { DataTable, DensityToggle } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { sparing } from '@/shell/preload'
import { companyColumns } from './columns'
import { CompanyPanel } from './company-panel'
import { FilterBar } from './filter-bar'
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
import { PrepModal } from './prep-modal'

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

  const go = (next: CompaniesState): void => {
    setParams(writeCompanies(next), { replace: true, preventScrollReset: true })
  }
  const changeFilters = (change: Partial<CompanyFilters>): void => {
    go({ ...state, filters: { ...state.filters, ...change }, page: 0 })
  }
  const clearFilters = (): void => {
    go({ ...state, filters: NO_FILTERS, page: 0 })
  }
  // A pointer resting on a row, or focus moving to it: the panel it opens starts loading.
  const startCompany = (key: string): void => {
    if (!sparing()) {
      void queryClient.prefetchQuery(companyQueryOptions(key))
    }
  }
  const openCompany = (key: string): void => {
    setActive(key)
    go({ ...state, company: key })
  }
  const closeCompany = (): void => {
    if (state.company !== null) {
      go({ ...state, company: null })
    }
  }
  // The full page opens after the list has dropped the panel from its address, so Back returns to
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
  const prepCall = (company: CompanyDetail, person: CompanyPerson | null): void => {
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
  const columns = useMemo(() => companyColumns({ leadsShown }), [leadsShown])
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
        description="Every client and prospect in HubSpot. Open one to see what we know, or prep a call before you ring."
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
            loading={companies.isFetching}
            empty={<Empty filtered={filtered} onClear={clearFilters} />}
          />
        </div>
      )}
      <CompanyPanel
        companyKey={state.company}
        onClose={closeCompany}
        onOpenFullPage={openFullPage}
        onPrep={prepCall}
        rows={page?.items}
      />
      <PrepModal
        target={prep}
        onClose={() => {
          setPrep(null)
        }}
        onChangeTarget={setPrep}
      />
    </>
  )
}
