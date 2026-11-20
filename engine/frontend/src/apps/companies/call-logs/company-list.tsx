/**
 * The company list inside Log call's panel (PLAN-V19 T2-2, choice 15), and inside Pick company for
 * a call saved before its company was found (PLAN-V24 T3-3: its own title and line, and the search
 * starts with the name as heard):
 *
 * - Focused search box on top (with a clear button once typed).
 * - With fewer than 2 letters typed: every company from `GET /companies` in newest-activity order,
 *   50 at a time, loading the next page as you scroll near the end.
 * - With 2 letters or more: `GET /companies/search` (250ms after the last key, as `company-search`
 *   does).
 * - Arrow keys move through the list and Enter picks; clicking a row picks too.
 *
 * Stays mounted inside `PushView` while the rep writes the note, so Back returns here with the
 * search and loaded companies intact.
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { api, unwrap } from '@/api/client'
import { useCompanySearch } from '@/api/hooks'
import { queryKeys } from '@/api/query'
import type { CompanyPage } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/utils'
import { PanelDescription, PanelTitle } from '../panel-title'
import { companyPlace, FIND_COMPANY, LOOKING, NO_MATCH } from '../words'
import { LOG_CALL } from '../call-notes/words'
import {
  COMPANIES_LOAD_FAILED,
  LOADING_COMPANIES,
  LOADING_MORE_COMPANIES,
  LOG_CALL_KEYS,
  NO_COMPANIES_YET,
  SHOW_MORE_COMPANIES,
  WHICH_COMPANY,
} from './words'

const PAGE_SIZE = 50
const SETTLE_MS = 250
const SCROLL_THRESHOLD_PX = 120

export interface CompanyPick {
  key: string
  name: string
}

interface CompanyEntry {
  key: string
  name: string
  subtitle: string
}

export interface CompanyListProps {
  /** Whether the list is currently on screen (not covered by the pushed NoteView). */
  active: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onPick: (company: CompanyPick) => void
  /** The panel's title: "Log call" unless given. */
  title?: string
  /** The line under it: "Which company was the call with?" unless given. */
  description?: string
  /** What the search starts with, like the name as heard: "North Wind". Empty unless given. */
  startWith?: string
}

