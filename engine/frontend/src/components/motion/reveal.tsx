/**
 * Content that fades and rises 4px once, when it first shows, on the `smooth` spring. A list of
 * cards gives each its `index`, and they come one after another, 40ms apart, up to the eighth:
 * the rest arrive with the eighth, so a long list never keeps anyone waiting.
 *
 * With reduced motion the content is simply there. Never use it in a table of more than 50 rows.
 */
import { m } from 'motion/react'
import type { ComponentProps } from 'react'
import { REVEAL_MAX, REVEAL_STAGGER, springs } from './springs'
import { useStill } from './use-still'

export interface RevealProps extends Omit<ComponentProps<typeof m.div>, 'initial' | 'animate'> {
  /** This item's place in its list, from 0. Leave it out for a part on its own. */
  index?: number
}

export function Reveal({ index = 0, transition, ...props }: RevealProps) {
  const still = useStill()
  const delay = Math.min(index, REVEAL_MAX - 1) * REVEAL_STAGGER
  return (
    <m.div
      data-slot="reveal"
      initial={still ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition ?? { ...springs.smooth, delay }}
      {...props}
    />
  )
}
