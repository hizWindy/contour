/**
 * History's search and filters (PLAN-V18 T3-6), and how they fit a phone (Al-khair, 17 Nov 2026).
 *
 * - **On a laptop or tablet** they sit in the open, as before: the search, "Where it stands" and
 *   "When" on one line, and "How it went" as chips under it.
 * - **On a phone** they took 250px of a 844px screen before the first call showed. Now the search
 *   has one button beside it, "Filters", that opens a sheet from the bottom with all three
 *   (Results does the same). The filters in use stay in view as small chips with an x each, so a
 *   closed sheet never hides why the list is short. The sheet's own button says how many calls
 *   match ("Show 12 calls") and shuts it.
 * - **The search** (company, person, or words in the note) waits 250ms after the last key. Every
 *   filter lives in the address (`params.ts`), so Back and a link keep them.
 */
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react'
import type { CallNoteOptions, CallNoteOutcomeFilter } from '@/api/types'
import { ChipGroup, Segmented } from '@/components/motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useDebounced } from '@/hooks/useDebounced'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { SEARCH_MAX, type HistoryFilters, type HistoryWhen, type HistoryWhere } from './params'
import {
  CLEAR_ALL,
  FILTERS,
  FILTERS_HINT,
  FILTERS_IN_USE,
  filtersWords,
  HOW_IT_WENT,
  NO_OUTCOME,
  removeFilterWords,
  SEARCH_CALLS,
  SEARCH_PLACEHOLDER,
  showCallsWords,
  WHEN_LABEL,
  WHEN_WORDS,
  WHERE_IT_STANDS,
  WHERE_WORDS,
} from './words'

/** How long the search waits after the last key. */
const SEARCH_WAIT_MS = 250

/** One filter that is on, for the chips a phone shows under the search. */
interface ActiveFilter {
  key: 'where' | 'when' | 'outcome'
  label: string
}

/** The filters that are on, in the order the sheet lists them. The search shows in its own box. */
function activeFilters(filters: HistoryFilters): ActiveFilter[] {
  const active: ActiveFilter[] = []
  if (filters.where !== 'all') active.push({ key: 'where', label: WHERE_WORDS[filters.where] })
  if (filters.when !== 'all') active.push({ key: 'when', label: WHEN_WORDS[filters.when] })
  if (filters.outcome) {
    active.push({ key: 'outcome', label: filters.outcome === 'none' ? NO_OUTCOME : filters.outcome })
  }
  return active
}

/** The filters with one turned off. The search stays. */
function without(filters: HistoryFilters, key: ActiveFilter['key']): HistoryFilters {
  if (key === 'where') return { ...filters, where: 'all' }
  if (key === 'when') return { ...filters, when: 'all' }
  return { ...filters, outcome: null }
}

interface ToolbarProps {
  filters: HistoryFilters
  options: CallNoteOptions
  onChange: (filters: HistoryFilters) => void
  searchRef: RefObject<HTMLInputElement | null>
  /** How many calls match now, for the sheet's button on a phone. */
  total?: number
}

/** The box answers each key at once; the address (and the server) hear it 250ms after the last. */
function SearchBox({
  filters,
  onChange,
  searchRef,
  className,
}: Pick<ToolbarProps, 'filters' | 'onChange' | 'searchRef'> & { className?: string }) {
  const [text, setText] = useState(filters.q)
  const waited = useDebounced(text, SEARCH_WAIT_MS)
  const [shownQ, setShownQ] = useState(filters.q)
  if (filters.q !== shownQ) {
    setShownQ(filters.q)
    // The filters were cleared, or Back changed them: the box follows. A change that came from the
    // box itself leaves it alone, so a key typed meanwhile is never lost.
    if (filters.q.trim() !== waited.trim()) setText(filters.q)
  }
  useEffect(() => {
    if (waited.trim() !== filters.q.trim()) onChange({ ...filters, q: waited })
    // `onChange` changes with the address; the search only follows the waited text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waited])
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={searchRef}
        type="search"
        aria-label={SEARCH_CALLS}
        aria-keyshortcuts="/"
        placeholder={SEARCH_PLACEHOLDER}
        maxLength={SEARCH_MAX}
        value={text}
        className="pl-9 touch:text-body"
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
    </div>
  )
}

/** The words of each "Where it stands" choice, in order. */
const WHERES = Object.keys(WHERE_WORDS) as HistoryWhere[]

const WHENS: readonly HistoryWhen[] = ['week', 'month', 'all']

function WhenChoice({ filters, onChange }: Pick<ToolbarProps, 'filters' | 'onChange'>) {
  return (
    <Segmented<HistoryWhen>
      aria-label={WHEN_LABEL}
      size="sm"
      value={filters.when}
      onChange={(when) => {
        onChange({ ...filters, when })
      }}
      options={WHENS.map((value) => ({ value, label: WHEN_WORDS[value] }))}
    />
  )
}

/** "How it went": HubSpot's six outcomes and "No outcome", one or none. */
function OutcomeChoice({
  filters,
  options,
  onChange,
  labelledBy,
}: Pick<ToolbarProps, 'filters' | 'options' | 'onChange'> & { labelledBy: string }) {
  const outcomes = [
    ...options.outcomes.map((value) => ({ value, label: value })),
    { value: 'none' as const, label: NO_OUTCOME },
  ]
  return (
    <ChipGroup<CallNoteOutcomeFilter>
      mode="one-or-none"
      aria-labelledby={labelledBy}
      options={outcomes}
      value={filters.outcome ? [filters.outcome] : []}
      onChange={([picked]) => {
        onChange({ ...filters, outcome: picked ?? null })
      }}
    />
  )
}

/** The search, the filters, and "How it went", all in the open (a laptop or a tablet). */
function WideToolbar({ filters, options, onChange, searchRef }: ToolbarProps) {
  const outcomeId = useId()
  const whereId = useId()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          filters={filters}
          onChange={onChange}
          searchRef={searchRef}
          className="min-w-56 flex-1"
        />
        <span id={whereId} className="sr-only">
          {WHERE_IT_STANDS}
        </span>
        <Select
          value={filters.where}
          onValueChange={(value) => {
            onChange({ ...filters, where: value as HistoryWhere })
          }}
        >
          <SelectTrigger aria-labelledby={whereId} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WHERES.map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'all' ? `${WHERE_IT_STANDS}: ${WHERE_WORDS.all}` : WHERE_WORDS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WhenChoice filters={filters} onChange={onChange} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={outcomeId} className="text-caption text-muted-foreground">
          {HOW_IT_WENT}
        </span>
        <OutcomeChoice
          filters={filters}
          options={options}
          onChange={onChange}
          labelledBy={outcomeId}
        />
      </div>
    </div>
  )
}

