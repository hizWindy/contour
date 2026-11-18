/**
 * The words as the voice tool hears them (PLAN-V18 T3-5, "How it should look and move"), in the
 * mic card and the voice bar (PLAN-V22 T3-2): each chunk of final words fades in (150ms, the one
 * curve), with no typewriter, and the words still being heard are quieter. Before the first word, a
 * quiet line says where they will show. With reduced motion they simply appear.
 *
 * Chunks only ever join at the end, so a chunk keeps its place: one that has faded in never fades
 * again when the next one comes.
 */
import { m } from 'motion/react'
import { EASE, INSTANT } from '@/components/motion/springs'
import { useStill } from '@/components/motion/use-still'
import { WORDS_SHOW_HERE } from './words'

/** A chunk of words fades in this long (150ms, the one curve). */
const CHUNK_IN = { duration: 0.15, ease: EASE } as const

export interface LiveWordsProps {
  /** The final words, a chunk at a time. */
  chunks: readonly string[]
  /** The words still being heard, which may change. */
  hearing: string
}

export function LiveWords({ chunks, hearing }: LiveWordsProps) {
  const still = useStill()
  if (chunks.length === 0 && hearing === '') {
    return <p className="text-muted-foreground">{WORDS_SHOW_HERE}</p>
  }
  return (
    <p className="text-pretty">
      {chunks.map((chunk, index) => (
        <m.span
          // Chunks only ever join at the end: the place is the chunk.
          key={index}
          data-slot="live-chunk"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: still ? INSTANT : CHUNK_IN }}
        >
          {index > 0 ? ' ' : ''}
          {chunk}
        </m.span>
      ))}
      {hearing ? (
        <span data-slot="live-hearing" className="text-muted-foreground">
          {chunks.length > 0 ? ' ' : ''}
          {hearing}
        </span>
      ) : null}
    </p>
  )
}
