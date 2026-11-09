/**
 * A field's choices in a popover, with a search box once the list is long, and the number each
 * choice would show. Results filters with it (PLAN-V6 E3), and the Start page's lease and tenure
 * run picks its industries with it (PLAN-V11 C3).
 */
import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface PickOption {
  value: string
  label: string
  count?: number
}

export interface PickListProps {
  title: string
  options: PickOption[]
  picked: readonly string[]
  onChange: (values: string[]) => void
  /** One choice at a time (a run). */
  single?: boolean
  /** In the Filters panel the button fills its row. */
  block?: boolean
  /** What the button says before the title, for a screen reader. */
  srPrefix?: string
}

/** A field's choices in a popover, with a search box once the list is long. */
export function PickList({
  title,
  options,
  picked,
  onChange,
  single = false,
  block = false,
  srPrefix = 'Filter by',
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
          <span className="sr-only">{srPrefix}</span> {title}
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
