/**
 * The mic in Log call's note box (PLAN-V18 T3-4, "The mic button"): a 44px button in the box's
 * corner, named "Speak" for screen readers. Pressing it opens the mic card, in the middle of the
 * window, which checks the mic and listens (`mic/mic-card.tsx`). Done puts the words in the box;
 * Esc puts nothing there. The Win+H line is gone.
 *
 * - **Laptops only** (choice 12): on a phone the keyboard's own mic key does the talking, so there
 *   is no button. With the voice tool set to typing there is none either.
 * - **The card's code loads late:** the first time the pointer rests on the button, it gets focus,
 *   or it is pressed. Neither the first visit nor the Companies page carries it.
 * - **Never round:** a square with the 10px corner, as every button (DESIGN.md "No pills"; the plan
 *   said round, TBC with Al-khair).
 *
 * The audio never leaves the browser through our code: the card hands the words back, never the
 * sound.
 */
import { Mic } from 'lucide-react'
import { lazy, Suspense, useRef, useState, type RefObject } from 'react'
import type { VoiceToolKind } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { NameFix } from './mic/name-fix'
import { SPEAK, SPEAK_HINT } from './mic/words'

const loadMicCard = () => import('./mic/mic-card')
const MicCard = lazy(loadMicCard)

/** Starts the card's download ahead of the press. A failed download tries again on the press. */
function preload(): void {
  void loadMicCard().catch(() => undefined)
}

export interface NoteMicProps {
  tool: VoiceToolKind
  /** The company's and the person's names, for the name fix ("Vitara" becomes "Vitera"). */
  names: readonly string[]
  /** The words to add to the note, after the name fix, and the names fixed. */
  onText: (text: string, fixes: readonly NameFix[]) => void
  /** The note box: the focus goes back there once the words are in. */
  box: RefObject<HTMLTextAreaElement | null>
  className?: string
}

export function NoteMic({ tool, names, onText, box, className }: NoteMicProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [wanted, setWanted] = useState(false)
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={button}
            type="button"
            variant="outline"
            size="icon"
            data-slot="note-mic"
            aria-label={SPEAK}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn('size-11 rounded-lg bg-card touch:size-11', className)}
            onPointerEnter={preload}
            onFocus={preload}
            onClick={() => {
              setWanted(true)
              setOpen(true)
            }}
          >
            <Mic aria-hidden="true" className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{SPEAK_HINT}</TooltipContent>
      </Tooltip>
      {wanted ? (
        <Suspense fallback={null}>
          <MicCard
            open={open}
            mode="note"
            tool={tool}
            names={names}
            opener={button}
            focusAfter={box}
            onDone={(text, fixes) => {
              if (text.trim()) onText(text, fixes)
            }}
            onTypeInstead={(text) => {
              if (text.trim()) onText(text, [])
            }}
            onClose={() => {
              setOpen(false)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