export function CompanyList({
  active,
  inputRef,
  onPick,
  title = LOG_CALL,
  description = WHICH_COMPANY,
  startWith = '',
}: CompanyListProps) {
  const [text, setText] = useState(startWith)
  const settled = useDebounced(text, SETTLE_MS)
  const searching = text.trim().length >= 2
  const settledQuery = settled.trim()
  const search = useCompanySearch(settledQuery)

  const pages = useInfiniteQuery<CompanyPage>({
    queryKey: [...queryKeys.companies.lists(), 'log-call', PAGE_SIZE],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/companies', {
          params: {
            query: {
              sort: 'last_activity',
              limit: PAGE_SIZE,
              offset: typeof pageParam === 'number' ? pageParam : 0,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total && lastPage.items.length > 0 ? loaded : undefined
    },
    staleTime: 60_000,
  })

  const rows: CompanyEntry[] = searching
    ? settledQuery.length >= 2
      ? (search.data?.companies ?? []).map((company) => ({
          key: company.key,
          name: company.name,
          subtitle: companyPlace({ ...company, staff: null }),
        }))
      : []
    : (pages.data?.pages ?? []).flatMap((page) =>
        page.items.map((company) => ({
          key: company.key,
          name: company.name,
          subtitle: companyPlace(company),
        })),
      )

  const [cursor, setCursor] = useState<{ scope: string; index: number }>({ scope: '', index: 0 })
  const scope = searching ? `q:${settledQuery}` : 'all'
  const rawIndex = cursor.scope === scope ? cursor.index : 0
  const activeIndex = rows.length === 0 ? -1 : Math.min(Math.max(rawIndex, 0), rows.length - 1)

  const listRef = useRef<HTMLUListElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!active || activeIndex < 0) return
    const option = listRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    )
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' })
    }
  }, [active, activeIndex])

  // Load the next 50 companies when the bottom sentinel nears the viewport in browse mode.
  const canLoadMore = !searching && pages.hasNextPage && !pages.isFetchingNextPage
  const fetchNext = pages.fetchNextPage
  useEffect(() => {
    if (!active || !canLoadMore || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    const root = scrollerRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNext()
        }
      },
      { root, rootMargin: '120px' },
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [active, canLoadMore, fetchNext])

  const handleScroll = (): void => {
    if (!canLoadMore) return
    const element = scrollerRef.current
    if (!element) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_THRESHOLD_PX) {
      void fetchNext()
    }
  }

  const move = (next: number): void => {
    if (rows.length === 0) return
    const clamped = Math.min(Math.max(next, 0), rows.length - 1)
    setCursor({ scope, index: clamped })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(activeIndex + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(activeIndex - 1)
      return
    }
    if (event.key === 'Home' && rows.length > 0) {
      event.preventDefault()
      move(0)
      return
    }
    if (event.key === 'End' && rows.length > 0) {
      event.preventDefault()
      move(rows.length - 1)
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      const picked = rows[activeIndex]
      if (!picked) return
      event.preventDefault()
      onPick({ key: picked.key, name: picked.name })
    }
  }

  const activeId = activeIndex >= 0 ? `${listId}-${String(activeIndex)}` : undefined
  const awaitingSearch =
    searching && (text.trim() !== settledQuery || (search.isFetching && rows.length === 0))

  let content
  if (searching) {
    if (search.isError) {
      content = (
        <div className="p-5 max-sm:p-4">
          <ErrorState
            error={search.error}
            context={COMPANIES_LOAD_FAILED}
            onRetry={() => void search.refetch()}
          />
        </div>
      )
    } else if (awaitingSearch) {
      content = (
        <p role="status" className="px-5 py-6 text-ui text-muted-foreground max-sm:px-4">
          {LOOKING}
        </p>
      )
    } else if (rows.length === 0) {
      content = (
        <p role="status" className="px-5 py-6 text-ui text-muted-foreground max-sm:px-4">
          {NO_MATCH}
        </p>
      )
    } else {
      content = null
    }
  } else if (pages.isError) {
    content = (
      <div className="p-5 max-sm:p-4">
        <ErrorState
          error={pages.error}
          context={COMPANIES_LOAD_FAILED}
          onRetry={() => void pages.refetch()}
        />
      </div>
    )
  } else if (pages.isPending && rows.length === 0) {
    content = (
      <div className="p-5 max-sm:p-4">
        <Pending label={LOADING_COMPANIES}>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </Pending>
      </div>
    )
  } else if (rows.length === 0) {
    content = (
      <div className="p-5 max-sm:p-4">
        <EmptyState
          title={NO_COMPANIES_YET}
          description="The list fills from our HubSpot copy once companies are loaded."
          headingLevel={3}
        />
      </div>
    )
  } else {
    content = null
  }

  return (
    <div data-slot="log-call-list" className="flex h-full flex-col">
      <div className="glass-surface flex flex-col gap-3 border-b p-5 pr-14 max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pr-14">
        <div className="flex flex-col gap-0.5">
          <PanelTitle className="text-section">{title}</PanelTitle>
          <PanelDescription className="text-ui text-muted-foreground">
            {description}
          </PanelDescription>
        </div>
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            data-slot="company-search-input"
            type="text"
            role="combobox"
            aria-label={WHICH_COMPANY}
            aria-expanded={true}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder={FIND_COMPANY}
            value={text}
            className={cn('pr-9 pl-9 touch:text-body')}
            onChange={(event) => {
              setText(event.target.value)
            }}
            onKeyDown={onKeyDown}
          />
          {text !== '' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              className="absolute right-1.5"
              onClick={() => {
                setText('')
                inputRef.current?.focus()
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {content ?? (
          <>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={WHICH_COMPANY}
              className="divide-y"
            >
              {rows.map((company, index) => {
                const selected = index === activeIndex
                return (
                  <li
                    key={company.key}
                    id={`${listId}-${String(index)}`}
                    role="option"
                    aria-selected={selected}
                    data-option-index={index}
                    className={cn(
                      'flex cursor-pointer flex-col gap-0.5 px-5 py-3 text-ui transition-colors duration-(--duration-fast) ease-(--ease) touch:min-h-12 max-sm:px-4',
                      selected
                        ? 'bg-selected text-selected-foreground'
                        : 'text-foreground hover:bg-muted/60',
                    )}
                    onMouseEnter={() => {
                      setCursor({ scope, index })
                    }}
                    onClick={() => {
                      onPick({ key: company.key, name: company.name })
                    }}
                  >
                    <span className="truncate font-semibold">{company.name}</span>
                    {company.subtitle ? (
                      <span className="truncate text-caption text-muted-foreground">
                        {company.subtitle}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {!searching && pages.hasNextPage ? (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center border-t px-5 py-3"
              >
                {pages.isFetchingNextPage ? (
                  <p role="status" className="text-caption text-muted-foreground">
                    {LOADING_MORE_COMPANIES}
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void fetchNext()
                    }}
                  >
                    {SHOW_MORE_COMPANIES}
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="hidden border-t px-5 py-2 text-caption text-muted-foreground sm:block">
        {LOG_CALL_KEYS}
      </div>
    </div>
  )
}
