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
}: MicSheetProps) {
  const still = useStill()
  // Where the focus was as it opened: it goes back there (Radix only returns it to a Trigger).
  const returnTo = useRef<HTMLElement | null>(null)

  // Read as it opens, before the first paint, so the dialog's own focus move hasn't happened yet.
  useLayoutEffect(() => {
    if (open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [open])

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
            <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-describedby={describedBy}
                onOpenAutoFocus={onOpenAutoFocus}
                onEscapeKeyDown={onEscapeKeyDown}
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
                <m.div
                  data-slot="mic-sheet"
                  className={cn(
                    'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain rounded-lg border bg-popover text-ui text-popover-foreground shadow-float outline-none',
                    className,
                  )}
                  style={{ transformOrigin: 'center' }}
                  onKeyDown={onKeyDown}
                  initial={still ? false : { opacity: 0, scale: SMALL }}
                  animate={{ opacity: 1, scale: 1, transition: still ? INSTANT : springs.smooth }}
                  exit={{ opacity: 0, scale: SMALL, transition: still ? INSTANT : springs.exit }}
                >
                  {children}
                </m.div>
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
