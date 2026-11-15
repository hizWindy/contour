/**
 * The company picker's search (DESIGN.md "shadcn parts": a combobox, Popover with Command,
 * filtering as you type). The server finds the matches, about 250ms after the last key. Two places
 * put it in their own popover: Log call on Activity ("Which company was the call with?", PLAN-V17
 * T3-6) and New pre-read on Meetings ("Which company is the meeting with?", T3-9).
 *
 * What is typed lives here, so it starts empty each time the popover opens.
 */
import { useState } from 'react'
import { useCompanySearch } from '@/api/hooks'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useDebounced } from '@/hooks/useDebounced'
import { companyPlace, FIND_COMPANY, LOOKING, NO_MATCH, TYPE_TWO } from './words'

/** Typed searches wait this long after the last key (DESIGN.md "Speed"). */
const SETTLE_MS = 250

export interface CompanyMatch {
  key: string
  name: string
}

export interface CompanySearchProps {
  /** The question, seen above the box and heard as its name: "Which company was the call with?" */
  label: string
  onPick: (company: CompanyMatch) => void
}

export function CompanySearch({ label, onPick }: CompanySearchProps) {
  const [text, setText] = useState('')
  const settled = useDebounced(text, SETTLE_MS)
  const search = useCompanySearch(settled)
  const query = settled.trim()
  const companies = query.length >= 2 ? (search.data?.companies ?? []) : []
  const typed = text.trim().length >= 2
  return (
    <>
      {/* Seen here; a screen reader hears it once, as the search box's name (`label`). */}
      <p aria-hidden="true" className="px-3 pt-3 pb-1 text-ui font-semibold text-foreground">
        {label}
      </p>
      <Command shouldFilter={false} label={label}>
        <CommandInput
          placeholder={FIND_COMPANY}
          value={text}
          className="touch:text-body"
          onValueChange={setText}
        />
        <CommandList aria-label={label}>
          {!typed ? (
            <p className="px-3 py-4 text-ui text-muted-foreground">{TYPE_TWO}</p>
          ) : companies.length === 0 ? (
            <p role="status" className="px-3 py-4 text-ui text-muted-foreground">
              {search.isFetching || text.trim() !== query ? LOOKING : NO_MATCH}
            </p>
          ) : (
            <CommandGroup>
              {companies.map((company) => {
                const place = companyPlace({ ...company, staff: null })
                return (
                  <CommandItem
                    key={company.key}
                    value={company.key}
                    onSelect={() => {
                      onPick({ key: company.key, name: company.name })
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{company.name}</span>
                      {place ? (
                        <span className="truncate text-caption text-muted-foreground">{place}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </>
  )
}
