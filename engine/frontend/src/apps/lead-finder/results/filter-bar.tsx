/**
 * The filters above the results (PLAN-V6, E3): one tidy bar.
 *
 * - On a laptop or a tablet: the name search, the three filters used most (Result, City, Source),
 *   then a "Filters" button that opens every other filter in one panel (sign, industry, HubSpot
 *   label, status, run, dates, score, office size, test leads). On a phone, every filter but the
 *   search sits in that panel, which rises from the bottom.
 * - Under the bar, the filters in use show as chips, each with an x, and "Clear all".
 * - A pick list is a Popover with Command, with the number of leads each choice would show. A date
 *   is a Popover with Calendar.
 *
 * Every change goes to the address at once (so a link shares the view), except typing: the search
 * and the number fields wait until typing pauses for 300 ms, so one request goes out per pause.
 */
import { CalendarDays, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import type { LeadFacets } from '@/api/types'
import { Pending } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
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
import { formatDate, formatDateTime, formatNumber, humanise, pluralise } from '@/lib/format'
import {
  HUBSPOT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  ORIGIN_LABELS,
  ORIGIN_ORDER,
  RESULT_LABELS,
  RESULT_ORDER,
  RUN_MODE_LABELS,
} from '@/lib/labels'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { activeChips, panelFilterCount } from './chips'
import { loadCalendar } from './lazy-parts'
import { dateOf, dayOf, oneOf, type LeadFilters } from './params'

// The calendar library is big, so the calendar is a file of its own (PLAN-V7 D1). Results asks for
// it when the browser is idle, and a date filter asks again when it is pointed at or opened.
const Calendar = lazy(loadCalendar)

/** The room a calendar takes, while it downloads. */
function CalendarPending() {
  return (
    <Pending label="Loading the calendar.">
      <Skeleton className="m-3 h-64 w-64" />
    </Pending>
  )
}

interface Option {
  value: string
  label: string
  count?: number
}

/**
 * An input that keeps what is typed, and hands it on once typing pauses. When the value changes
 * from outside (Clear all, or a chip's x), the field shows the new value.
 */
function SettledInput({
  value,
  onSettle,
  ...props
}: { value: string; onSettle: (value: string) => void } & Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange'
>) {
  const [text, setText] = useState(value)
  const [outside, setOutside] = useState(value)
  if (value !== outside) {
    setOutside(value)
    setText(value)
  }
  const settled = useDebounced(text)
  const settle = useEffectEvent((next: string) => {
    if (next !== value) {
      onSettle(next)
    }
  })
  useEffect(() => {
    settle(settled)
  }, [settled])
  return (
    <Input
      {...props}
      value={text}
      onChange={(event) => {
        const next =
          props.inputMode === 'numeric' ? event.target.value.replace(/\D/g, '') : event.target.value
        setText(next)
      }}
    />
  )
}

/** The options for a field: the facets' values, plus any picked value the facets no longer list. */
function withPicked(options: Option[], picked: readonly string[]): Option[] {
  const known = new Set(options.map((option) => option.value))
  return [
    ...options,
    ...picked
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: value, count: 0 })),
  ]
}

function countOf(values: LeadFacets['result'] | undefined, value: string): number {
  return values?.find((item) => item.value === value)?.count ?? 0
}

interface PickListProps {
  title: string
  options: Option[]
  picked: readonly string[]
  onChange: (values: string[]) => void
  /** One choice at a time (a run). */
  single?: boolean
  /** In the Filters panel the button fills its row. */
  block?: boolean
}

