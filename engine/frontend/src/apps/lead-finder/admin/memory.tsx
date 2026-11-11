/** Admin, Memory: search what the engine remembers about companies (source notes, profiles). */
import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useMemorySearch } from '@/api/hooks'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatDate, formatPercent, humanise } from '@/lib/format'

export default function AdminMemoryTab() {
  const [text, setText] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const results = useMemorySearch(query ? { q: query, limit: 20 } : null)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = text.trim()
    setQuery(trimmed === '' ? null : trimmed)
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" role="search">
        <Field className="max-w-md flex-1">
          <FieldLabel htmlFor="memory-q">Search memory</FieldLabel>
          <Input
            id="memory-q"
            value={text}
            placeholder="Melbourne lease ending 2027"
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
        </Field>
        <Button type="submit">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>
      {results.error ? (
        <ErrorState error={results.error} context="Memory couldn't be searched." />
      ) : null}
      {query === null ? (
        <EmptyState
          icon={Search}
          title="Search what the engine remembers."
          description="Notes from sources, company profiles and how leads turned out. Closest first."
          headingLevel={3}
        />
      ) : results.data && results.data.length === 0 ? (
        <EmptyState title="Nothing close to that." headingLevel={3} />
      ) : (
        <ul aria-label="Memory results" className="flex flex-col">
          {(results.data ?? []).map((hit) => (
            <li
              key={hit.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b py-3 text-ui last:border-b-0"
            >
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                {hit.subject ? (
                  <span className="font-semibold text-foreground">{hit.subject}</span>
                ) : null}
                <span>{humanise(hit.kind)}</span>
                {hit.source_date ? <span>{formatDate(hit.source_date)}</span> : null}
              </p>
              <span className="text-caption text-muted-foreground tabular-nums">
                {formatPercent(hit.similarity * 100)} close
              </span>
              <p className="col-span-2 line-clamp-2" title={hit.content}>
                {hit.content}
              </p>
              <span className="col-span-2 text-caption">
                {hit.url ? <SourceLink href={hit.url} /> : 'No web source: from a run or HubSpot.'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