/** A titled group of choices inside the sheet. */
function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-ui font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** The search and one Filters button; the rest is in a sheet (a phone). */
function PhoneToolbar({ filters, options, onChange, searchRef, total }: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const whereId = useId()
  const whenId = useId()
  const outcomeId = useId()
  const active = activeFilters(filters)
  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="flex items-center gap-2">
        <SearchBox
          filters={filters}
          onChange={onChange}
          searchRef={searchRef}
          className="min-w-0 flex-1"
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              // The number alone would read as "Filters 2", so the name says what it counts.
              aria-label={filtersWords(active.length)}
            >
              <SlidersHorizontal aria-hidden="true" />
              {FILTERS}
              {active.length > 0 ? (
                <Badge variant="outline" aria-hidden="true">
                  {active.length}
                </Badge>
              ) : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{FILTERS}</SheetTitle>
              <SheetDescription>{FILTERS_HINT}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-4">
              <Group title={WHERE_IT_STANDS} id={whereId}>
                <ChipGroup<HistoryWhere>
                  mode="one"
                  aria-labelledby={whereId}
                  options={WHERES.map((value) => ({ value, label: WHERE_WORDS[value] }))}
                  value={[filters.where]}
                  onChange={([picked]) => {
                    if (picked) onChange({ ...filters, where: picked })
                  }}
                />
              </Group>
              <Group title={WHEN_LABEL} id={whenId}>
                <WhenChoice filters={filters} onChange={onChange} />
              </Group>
              <Group title={HOW_IT_WENT} id={outcomeId}>
                <OutcomeChoice
                  filters={filters}
                  options={options}
                  onChange={onChange}
                  labelledBy={outcomeId}
                />
              </Group>
            </div>
            <SheetFooter className="sticky bottom-0 mt-auto flex-row justify-between border-t bg-popover">
              <Button
                type="button"
                variant="ghost"
                disabled={active.length === 0}
                onClick={() => {
                  onChange({ ...filters, where: 'all', when: 'all', outcome: null })
                }}
              >
                <X aria-hidden="true" />
                {CLEAR_ALL}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false)
                }}
              >
                {showCallsWords(total)}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label={FILTERS_IN_USE} className="flex flex-wrap items-center gap-2">
            {active.map((filter) => (
              <li
                key={filter.key}
                className="inline-flex h-9 max-w-full items-center gap-1 rounded-md border bg-card pl-2.5 text-caption"
              >
                <span className="min-w-0 truncate">{filter.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-9 shrink-0"
                  aria-label={removeFilterWords(filter.label)}
                  onClick={() => {
                    onChange(without(filters, filter.key))
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="touch:h-9"
            onClick={() => {
              onChange({ ...filters, where: 'all', when: 'all', outcome: null })
            }}
          >
            {CLEAR_ALL}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** History's search and filters: all in the open, or behind one button on a phone. */
export function HistoryToolbar(props: ToolbarProps) {
  const phone = useMediaQuery(PHONE)
  return phone ? <PhoneToolbar {...props} /> : <WideToolbar {...props} />
}