/** A field's choices in a popover, with a search box once the list is long. */
function PickList({
  title,
  options,
  picked,
  onChange,
  single = false,
  block = false,
}: PickListProps) {
  const [open, setOpen] = useState(false)
  const chosen = new Set(picked)
  const summary =
    picked.length === 0
      ? null
      : picked.length === 1
        ? (options.find((option) => option.value === picked[0])?.label ?? picked[0])
        : `${String(picked.length)} picked`
  const toggle = (value: string): void => {
    if (single) {
      onChange(chosen.has(value) ? [] : [value])
      setOpen(false)
      return
    }
    onChange(chosen.has(value) ? picked.filter((item) => item !== value) : [...picked, value])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-picked={picked.length > 0}
          className={cn(block && 'h-9 w-full justify-start touch:h-11')}
        >
          <ListFilter aria-hidden="true" />
          {/* The table has a column with the same name, so a screen reader hears the difference. */}
          <span className="sr-only">Filter by</span> {title}
          {summary ? (
            // The text shrinks inside the badge, so a long run name ends in "..." (a badge
            // centres its content, which would cut both ends).
            <Badge
              variant="outline"
              className={cn('max-w-40 justify-start', block && 'ml-auto max-w-56')}
              title={summary}
            >
              <span className="min-w-0 truncate">{summary}</span>
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          {options.length > 7 ? (
            <CommandInput placeholder={`Find a ${title.toLowerCase()}`} />
          ) : null}
          <CommandList aria-label={title}>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const on = chosen.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    data-checked={on}
                    onSelect={() => {
                      toggle(option.value)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {on ? <span className="sr-only">, picked</span> : null}
                    {option.count !== undefined ? (
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {formatNumber(option.count)}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {picked.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="clear these choices"
                    onSelect={() => {
                      onChange([])
                    }}
                  >
                    Clear {title.toLowerCase()}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface DateFilterProps {
  title: string
  from: string | null
  /** Left out for a "since" date: one day, not a range. */
  until?: string | null
  range?: boolean
  onChange: (from: string | null, until: string | null) => void
}

/** A date, or a range of dates, on a calendar. Future days can't be picked. */
function DateFilter({ title, from, until = null, range = false, onChange }: DateFilterProps) {
  const today = new Date()
  const summary =
    from && until
      ? `${formatDate(from)} to ${formatDate(until)}`
      : from
        ? `${range ? 'from' : 'since'} ${formatDate(from)}`
        : until
          ? `until ${formatDate(until)}`
          : null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full justify-start touch:h-11"
          onPointerEnter={() => void loadCalendar()}
          onFocus={() => void loadCalendar()}
        >
          <CalendarDays aria-hidden="true" />
          {/* The table has a column with the same name, so a screen reader hears the difference. */}
          <span className="sr-only">Filter by</span> {title}
          {summary ? (
            <Badge variant="outline" className="ml-auto">
              {summary}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Suspense fallback={<CalendarPending />}>
          {range ? (
            <Calendar
              mode="range"
              selected={{
                from: from ? dateOf(from) : undefined,
                to: until ? dateOf(until) : undefined,
              }}
              defaultMonth={from ? dateOf(from) : today}
              disabled={{ after: today }}
              onSelect={(picked) => {
                onChange(
                  picked?.from ? dayOf(picked.from) : null,
                  picked?.to ? dayOf(picked.to) : null,
                )
              }}
            />
          ) : (
            <Calendar
              mode="single"
              selected={from ? dateOf(from) : undefined}
              defaultMonth={from ? dateOf(from) : today}
              disabled={{ after: today }}
              onSelect={(picked) => {
                onChange(picked ? dayOf(picked) : null, null)
              }}
            />
          )}
        </Suspense>
        {from || until ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null, null)
              }}
            >
              Clear the dates
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value)
}

function numberOf(text: string): number | null {
  return text === '' ? null : Number(text)
}

/** A titled group of filters in the panel. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-ui font-semibold">{title}</h3>
      {children}
    </section>
  )
}

interface ControlsProps {
  filters: LeadFilters
  facets: LeadFacets | undefined
  onChange: (change: Partial<LeadFilters>) => void
}

/** The options of a fixed list, in its order, with the facets' counts. */
function fixed<T extends string>(
  labels: Record<T, string>,
  order: readonly T[],
  values?: LeadFacets['result'],
): Option[] {
  return order.map((value) => ({ value, label: labels[value], count: countOf(values, value) }))
}

/** The options of a list the leads themselves fill (cities, industries). */
function listed(values: LeadFacets['city'] | undefined, picked: readonly string[]): Option[] {
  return withPicked(
    (values ?? []).map((item) => ({ value: item.value, label: item.value, count: item.count })),
    picked,
  )
}

/** Result, City and Source: in the bar on a laptop, at the top of the panel on a phone. */
function MainFilters({
  filters,
  facets,
  onChange,
  block = false,
}: ControlsProps & { block?: boolean }) {
  return (
    <>
      <PickList
        title="Result"
        block={block}
        options={fixed(RESULT_LABELS, RESULT_ORDER, facets?.result)}
        picked={filters.result}
        onChange={(values) => {
          onChange({ result: oneOf(values, RESULT_LABELS) })
        }}
      />
      <PickList
        title="City"
        block={block}
        options={listed(facets?.city, filters.city)}
        picked={filters.city}
        onChange={(city) => {
          onChange({ city })
        }}
      />
      <PickList
        title="Source"
        block={block}
        options={fixed(ORIGIN_LABELS, ORIGIN_ORDER, facets?.origin)}
        picked={filters.origin}
        onChange={(values) => {
          onChange({ origin: oneOf(values, ORIGIN_LABELS) })
        }}
      />
    </>
  )
}

/** Everything that lives in the Filters panel, in groups. */
function PanelFilters({ filters, facets, onChange }: ControlsProps) {
  const sizes = facets?.office_m2
  const sizeRange =
    sizes && sizes.min !== null && sizes.max !== null
      ? `The leads here go from ${formatNumber(sizes.min)} to ${formatNumber(sizes.max)} m².`
      : 'Office size in square metres.'
  return (
    <>
      <Group title="The company">
        <PickList
          title="Sign"
          block
          options={withPicked(
            (facets?.trigger ?? []).map((item) => ({
              value: item.id,
              label: item.label,
              count: item.count,
            })),
            filters.trigger,
          )}
          picked={filters.trigger}
          onChange={(trigger) => {
            onChange({ trigger })
          }}
        />
        <PickList
          title="Industry"
          block
          options={listed(facets?.industry, filters.industry)}
          picked={filters.industry}
          onChange={(industry) => {
            onChange({ industry })
          }}
        />
        <PickList
          title="Industry group"
          block
          options={listed(facets?.industry_group, filters.industry_group)}
          picked={filters.industry_group}
          onChange={(values) => {
            onChange({ industry_group: values })
          }}
        />
      </Group>
      <Group title="HubSpot and status">
        <PickList
          title="HubSpot"
          block
          options={fixed(
            HUBSPOT_STATUS_LABELS,
            Object.keys(HUBSPOT_STATUS_LABELS) as (keyof typeof HUBSPOT_STATUS_LABELS)[],
            facets?.hubspot_status,
          )}
          picked={filters.hubspot_status}
          onChange={(values) => {
            onChange({ hubspot_status: oneOf(values, HUBSPOT_STATUS_LABELS) })
          }}
        />
        <PickList
          title="Status"
          block
          options={fixed(
            LEAD_STATUS_LABELS,
            Object.keys(LEAD_STATUS_LABELS) as (keyof typeof LEAD_STATUS_LABELS)[],
            facets?.status,
          )}
          picked={filters.status}
          onChange={(values) => {
            onChange({ status: oneOf(values, LEAD_STATUS_LABELS) })
          }}
        />
      </Group>
      <Group title="Run and dates">
        <PickList
          title="Run"
          single
          block
          options={withPicked(
            (facets?.runs ?? []).map((run) => ({
              value: run.id,
              label: `${formatDateTime(run.created_at)}, ${RUN_MODE_LABELS[run.mode] ?? humanise(run.mode)}`,
              count: run.count,
            })),
            filters.run_id ? [filters.run_id] : [],
          )}
          picked={filters.run_id ? [filters.run_id] : []}
          onChange={(values) => {
            onChange({ run_id: values[0] ?? null })
          }}
        />
        <DateFilter
          title="Researched"
          range
          from={filters.created_since}
          until={filters.created_until}
          onChange={(from, until) => {
            onChange({ created_since: from, created_until: until })
          }}
        />
        <DateFilter
          title="Sign since"
          from={filters.trigger_since}
          onChange={(from) => {
            onChange({ trigger_since: from })
          }}
        />
      </Group>
      <Group title="Score and size">
        <Field>
          <FieldLabel htmlFor="results-min-score">Lowest score</FieldLabel>
          <SettledInput
            id="results-min-score"
            inputMode="numeric"
            value={numberText(filters.min_score)}
            onSettle={(text) => {
              onChange({ min_score: numberOf(text) })
            }}
          />
          <FieldDescription>From 0 to 100.</FieldDescription>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="results-m2-min">Office from (m²)</FieldLabel>
            <SettledInput
              id="results-m2-min"
              inputMode="numeric"
              value={numberText(filters.office_m2_min)}
              onSettle={(text) => {
                onChange({ office_m2_min: numberOf(text) })
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="results-m2-max">Office to (m²)</FieldLabel>
            <SettledInput
              id="results-m2-max"
              inputMode="numeric"
              value={numberText(filters.office_m2_max)}
              onSettle={(text) => {
                onChange({ office_m2_max: numberOf(text) })
              }}
            />
          </Field>
        </div>
        <p className="text-caption text-muted-foreground">{sizeRange}</p>
      </Group>
      <Group title="Other">
        <Field orientation="horizontal">
          <Checkbox
            id="results-tests"
            checked={filters.include_tests}
            onCheckedChange={(checked) => {
              onChange({ include_tests: checked === true })
            }}
          />
          <FieldLabel htmlFor="results-tests" className="font-normal">
            Show test set leads too
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="results-facts-missing"
            checked={filters.facts_missing}
            onCheckedChange={(checked) => {
              onChange({ facts_missing: checked === true })
            }}
          />
          <FieldLabel htmlFor="results-facts-missing" className="font-normal">
            Only leads with facts missing (re-check them)
          </FieldLabel>
        </Field>
      </Group>
    </>
  )
}

/** The filters in use, as chips with an x each, and "Clear all". Nothing when none is in use. */
function FilterChips({
  filters,
  facets,
  onChange,
  onClear,
}: ControlsProps & { onClear: () => void }) {
  const chips = activeChips(filters, facets)
  if (chips.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label="Filters in use" className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border bg-card pl-2 text-caption touch:h-9"
          >
            <span className="min-w-0 truncate" title={chip.label}>
              {chip.label}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 shrink-0 touch:size-9"
              aria-label={`Remove ${chip.label}`}
              onClick={() => {
                onChange(chip.remove)
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="xs" onClick={onClear}>
        Clear all
      </Button>
    </div>
  )
}

export interface FilterBarProps {
  filters: LeadFilters
  facets: LeadFacets | undefined
  onChange: (change: Partial<LeadFilters>) => void
  onClear: () => void
  /** How many leads match now, for the panel's "Show 12 leads" button. */
  total?: number
  /** More buttons at the end of the bar (the row height toggle). */
  trailing?: ReactNode
}

export function FilterBar({ filters, facets, onChange, onClear, total, trailing }: FilterBarProps) {
  const phone = useMediaQuery(PHONE)
  const [panelOpen, setPanelOpen] = useState(false)
  const inPanel = panelFilterCount(filters, !phone)
  const controls = { filters, facets, onChange }
  const search = (
    <div className="relative w-64 max-sm:w-auto max-sm:flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <SettledInput
        aria-label="Search company names"
        placeholder="Company name"
        className="h-8 pl-8 touch:h-11 touch:pl-9"
        value={filters.q}
        onSettle={(q) => {
          onChange({ q })
        }}
      />
    </div>
  )
  const panel = (
    <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // The number alone would read as "Filters 2", so the name says what it counts.
          aria-label={inPanel > 0 ? `Filters, ${String(inPanel)} in use` : 'Filters'}
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {inPanel > 0 ? (
            <Badge variant="outline" aria-hidden="true">
              {inPanel}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        className={cn(
          'gap-0 overflow-y-auto',
          phone ? 'max-h-[85dvh]' : 'data-[side=right]:w-full data-[side=right]:sm:max-w-md',
        )}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>The list changes as you choose.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-4">
          {phone ? (
            <Group title="Result, city and source">
              <MainFilters {...controls} block />
            </Group>
          ) : null}
          <PanelFilters {...controls} />
        </div>
        <SheetFooter className="sticky bottom-0 mt-auto flex-row justify-between border-t bg-popover">
          <Button type="button" variant="ghost" onClick={onClear}>
            <X aria-hidden="true" />
            Clear all
          </Button>
          <Button
            type="button"
            onClick={() => {
              setPanelOpen(false)
            }}
          >
            {total === undefined ? 'Show the leads' : `Show ${pluralise(total, 'lead')}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
  return (
    <div className="flex flex-col gap-2">
      <div
        role="search"
        aria-label="Filter the leads"
        className="flex flex-wrap items-center gap-2"
      >
        {search}
        {phone ? null : <MainFilters {...controls} />}
        {panel}
        {/* A phone has room for the search and one button only; rows there are compact anyway. */}
        {trailing && !phone ? (
          <div className="ml-auto flex items-center gap-2">{trailing}</div>
        ) : null}
      </div>
      <FilterChips {...controls} onClear={onClear} />
    </div>
  )
}
