/**
 * The mic in the note view (PLAN-V17 T3-4, "The screens" part 2).
 *
 * For now it is T3-4's typing-only version: T3-2 (is the free browser model good enough?) waits
 * for Al-khair's dictation. So there is no mic button. On a Windows laptop it says "Type the note,
 * or press Win+H to dictate.", because Windows' own dictation types straight into the box. On a
 * phone it shows nothing: the keyboard's own mic does the talking (choice 8). On any other laptop
 * it shows nothing either.
 *
 * The props are the browser model's already, so T3-4 can add it here without touching the note
 * view:
 *   onWords    gets the words as they arrive, one chunk at a time, after the name fix
 *   names      the company's and the person's names, for that fix ("Vitara" becomes "Vitera")
 *   autoStart  start listening as soon as the view opens (it opened from L; TBC after T3-2)
 *   onState    hears each change of state, from the table in "The screens", part 2
 *
 * The audio never leaves the browser (T3-4 proves it with a test).
 */
import { useEffect, useEffectEvent, useState } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { isWindows } from '@/lib/platform'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/**
 * typing         no browser model: type, or use the computer's own dictation (Win+H)
 * getting_ready  the model is loading ("Getting the mic ready"); typing works meanwhile
 * listening      the level meter follows the voice
 * writing        the words arrive, a chunk at a time
 * done           the text is in the box, ready to edit, with a fixed name shown once
 * blocked        the browser has blocked the mic
 * no_mic         no mic, or a browser that can't
 */
export type MicState =
  'typing' | 'getting_ready' | 'listening' | 'writing' | 'done' | 'blocked' | 'no_mic'

export interface NoteMicProps {
  /** The words as they arrive, a chunk at a time, after the name fix. The view adds them. */
  onWords: (chunk: string) => void
  /** The company's and the person's names, so a near miss of one is fixed. */
  names: readonly string[]
  /** Start listening as soon as the view opens. */
  autoStart?: boolean
  /** Each change of state. */
  onState?: (state: MicState) => void
  className?: string
}

export function NoteMic({ onState, className }: NoteMicProps) {
  const onPhone = useMediaQuery(PHONE)
  const [windows] = useState(isWindows)
  const report = useEffectEvent((state: MicState) => {
    onState?.(state)
  })
  useEffect(() => {
    report('typing')
  }, [])
  if (onPhone || !windows) return null
  return (
    <p
      data-slot="note-mic"
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 text-ui text-muted-foreground',
        className,
      )}
    >
      Type the note, or press <Kbd>Win+H</Kbd> to dictate.
    </p>
  )
}
