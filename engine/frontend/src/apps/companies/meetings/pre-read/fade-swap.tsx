/**
 * A small part that changes in place (PLAN-V17 "How each part moves"): the old one fades out in
 * 150ms, then the new one fades in, on the one curve. The pre-read's status (Draft ready to Sent)
 * and a summary's mark (Written by AI to Edited by you) change this way. Only opacity moves. With
 * reduced motion it is a plain swap.
 *
 * It shows nothing new on its own: give a word to a screen reader from a stable place around it.
 */
import { AnimatePresence, m } from 'motion/react'
import type { ReactNode } from 'react'
import { springs, useStill } from '@/components/motion'

export interface FadeSwapProps {
  /** What it shows now: a new key fades the old one out and this one in. */
  swapKey: string
  children: ReactNode
  className?: string
}

export function FadeSwap({ swapKey, children, className }: FadeSwapProps) {
  const still = useStill()
  if (still) {
    return (
      <span key={swapKey} data-slot="fade-swap" className={className}>
        {children}
      </span>
    )
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.span
        key={swapKey}
        data-slot="fade-swap"
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: springs.exit }}
        exit={{ opacity: 0, transition: springs.exit }}
      >
        {children}
      </m.span>
    </AnimatePresence>
  )
}
