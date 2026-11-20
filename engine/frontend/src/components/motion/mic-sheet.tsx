/**
 * The mic card's sheet (PLAN-V18 T3-4, "How it should look and move": "The mic is pressed"): a
 * card in the middle of the window, like a dialog. The page behind dims.
 *
 * - **It opens in the middle,** whichever button opened it, on a laptop and on a phone (Al-khair,
 *   17 Nov 2026: it first sat beside the button, and he asked for it centred). It scales from 0.96
 *   to 1 with a fade, on `smooth`, from the middle. The page behind dims over 250ms.
 * - **Leaving is quicker:** it shrinks back and fades in 150ms (`exit`).
 * - **It scrolls inside itself** if the window is too short, and never reaches the window's edge.
 * - **A real dialog** (Radix): the focus stays inside, Esc closes it (the caller treats that as
 *   Cancel), and the focus goes back to the button that opened it (`opener`, or where it was),
 *   unless the caller sends it on. Put a `MicSheetTitle` inside it.
 * - **Reduced motion:** it simply appears and goes.
 * - **Something beside it** (`aside`, PLAN-V24 T5-1): the voice bar's Listening pill sits under the
 *   review card, in the same dialog layer, so the focus, the keys and a click reach it as they do
 *   the card's own parts. The card stays in the middle of the window, and the pill takes the room
 *   below it: the card never moves as the pill comes and goes, and only a card taller than the
 *   window gives up the pill's height. A click on the dimmed page around them still closes it.
 *
 * Only transform and opacity move. The card is a float, so it has the soft shadow.
 */
import { AnimatePresence, m } from 'motion/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '@/lib/utils'
import { EASE, INSTANT, springs } from './springs'
import { useStill } from './use-still'

/** The scale the card grows from and shrinks back to. */
const SMALL = 0.96

/** How the page behind dims: 250ms on the one curve. */
const DIM = { duration: 0.25, ease: EASE } as const

/**
 * The layer that holds the card and what sits beside it: the window's height in three rows. The
 * card is the middle row. The rows above and below it share what is left, so the card stays in the
 * middle, and the row below is never shorter than what it holds.
 */
const LAYER_ROWS = 'grid-rows-[minmax(0,1fr)_auto_minmax(min-content,1fr)]'

/**
 * The layer takes no clicks itself: they reach the card and the pill, or the dimmed page behind,
 * which closes it, as before. Radix sets the dialog's own pointer events, and this goes after. The
 * card and the pill take clicks again, written on them (`LAYER_PART`), as Radix writes its own.
 */
const LAYER_STYLE = { pointerEvents: 'none' } as const

/** On the card, and on what sits beside it (its own): they take clicks in the layer that doesn't. */
const LAYER_PART = { pointerEvents: 'auto' } as const

export interface MicSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The button that opened it. The focus goes back to it when the card closes, even in a browser
   * that doesn't focus a button when it is pressed (Safari). Null: back to where the focus was.
   */
  opener: RefObject<HTMLElement | null> | null
  children: ReactNode
  className?: string
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  /** Esc, before the sheet closes: `preventDefault` keeps it open (the review card's boxes). */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  /** The id of what describes the card, read with its title (the review card's "send it" line). */
  describedBy?: string
  /**
   * Shown under the card, in its dialog layer (the voice bar's pill, PLAN-V24 T5-1). Given at all,
   * even as null, the card is laid out to keep its place as the pill comes and goes, and the keys
   * of both reach `onKeyDown`. Left out: the card alone, as the mic card has it.
   */
  aside?: ReactNode
}

export function MicSheet({
  open,
  onOpenChange,
  opener,
  children,
  className,
  onKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  describedBy,
  aside,
}: MicSheetProps) {
  const still = useStill()
  // Where the focus was as it opened: it goes back there (Radix only returns it to a Trigger).
  const returnTo = useRef<HTMLElement | null>(null)
  const layered = aside !== undefined

  // Read as it opens, before the first paint, so the dialog's own focus move hasn't happened yet.
  useLayoutEffect(() => {
    if (open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [open])

  const card = (
    <m.div
      data-slot="mic-sheet"
      className={cn(
        'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain rounded-lg border bg-popover text-ui text-popover-foreground shadow-float outline-none',
        layered && 'row-start-2 min-h-0',
        className,
      )}
      style={layered ? { ...LAYER_PART, transformOrigin: 'center' } : { transformOrigin: 'center' }}
      onKeyDown={layered ? undefined : onKeyDown}
      initial={still ? false : { opacity: 0, scale: SMALL }}
      animate={{ opacity: 1, scale: 1, transition: still ? INSTANT : springs.smooth }}
      exit={{ opacity: 0, scale: SMALL, transition: still ? INSTANT : springs.exit }}
    >
      {children}
    </m.div>
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <m.div
                data-slot="mic-sheet-overlay"
                className="fixed inset-0 z-50 bg-overlay"
                initial={still ? false : { opacity: 0 }}
                animate={{ opacity: 1, transition: still ? INSTANT : DIM }}
                exit={{ opacity: 0, transition: still ? INSTANT : springs.exit }}
              />
            </DialogPrimitive.Overlay>
            <div
              className={cn(
                'pointer-events-none fixed inset-0 z-50 p-4',
                !layered && 'flex items-center justify-center',
              )}
            >
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-describedby={describedBy}
                onOpenAutoFocus={onOpenAutoFocus}
                onEscapeKeyDown={onEscapeKeyDown}
                style={layered ? LAYER_STYLE : undefined}
                onCloseAutoFocus={(event) => {
                  onCloseAutoFocus?.(event)
                  if (event.defaultPrevented) return
                  const back = opener?.current ?? returnTo.current
                  // Gone meanwhile (the voice bar that handed over to the review card): Radix puts
                  // the focus back where it was when the sheet opened.
                  if (!back?.isConnected) return
                  event.preventDefault()
                  back.focus()
                }}
              >
                {layered ? (
                  <div
                    data-slot="mic-sheet-layer"
                    className={cn('grid h-full justify-items-center outline-none', LAYER_ROWS)}
                    onKeyDown={onKeyDown}
                  >
                    {card}
                    <div
                      data-slot="mic-sheet-aside"
                      className="row-start-3 flex w-full justify-center self-start"
                    >
                      {aside}
                    </div>
                  </div>
                ) : (
                  card
                )}
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

/** The card's title: what the mic is doing now ("Checking your mic", "Speak now"). */
export function MicSheetTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="mic-sheet-title"
      className={cn('text-section font-semibold text-balance text-foreground', className)}
      {...props}
    />
  )
}
