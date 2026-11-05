/**
 * What a page shows while its data loads (PLAN-V7 B1): the still shape of what is coming, so the
 * page does not jump when it arrives. DESIGN.md "Motion": skeletons stay still, and
 * they fade in once.
 *
 * `Pending` is the wrapper. The room is kept from the first moment, but the grey blocks show only
 * after 200 ms (`SKELETON_DELAY_MS`), so a fast answer never flashes them. A screen reader hears
 * `label` once, at once ("Loading the lead.").
 */
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SKELETON_DELAY_MS, useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'

// Fixed widths, so lines look like text and a test sees the same thing every time.
const WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4', 'w-10/12']

export interface PendingProps {
  /** What a screen reader hears: "Loading the leads." */
  label: string
  children: ReactNode
  className?: string
}

export function Pending({ label, children, className }: PendingProps) {
  const shown = useAfter(SKELETON_DELAY_MS)
  return (
    <div role="status" data-slot="pending" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={shown ? 'animate-in duration-150 fade-in-0' : 'invisible'}>
        {children}
      </div>
    </div>
  )
}

/** Lines of text. */
export function SkeletonLines({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', WIDTHS[index % WIDTHS.length])} />
      ))}
    </div>
  )
}

/** A card with a title bar and some lines. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-1/3" />
      </CardHeader>
      <CardContent>
        <SkeletonLines count={lines} />
      </CardContent>
    </Card>
  )
}

/** Cards in a stack: for the Admin tabs, Rules and other pages made of sections. */
export function PendingCards({
  label,
  cards = 2,
  lines = 4,
}: {
  label: string
  cards?: number
  lines?: number
}) {
  return (
    <Pending label={label}>
      <div className="flex flex-col gap-6">
        {Array.from({ length: cards }, (_, index) => (
          <SkeletonCard key={index} lines={lines} />
        ))}
      </div>
    </Pending>
  )
}

/** A form: a label and a field, again and again, then the button. */
export function PendingForm({ label, fields = 5 }: { label: string; fields?: number }) {
  return (
    <Pending label={label}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {Array.from({ length: fields }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-28" />
        </CardContent>
      </Card>
    </Pending>
  )
}

/**
 * A short line of text that is still to come, inside a sentence or a card description. A span, so
 * it can sit inside a paragraph.
 */
export function PendingText({
  label = 'Loading.',
  className,
}: {
  label?: string
  className?: string
}) {
  const shown = useAfter(SKELETON_DELAY_MS)
  return (
    <span role="status" data-slot="pending-text">
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-48 max-w-full rounded-md bg-muted align-middle',
          shown ? 'animate-in duration-150 fade-in-0' : 'invisible',
          className,
        )}
      />
    </span>
  )
}

/**
 * One thing in full: a title with badges, a summary, a strip of tabs and a block of content.
 * `titled={false}` leaves out the title and badges, for a page that already shows them.
 */
export function PendingDetail({ label, titled = true }: { label: string; titled?: boolean }) {
  return (
    <Pending label={label}>
      <div className="flex flex-col gap-6">
        {titled ? (
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
        ) : null}
        <SkeletonLines count={3} />
        <div className="flex gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-20" />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    </Pending>
  )
}
