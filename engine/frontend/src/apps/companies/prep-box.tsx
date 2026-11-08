/**
 * The prep box (PLAN-V10 D1): "Who are you calling?". It finds people and companies as you type
 * and opens the call prep for the one you pick. It never filters the list below it.
 *
 * - "/" puts the cursor in it from anywhere on the page. Up and Down move through the matches,
 *   Enter picks one, Esc closes the list.
 * - A person opens their prep at once. A company asks "Who are you calling?" first.
 * - "Today" chips reopen my preps from today without a new search.
 * - On a phone it sticks to the top of the page.
 */
import { Command as CommandPrimitive } from 'cmdk'
import {
  Building2,
  CircleAlert,
  CircleDashed,
  Hourglass,
  PhoneCall,
  Search,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCompanySearch, useTodayPreps } from '@/api/hooks'
import type { PrepChip } from '@/api/types'
import { CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { useDebounced } from '@/hooks/useDebounced'

export interface PrepPerson {
  id: string
  name: string
  title: string | null
}

/** What the prep modal opens on. */
export interface PrepTarget {
  companyKey: string
  companyName: string
  person: PrepPerson | null
  /** A cold call to the switchboard, picked in "Who are you calling?". */
  cold?: boolean
  /** A saved prep to reopen (a "Today" chip). */
  prepId?: string
}

/** How long the box waits after the last key before it asks. Short: matches should feel live. */
const SETTLE_MS = 150

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** "/" from anywhere puts the cursor in the box, unless you are typing or a dialog is open. */
function useSlashToFocus(input: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(EDITABLE) || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [input])
}

function chipLabel(chip: PrepChip): string {
  return chip.person_name
    ? `${chip.person_name} · ${chip.company_name}`
    : `${chip.company_name} · cold call`
}

function TodayChips({ onPick }: { onPick: (target: PrepTarget) => void }) {
  const today = useTodayPreps()
  const chips = today.data ?? []
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-muted-foreground">Today</span>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          // Keyed by id, so a new chip fades in at the start of the row and the rest stay put.
          <li key={chip.id} className="animate-in duration-150 fade-in-0">
            <button
              type="button"
              onClick={() => {
                onPick({
                  companyKey: chip.company_key,
                  companyName: chip.company_name,
                  person: null,
                  prepId: chip.id,
                })
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2 text-caption font-semibold transition-colors hover:bg-muted touch:h-11"
            >
              {chip.status === 'searching' ? (
                <Hourglass aria-hidden="true" className="size-3.5 text-muted-foreground" />
              ) : chip.status === 'failed' ? (
                <CircleAlert aria-hidden="true" className="size-3.5 text-destructive" />
              ) : (
                <PhoneCall aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              {chipLabel(chip)}
              {chip.status === 'ready' ? null : (
                <span className="sr-only">
                  {chip.status === 'searching' ? ' (still searching)' : ' (failed)'}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PrepBox({ onPick }: { onPick: (target: PrepTarget) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const settled = useDebounced(text, SETTLE_MS)
  const search = useCompanySearch(settled)
  useSlashToFocus(input)

  const query = settled.trim()
  const people = query.length >= 2 ? (search.data?.people ?? []) : []
  const companies = query.length >= 2 ? (search.data?.companies ?? []) : []
  const showList = open && text.trim().length >= 2
  const waiting = search.isFetching && people.length === 0 && companies.length === 0

  const pick = (target: PrepTarget): void => {
    setText('')
    setOpen(false)
    onPick(target)
  }

  return (
    <section
      aria-labelledby="prep-box-title"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 max-sm:sticky max-sm:top-0 max-sm:z-20"
    >
      <h2
        id="prep-box-title"
        className="flex items-center gap-2 text-ui font-semibold text-foreground"
      >
        <PhoneCall aria-hidden="true" className="size-4 text-muted-foreground" />
        Prep a call
      </h2>
      <CommandPrimitive shouldFilter={false} loop label="Who are you calling?" className="relative">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <CommandPrimitive.Input
            ref={input}
            value={text}
            onValueChange={(next) => {
              setText(next)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
            }}
            onBlur={() => {
              setOpen(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && open) {
                event.preventDefault()
                setOpen(false)
              }
            }}
            maxLength={120}
            placeholder="Who are you calling? Person or company"
            aria-label="Who are you calling? A person or a company"
            className="h-11 w-full rounded-lg border border-input bg-background pr-12 pl-10 text-body outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card touch:h-12"
          />
          <Kbd className="absolute top-1/2 right-3 -translate-y-1/2 touch:hidden">/</Kbd>
        </div>
        {showList ? (
          <div
            // A click on a match must land before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            className="absolute top-full right-0 left-0 z-30 mt-2 animate-in rounded-lg border bg-popover p-1 shadow-float duration-150 fade-in-0"
          >
            <CommandList className="max-h-96">
              {waiting ? (
                <p role="status" className="px-3 py-3 text-ui text-muted-foreground">
                  Looking.
                </p>
              ) : people.length === 0 && companies.length === 0 ? (
                <p role="status" className="px-3 py-3 text-ui text-muted-foreground">
                  {search.isFetching
                    ? 'Looking.'
                    : 'Nobody and no company matches. Check the spelling, or try part of the name.'}
                </p>
              ) : null}
              {people.length > 0 ? (
                <CommandGroup heading="People">
                  {people.map((person) => (
                    <CommandItem
                      key={`person-${person.id}`}
                      value={`person-${person.id}`}
                      onSelect={() => {
                        pick({
                          companyKey: person.company_key ?? '',
                          companyName: person.company_name ?? 'Unknown company',
                          person: { id: person.id, name: person.name, title: person.title },
                        })
                      }}
                      disabled={!person.company_key}
                      className="py-2"
                    >
                      <UserRound aria-hidden="true" className="text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{person.name}</span>
                        <span className="truncate text-caption text-muted-foreground">
                          {[person.title, person.company_name].filter(Boolean).join(' · ') ||
                            'No title on record'}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {companies.length > 0 ? (
                <CommandGroup heading="Companies">
                  {companies.map((company) => (
                    <CommandItem
                      key={`company-${company.key}`}
                      value={`company-${company.key}`}
                      onSelect={() => {
                        pick({ companyKey: company.key, companyName: company.name, person: null })
                      }}
                      className="py-2"
                    >
                      <Building2 aria-hidden="true" className="text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{company.name}</span>
                        <span className="flex min-w-0 items-center gap-1 truncate text-caption text-muted-foreground">
                          {company.source === 'lead' ? (
                            <>
                              <CircleDashed aria-hidden="true" className="size-3.5" />
                              Not in HubSpot yet
                            </>
                          ) : (
                            [company.city, company.industry].filter(Boolean).join(' · ') ||
                            'In HubSpot'
                          )}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </div>
        ) : null}
      </CommandPrimitive>
      <TodayChips onPick={pick} />
    </section>
  )
}
