/**
 * The Companies filter bar. It only filters the list: the prep box above it preps calls (PLAN-V10
 * B4). A search (name, website, industry), the city, the owner, the deal and, for people with the
 * Lead Finder tick, where the company came from. The search settles 300 ms after the last key, so
 * one request goes out per pause.
 */
import { Search, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import type { CompanyFacets, DealState } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useDebounced } from '@/hooks/useDebounced'
import { formatNumber, pluralise } from '@/lib/format'
import { activeFilterCount, type CompanyFilters, type Source } from './params'

const ANY = 'any'

const DEAL_LABELS: Record<DealState, string> = {
  open: 'Open deal',
  customer: 'Customer',
  none: 'No deal',
}

const SOURCE_LABELS: Record<Source, string> = {
  hubspot: 'In HubSpot',
  lead: 'Not in HubSpot yet',
}

function SearchBox({ value, onSettle }: { value: string; onSettle: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [outside, setOutside] = useState(value)
  if (value !== outside) {
    setOutside(value)
    setText(value)
  }
  const settled = useDebounced(text)
  const settle = useEffectEvent((next: string) => {
    if (next !== value) onSettle(next)
  })
  useEffect(() => {
    settle(settled)
  }, [settled])
  return (
    <div className="relative w-72 max-sm:w-full">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Filter companies by name, website or industry"
        placeholder="Filter companies"
        className="h-8 pl-8 touch:h-11 touch:pl-9"
        value={text}
        maxLength={200}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
    </div>
  )
}

function Choice({
  label,
  anyLabel,
  value,
  options,
  onChange,
}: {
  label: string
  anyLabel: string
  value: string | null
  options: { value: string; label: string; count?: number }[]
  onChange: (value: string | null) => void
}) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => {
        onChange(next === ANY ? null : next)
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-36 touch:h-11">
        <SelectValue placeholder={anyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex w-full items-center justify-between gap-4">
              <span>{option.label}</span>
              {option.count === undefined ? null : (
                <span className="text-caption text-muted-foreground tabular-nums">
                  {formatNumber(option.count)}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export interface FilterBarProps {
  filters: CompanyFilters
  facets: CompanyFacets | undefined
  /** True when this person sees the Lead Finder's rows (its tick). */
  leadsShown: boolean
  onChange: (change: Partial<CompanyFilters>) => void
  onClear: () => void
  total: number | undefined
  trailing?: ReactNode
}

export function FilterBar({
  filters,
  facets,
  leadsShown,
  onChange,
  onClear,
  total,
  trailing,
}: FilterBarProps) {
  const cities = (facets?.cities ?? []).map((item) => ({
    value: item.value,
    label: item.value,
    count: item.count,
  }))
  const owners = (facets?.owners ?? []).map((item) => ({
    value: item.value,
    label: item.value,
    count: item.count,
  }))
  // A picked owner the list no longer offers still shows as picked.
  if (filters.owner && !owners.some((item) => item.value === filters.owner)) {
    owners.unshift({ value: filters.owner, label: filters.owner, count: 0 })
  }
  const active = activeFilterCount(filters)
  return (
    <div role="search" aria-label="Filter companies" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={filters.q}
          onSettle={(q) => {
            onChange({ q })
          }}
        />
        <Choice
          label="City"
          anyLabel="Any city"
          value={filters.city}
          options={cities}
          onChange={(city) => {
            onChange({ city })
          }}
        />
        <Choice
          label="Owner"
          anyLabel="Any owner"
          value={filters.owner}
          options={owners}
          onChange={(owner) => {
            onChange({ owner })
          }}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Deal"
          value={filters.deal ?? ANY}
          onValueChange={(deal) => {
            // Pressing the chosen one again gives "" in a single toggle group: back to any.
            onChange({ deal: deal === '' || deal === ANY ? null : (deal as DealState) })
          }}
        >
          <ToggleGroupItem value={ANY}>Any deal</ToggleGroupItem>
          {(Object.keys(DEAL_LABELS) as DealState[]).map((deal) => (
            <ToggleGroupItem key={deal} value={deal}>
              {DEAL_LABELS[deal]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {leadsShown ? (
          <Choice
            label="Where it came from"
            anyLabel="HubSpot and leads"
            value={filters.source}
            options={(Object.keys(SOURCE_LABELS) as Source[]).map((source) => ({
              value: source,
              label: SOURCE_LABELS[source],
            }))}
            onChange={(source) => {
              onChange({ source: source as Source | null })
            }}
          />
        ) : null}
        {active > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
        {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
      </div>
      <p className="text-caption text-muted-foreground" aria-live="polite">
        {total === undefined
          ? ' '
          : active > 0
            ? `${pluralise(total, 'company', 'companies')} match`
            : `${pluralise(total, 'company', 'companies')}`}
      </p>
    </div>
  )
}
