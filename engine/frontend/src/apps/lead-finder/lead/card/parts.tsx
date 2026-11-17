/**
 * Small parts every tab of the lead card uses: a titled section, a list that shows its first three
 * items with "Show all" (PLAN-V6, F1), so a long list never pushes the rest off the screen, and the
 * quiet mark on a sign the search found that the research didn't check (PLAN-V21 T1-8).
 */
import { ChevronDown, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Section({
  title,
  children,
  className,
  aside,
}: {
  title: string
  children: ReactNode
  className?: string
  /** A few quiet words at the right of the title, like "Medium confidence". */
  aside?: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section font-semibold">{title}</CardTitle>
        {aside ? <CardAction className="text-ui text-muted-foreground">{aside}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-ui">{children}</CardContent>
    </Card>
  )
}

export interface ShowFirstProps<T> {
  items: readonly T[]
  /** Names the list for a screen reader, like "Signs of an office change". */
  label: string
  render: (item: T, index: number) => ReactNode
  keyOf: (item: T, index: number) => string
  /** How many show before "Show all". */
  limit?: number
  className?: string
}

/** The first few items of a list, and a button for the rest. */
export function ShowFirst<T>({
  items,
  label,
  render,
  keyOf,
  limit = 3,
  className,
}: ShowFirstProps<T>) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, limit)
  const hidden = items.length - limit
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={label} className={cn('flex flex-col gap-3', className)}>
        {shown.map((item, index) => (
          <li key={keyOf(item, index)}>{render(item, index)}</li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          aria-expanded={all}
          onClick={() => {
            setAll((open) => !open)
          }}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('transition-transform duration-150 ease-standard', all && 'rotate-180')}
          />
          {all ? 'Show fewer' : `Show all ${formatNumber(items.length)}`}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * A sign discovery found that the research didn't find again (PLAN-V21 T1-8): its link was among
 * the pages the search read and it passed the date check, but nobody checked it since. A quiet
 * mark, an icon and the words in muted text, like where a company came from.
 */
export function FromSearchMark({ className }: { className?: string }) {
  return (
    <span
      data-slot="from-search"
      className={cn('inline-flex items-center gap-1 text-caption text-muted-foreground', className)}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      From the search, not checked by the research
    </span>
  )
}
