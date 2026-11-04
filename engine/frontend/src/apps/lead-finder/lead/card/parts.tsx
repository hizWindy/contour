/**
 * Small parts every tab of the lead card uses: a titled section, and a list that shows its first
 * three items with "Show all" (PLAN-V6, F1), so a long list never pushes the rest off the screen.
 */
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Section({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section font-semibold">{title}</CardTitle>
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
