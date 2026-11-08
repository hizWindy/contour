/**
 * Results: every lead, in a table or as a list beside a map.
 *
 * - The filters, sort, page, view and the open lead live in the address (`params.ts`), so a link
 *   or Back shows the same list. A filter change goes back to page 1.
 * - One filter bar (`filter-bar.tsx`): the search and the three filters used most, a Filters panel
 *   for the rest, and the filters in use as chips under it.
 * - Table (F3a): sort by any column header, compact rows, CSV download of what matches.
 * - Map (F3b): the list and the map side by side, with a divider to drag (on a phone, the map
 *   above the list). Pins are coloured by result and sit at an approximate place.
 * - A click on a row or a pin opens the lead card in a side panel. J and K move through the rows,
 *   Enter opens the active one and Esc closes the panel.
 * - For one run (`?run_id=...`, the link in the run email) it is the review page (PLAN-V9 C3):
 *   tick boxes, and a bar to approve leads for HubSpot, reject them or watch them.
 */
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { Download, Map as MapIcon, Table2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  fetchLeadsCsv,
  leadMapQueryOptions,
  leadQueryOptions,
  useLeadFacets,
  useLeadMap,
  useLeads,
} from '@/api/hooks'
import type { LeadPage, MapOut } from '@/api/types'
import { CityMap } from '@/components/city-map'
import { DataTable, DensityToggle } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Pending } from '@/components/skeletons'
import { whenIdle } from '@/lib/idle'
import { saveFile } from '@/lib/download'
import { useIsMobile } from '@/lib/use-mobile'
import { formatNumber, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { sparing } from '@/shell/preload'
import { listColumns, tableColumns, type Tick } from './columns'
import { FilterBar } from './filter-bar'
import { LeadPanel } from './lead-panel'
import { ReviewBar } from './review-bar'
import { loadCalendar, loadMapSplit } from './lazy-parts'
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

const MapSplit = lazy(loadMapSplit)

/** The room the list and the map take, while the code that divides it downloads. */
function MapSplitPending() {
  return (
    <Pending label="Loading the map view.">
      <div className="min-h-[36rem] rounded-lg border bg-card" />
    </Pending>
  )
}

export default function ResultsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const state = readResults(params)
  const [compact, setCompact] = useState(savedCompact)
  const [active, setActive] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()

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
  // A pointer resting on a row: the card it opens starts loading (PLAN-V7 C2).
  const startLead = (id: string): void => {
    if (!sparing()) {
      void queryClient.prefetchQuery(leadQueryOptions(id))
    }
  }
  const closeLead = (): void => {
    if (state.lead !== null) {
      go({ ...state, lead: null })
    }
  }

  // The full page opens after the list has dropped the panel from its address, so Back returns to
  // the list as it was (same filters and sort), not to the list with the panel open.
  const openFullPage = (id: string): void => {
    void (async () => {
      await navigate(
        { search: writeResults({ ...state, lead: null }).toString() },
        { replace: true, preventScrollReset: true },
      )
      await navigate(`/leads/${id}`)
    })()
  }

  const filtersQuery = filterQuery(state.filters)
  const leads = useLeads(listQuery(state))
  const facets = useLeadFacets(filtersQuery)
  const mapView = state.view === 'map'
  // Up to 2,000 pins: asked for in the map view only. A pointer resting on the Map button, or the
  // browser being idle after the page shows, starts it, so the map view opens with its pins.
  const map = useLeadMap(filtersQuery, { enabled: mapView })
  const startMap = (): void => {
    if (!sparing()) {
      void queryClient.prefetchQuery(leadMapQueryOptions(filtersQuery))
    }
  }
  const startParts = useEffectEvent((): void => {
    void loadMapSplit()
    void loadCalendar()
    startMap()
  })
  useEffect(() => (sparing() ? undefined : whenIdle(startParts)), [])
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
  // The review page: one run's leads, with tick boxes (PLAN-V9 C3). The ticks stay while you page
  // through the run, and go when you leave it.
  const reviewRun = state.filters.run_id
  const [ticked, setTicked] = useState<{ run: string | null; ids: ReadonlySet<string> }>({
    run: null,
    ids: new Set(),
  })
  const selected = useMemo(
    () => (ticked.run === reviewRun ? ticked.ids : new Set<string>()),
    [ticked, reviewRun],
  )
  const pageIds = useMemo(() => (page?.items ?? []).map((row) => row.id), [page])
  const tick: Tick | undefined = useMemo(
    () =>
      reviewRun
        ? {
            selected,
            pageIds,
            onToggle: (id, on) => {
              const next = new Set(selected)
              if (on) next.add(id)
              else next.delete(id)
              setTicked({ run: reviewRun, ids: next })
            },
            onTogglePage: (on) => {
              const next = new Set(selected)
              for (const id of pageIds) {
                if (on) next.add(id)
                else next.delete(id)
              }
              setTicked({ run: reviewRun, ids: next })
            },
          }
        : undefined,
    [reviewRun, selected, pageIds],
  )
  const untick = (ids: string[]): void => {
    const next = new Set(selected)
    for (const id of ids) next.delete(id)
    setTicked({ run: reviewRun, ids: next })
  }
  const mapPart = (
    <div className="flex flex-col gap-2">
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
  )
  const table = (columns: ReturnType<typeof tableColumns>, label: string, dense: boolean) => (
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
      onRowIntent={startLead}
      onEscape={closeLead}
      loading={leads.isFetching}
      empty={<Empty filtered={filtered} onClear={clearFilters} />}
    />
  )

  return (
    <>
      <PageHeader
        icon={Table2}
        tone="lead"
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
              <ToggleGroupItem value="map" onPointerEnter={startMap} onFocus={startMap}>
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
      {reviewRun && tick ? <ReviewBar runId={reviewRun} tick={tick} onDone={untick} /> : null}
      <FilterBar
        filters={state.filters}
        facets={facets.data}
        onChange={changeFilters}
        onClear={clearFilters}
        total={page?.total}
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
        isMobile ? (
          // A phone has no room for two columns: the map comes first, then the list.
          <div className="flex flex-col gap-4">
            {mapPart}
            {table(listColumns(tick), 'Leads beside the map', true)}
          </div>
        ) : (
          <Suspense fallback={<MapSplitPending />}>
            <MapSplit list={table(listColumns(tick), 'Leads beside the map', true)} map={mapPart} />
          </Suspense>
        )
      ) : (
        table(tableColumns(tick), 'Leads', compact)
      )}
      <LeadPanel
        leadId={state.lead}
        onClose={closeLead}
        onOpenFullPage={openFullPage}
        rows={page?.items}
      />
    </>
  )
}
