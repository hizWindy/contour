/**
 * A lead's tier (PLAN-V16): A, B, C or Discard, in words and never in colour, because colour
 * stays with the results (DESIGN.md, "Results and labels"). A screen reader also hears what the
 * tier asks for: "A, pursue now".
 *
 * `TierLine` is the lead card's headline: "A · 82 · Medium" (tier, score, confidence), Levi's
 * own format (his section 9). A screen reader hears "Tier A, score 82, Medium confidence".
 */
import type { Confidence, Tier } from '@/api/types'
import { CONFIDENCE_LABELS, isTier, TIER_ACTIONS, TIER_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

export function TierMark({
  tier,
  className,
}: {
  tier: Tier | null | undefined
  className?: string
}) {
  // A lead saved before tiers, not yet judged again, has none: it says so instead of breaking.
  if (!isTier(tier)) {
    return <span className={cn('text-muted-foreground', className)}>Not ranked yet</span>
  }
  return (
    <span className={cn('font-semibold tabular-nums', className)}>
      {TIER_LABELS[tier]}
      <span className="sr-only">, {TIER_ACTIONS[tier].toLowerCase()}</span>
    </span>
  )
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-muted-foreground">
      ·
    </span>
  )
}

export function TierLine({
  tier,
  score,
  confidence,
  className,
}: {
  tier: Tier | null | undefined
  score: number
  confidence: Confidence | null | undefined
  className?: string
}) {
  if (!isTier(tier)) {
    return <span className={cn('tabular-nums', className)}>Score {score}, not ranked yet</span>
  }
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums', className)}>
      <span className="sr-only">Tier </span>
      <span className="font-semibold">{TIER_LABELS[tier]}</span>
      <Dot />
      <span className="sr-only">, score </span>
      <span className="font-semibold">{score}</span>
      <Dot />
      <span className="sr-only">, </span>
      <span>{confidence ? CONFIDENCE_LABELS[confidence] : 'Not rated'}</span>
      <span className="sr-only"> confidence</span>
    </span>
  )
}
