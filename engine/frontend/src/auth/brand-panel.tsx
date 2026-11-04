/**
 * The Navy brand half of the sign-in page: Contour's cream wordmark with "HQ", over fine
 * topographic contour lines (a nod to the name). On a laptop it is the left half of the page and
 * its inner edge is a soft curve; on a phone or a tablet it shrinks to a band across the top, with
 * the soft curve at its bottom edge.
 *
 * The lines are drawn once when the page opens (`.contour-line` in index.css). If the computer
 * asks for reduced motion, they are simply there.
 */
import { cn } from '@/lib/utils'
import { CONTOUR_LINES, CONTOUR_VIEWBOX } from './contour-lines'
import wordmark from './wordmark.png'

/** The highest height step in CONTOUR_LINES. Higher rings are a little stronger. */
const TOP_STEP = Math.max(...CONTOUR_LINES.map(([step]) => step))

function ContourLines({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={CONTOUR_VIEWBOX}
      preserveAspectRatio="xMidYMid slice"
      className={cn(
        'pointer-events-none absolute inset-0 size-full text-brand-foreground',
        className,
      )}
    >
      {CONTOUR_LINES.map(([step, path], index) => (
        <path
          // The lines never change order, so the index is a stable key.
          key={index}
          d={path}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.1 + 0.2 * (step / TOP_STEP)}
          vectorEffect="non-scaling-stroke"
          className="contour-line"
          // Low rings first, then up the hill, so the map seems to rise.
          style={{ animationDelay: `${String(step * 60)}ms` }}
        />
      ))}
    </svg>
  )
}

/** The wordmark and "HQ", as one name. */
function Lockup({ size }: { size: 'large' | 'small' }) {
  const large = size === 'large'
  return (
    <p className="flex items-center gap-4 text-brand-foreground">
      <img
        src={wordmark}
        alt="Contour"
        width={532}
        height={120}
        className={cn('h-auto', large ? 'w-56' : 'w-36')}
      />
      <span
        aria-hidden="true"
        className={cn('w-px bg-brand-foreground/40', large ? 'h-10' : 'h-7')}
      />
      <span className={cn('font-semibold', large ? 'text-title' : 'text-section')}>HQ</span>
    </p>
  )
}

export interface BrandPanelProps {
  /** `side` for a laptop (the left half), `band` for a phone or a tablet (a band on top). */
  layout: 'side' | 'band'
}

export function BrandPanel({ layout }: BrandPanelProps) {
  if (layout === 'band') {
    return (
      <header className="relative bg-brand">
        <div className="relative isolate flex h-36 items-center overflow-hidden px-6">
          <ContourLines />
          <Lockup size="small" />
        </div>
        {/* The soft curve along the bottom edge. */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 600 24"
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-[calc(100%-1px)] h-5 w-full fill-brand"
        >
          <path d="M0 0H600V4C440 26 160 26 0 4Z" />
        </svg>
      </header>
    )
  }
  return (
    <header className="relative z-10 flex min-h-dvh flex-col bg-brand">
      <div className="relative isolate flex flex-1 flex-col justify-between overflow-hidden p-12">
        <ContourLines />
        <span />
        <Lockup size="large" />
        <p className="text-caption text-brand-muted">Contour Commercial Interiors</p>
      </div>
      {/* The soft curve along the inner edge, reaching into the page. It overlaps the panel by a
          pixel, so no seam shows where the two meet. */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 48 900"
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-[calc(100%-1px)] h-full w-12 fill-brand"
      >
        <path d="M0 0H6C42 230 42 670 6 900H0Z" />
      </svg>
    </header>
  )
}
