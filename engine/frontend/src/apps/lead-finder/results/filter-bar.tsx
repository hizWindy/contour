/**
 * The filters above the results: a name search, a pick list per field (Popover with Command, with
 * the number of leads each choice would show), the two dates (Popover with Calendar), and the rest
 * (score, office size, test leads) under "More filters".
 *
 * Every change goes to the address at once, except typing: the search and the number fields wait
 * until typing pauses for 300 ms, so one request goes out per pause.
 */
import { CalendarDays, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type ComponentProps, type ReactNode } from 'react'
import type { LeadFacets } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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
import { useDebounced } from '@/hooks/useDebounced'
import { formatDate, formatDateTime, formatNumber, humanise } from '@/lib/format'
import {
  HUBSPOT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  RESULT_LABELS,
  RESULT_ORDER,
  RUN_MODE_LABELS,
} from '@/lib/labels'
import { activeFilterCount, dateOf, dayOf, oneOf, type LeadFilters } from './params'

interface Option {
  value: string
  label: string
  count?: number
}

/**
 * An input that keeps what is typed, and hands it on once typing pauses. When the value changes
 * from outside (Clear filters), the field shows the new value.
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
}

/** A field's choices in a popover, with a search box once the list is long. */
function PickList({ title, options, picked, onChange, single = false }: PickListProps) {
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
        <Button type="button" variant="outline" size="sm" data-picked={picked.length > 0}>
          <ListFilter aria-hidden="true" />
          {/* The table has a column with the same name, so a screen reader hears the difference. */}
          <span className="sr-only">Filter by</span> {title}
          {summary ? (
            <Badge variant="outline" className="max-w-40 truncate">
              {summary}
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
        <Button type="button" variant="outline" size="sm">
          <CalendarDays aria-hidden="true" />
          {/* The table has a column with the same name, so a screen reader hears the difference. */}
          <span className="sr-only">Filter by</span> {title}
          {summary ? <Badge variant="outline">{summary}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
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

/** Score, office size and the test set: filters used less often. */
function MoreFilters({
  filters,
  facets,
  onChange,
}: {
  filters: LeadFilters
  facets: LeadFacets | undefined
  onChange: (change: Partial<LeadFilters>) => void
}) {
  const count =
    (filters.min_score !== null ? 1 : 0) +
    (filters.office_m2_min !== null || filters.office_m2_max !== null ? 1 : 0) +
    (filters.include_tests ? 1 : 0)
  const sizes = facets?.office_m2
  const sizeRange =
    sizes && sizes.min !== null && sizes.max !== null
      ? `The leads here go from ${formatNumber(sizes.min)} to ${formatNumber(sizes.max)} m².`
      : 'Office size in square metres.'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal aria-hidden="true" />
          More filters
          {count > 0 ? <Badge variant="outline">{count}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
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
        <Field orientation="horizontal">
          <Checkbox
            id="results-tests"
            checked={filters.include_tests}
            onCheckedChange={(checked) => {
              onChange({ include_tests: checked === true })
            }}
          />
          <FieldLabel htmlFor="results-tests">Show test set leads too</FieldLabel>
        </Field>
      </PopoverContent>
    </Popover>
  )
}

export interface FilterBarProps {
  filters: LeadFilters
  facets: LeadFacets | undefined
  onChange: (change: Partial<LeadFilters>) => void
  onClear: () => void
  /** More buttons at the end of the bar (the row height toggle). */
  trailing?: ReactNode
}

export function FilterBar({ filters, facets, onChange, onClear, trailing }: FilterBarProps) {
  const fixed = <T extends string>(
    labels: Record<T, string>,
    order: readonly T[],
    values?: LeadFacets['result'],
  ) => order.map((value) => ({ value, label: labels[value], count: countOf(values, value) }))
  const listed = (values: LeadFacets['city'] | undefined, picked: readonly string[]) =>
    withPicked(
      (values ?? []).map((item) => ({ value: item.value, label: item.value, count: item.count })),
      picked,
    )
  const active = activeFilterCount(filters)
  return (
    <div role="search" aria-label="Filter the leads" className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <SettledInput
          aria-label="Search company names"
          placeholder="Company name"
          className="h-8 pl-8"
          value={filters.q}
          onSettle={(q) => {
            onChange({ q })
          }}
        />
      </div>
      <PickList
        title="Result"
        options={fixed(RESULT_LABELS, RESULT_ORDER, facets?.result)}
        picked={filters.result}
        onChange={(values) => {
          onChange({ result: oneOf(values, RESULT_LABELS) })
        }}
      />
      <PickList
        title="City"
        options={listed(facets?.city, filters.city)}
        picked={filters.city}
        onChange={(city) => {
          onChange({ city })
        }}
      />
      <PickList
        title="Sign"
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
        options={listed(facets?.industry, filters.industry)}
        picked={filters.industry}
        onChange={(industry) => {
          onChange({ industry })
        }}
      />
      <PickList
        title="Industry group"
        options={listed(facets?.industry_group, filters.industry_group)}
        picked={filters.industry_group}
        onChange={(values) => {
          onChange({ industry_group: values })
        }}
      />
      <PickList
        title="HubSpot"
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
      <PickList
        title="Run"
        single
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
      <MoreFilters filters={filters} facets={facets} onChange={onChange} />
      {active > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  )
}
