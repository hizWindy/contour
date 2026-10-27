/**
 * Results: every lead, in a table or as a list beside a map.
 *
 * - The filters, sort, page, view and the open lead live in the address (`params.ts`), so a link
 *   or Back shows the same list. A filter change goes back to page 1.
 * - Table (F3a): sort by any column header, compact rows, CSV download of what matches.
 * - Map (F3b): the list and the map side by side, with a divider to drag. Pins are coloured by
 *   result and sit at an approximate place.
 * - A click on a row or a pin opens the lead card in a side panel. J and K move through the rows,
 *   Enter opens the active one and Esc closes the panel.
 */
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { Download, Map as MapIcon, Table2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { fetchLeadsCsv, useLeadFacets, useLeadMap, useLeads } from '@/api/hooks'
import type { LeadPage, MapOut } from '@/api/types'
import { CityMap } from '@/components/city-map'
import { DataTable, DensityToggle } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { saveFile } from '@/lib/download'
import { formatNumber, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { LIST_COLUMNS, TABLE_COLUMNS } from './columns'
import { FilterBar } from './filter-bar'
import { LeadPanel } from './lead-panel'
import {
  activeFilterCount,
  exportQuery,
  filterQuery,
  FIRST_ORDER,
  listQuery,
  NO_FILTERS,
  PAGE_SIZE,
  readResults,
  SORT_KEYS,
  writeResults,
  type LeadFilters,
  type ResultsState,
} from './params'

const COMPACT_KEY = 'lead-finder.results.compact'

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
      title="No leads match these filters."
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
      title="No leads yet."
      description="Start a run to see companies here."
      headingLevel={3}
      action={
        <Button asChild>
          <Link to="/start">Start a run</Link>
        </Button>
      }
    />
  )
}

function MapNote({ map }: { map: MapOut | undefined }) {
  if (!map || map.total <= map.items.length) {
    return null
  }
  return (
    <p className="text-caption text-muted-foreground">
      The map shows {formatNumber(map.items.length)} of {pluralise(map.total, 'lead')}. Narrow the
      filters to see the rest.
    </p>
  )
}

export default function ResultsPage() {
  const [params, setParams] = useSearchParams()
  const state = readResults(params)
  const [compact, setCompact] = useState(savedCompact)
  const [active, setActive] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const go = (next: ResultsState): void => {
    setParams(writeResults(next), { replace: true, preventScrollReset: true })
  }
  const changeFilters = (change: Partial<LeadFilters>): void => {
    go({ ...state, filters: { ...state.filters, ...change }, page: 0 })
  }
  const clearFilters = (): void => {
    go({ ...state, filters: NO_FILTERS, page: 0 })
  }
  const openLead = (id: string): void => {
    setActive(id)
    go({ ...state, lead: id })
  }
  const closeLead = (): void => {
    if (state.lead !== null) {
      go({ ...state, lead: null })
    }
  }

  const filtersQuery = filterQuery(state.filters)
  const leads = useLeads(listQuery(state))
  const facets = useLeadFacets(filtersQuery)
  const map = useLeadMap(filtersQuery)
  const mapView = state.view === 'map'
  const filtered = activeFilterCount(state.filters) > 0
  const activeRow = state.lead ?? active

  const sorting: SortingState = [{ id: state.sort, desc: state.order === 'desc' }]
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater
    const key = SORT_KEYS.find((item) => item === next[0]?.id)
    if (!key) {
      return
    }
    const order = key === state.sort ? (state.order === 'desc' ? 'asc' : 'desc') : FIRST_ORDER[key]
    go({ ...state, sort: key, order, page: 0 })
  }

  const download = async (): Promise<void> => {
    setExporting(true)
    try {
      const file = await fetchLeadsCsv(exportQuery(state))
      saveFile(file.blob, file.filename)
    } catch (error) {
      toastProblem(error)
    } finally {
      setExporting(false)
    }
  }

  const page: LeadPage | undefined = leads.data
  const table = (columns: typeof TABLE_COLUMNS, label: string, dense: boolean) => (
    <DataTable
      label={label}
      columns={columns}
      data={page?.items ?? []}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={onSortingChange}
      page={{ pageIndex: state.page, pageSize: PAGE_SIZE, total: page?.total ?? 0 }}
      onPageChange={(pageIndex) => {
        go({ ...state, page: pageIndex })
      }}
      compact={dense}
      activeRowId={activeRow}
      onActiveRowChange={setActive}
      onOpenRow={openLead}
      onEscape={closeLead}
      loading={leads.isFetching}
      empty={<Empty filtered={filtered} onClear={clearFilters} />}
    />
  )

  return (
    <>
      <PageHeader
        title="Results"
        description="Every lead, best first. Open one to see why it fits, rule by rule."
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Show as"
              value={state.view}
              onValueChange={(view) => {
                if (view === 'table' || view === 'map') {
                  go({ ...state, view })
                }
              }}
            >
              <ToggleGroupItem value="table">
                <Table2 aria-hidden="true" />
                Table
              </ToggleGroupItem>
              <ToggleGroupItem value="map">
                <MapIcon aria-hidden="true" />
                Map
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting || (page?.total ?? 0) === 0}
              onClick={() => void download()}
            >
              <Download aria-hidden="true" />
              {exporting ? 'Preparing the CSV.' : 'Download CSV'}
            </Button>
          </>
        }
      />
      <FilterBar
        filters={state.filters}
        facets={facets.data}
        onChange={changeFilters}
        onClear={clearFilters}
        trailing={
          mapView ? null : (
            <DensityToggle
              compact={compact}
              onCompactChange={(next) => {
                setCompact(next)
                saveCompact(next)
              }}
            />
          )
        }
      />
      {leads.error ? (
        <ErrorState
          error={leads.error}
          context="The leads couldn't be loaded."
          onRetry={() => void leads.refetch()}
        />
      ) : mapView ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-[36rem] rounded-lg border bg-card"
        >
          <ResizablePanel defaultSize="42%" minSize="25%">
            <div className="h-full overflow-auto p-3">
              {table(LIST_COLUMNS, 'Leads beside the map', true)}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Resize the list and the map" />
          <ResizablePanel defaultSize="58%" minSize="30%">
            <div className="flex h-full flex-col gap-2 p-3">
              {map.error ? (
                <ErrorState error={map.error} context="The map couldn't be loaded." />
              ) : (
                <CityMap
                  label="Leads on the map"
                  points={map.data?.items ?? []}
                  activePointId={activeRow}
                  onSelectPoint={openLead}
                  approximate
                  fitToPoints
                />
              )}
              <MapNote map={map.data} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        table(TABLE_COLUMNS, 'Leads', compact)
      )}
      <LeadPanel leadId={state.lead} onClose={closeLead} />
    </>
  )
}
