/**
 * The mic card's sheet (PLAN-V18 T3-4, "How it should look and move": "The mic is pressed"): a
 * card that rises over the page from the button that opened it, like the Siri card. The page
 * behind dims.
 *
 * - **It grows from its button:** it sits beside the button (above it when there is room, else
 *   below, inside the window), and scales from 0.96 to 1 with a fade, on `smooth`, with the
 *   button's middle as its transform origin. The page behind dims over 250ms. Opened from no
 *   button (Ctrl+K's "Check my mic"), it sits in the middle of the window and grows from there.
 * - **Leaving is quicker:** it shrinks back toward the button and fades in 150ms (`exit`).
 * - **Above the button it grows upward** as its content grows (it is held by its bottom edge), so
 *   it never covers the button it came from. It scrolls inside itself if the window is short.
 * - **A real dialog** (Radix): the focus stays inside, Esc closes it (the caller treats that as
 *   Cancel), and the focus goes back to the button (or where it was, with no button), unless the
 *   caller sends it on. Put a `MicSheetTitle` inside it.
 * - **Reduced motion:** it simply appears and goes.
 *
 * Only transform and opacity move. The card is a float, so it has the soft shadow.
 */
import { AnimatePresence, m } from 'motion/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '@/lib/utils'
import { placeCard, type CardPlace } from './card-place'
import { EASE, INSTANT, springs } from './springs'
import { useStill } from './use-still'

/** The scale the card grows from and shrinks back to. */
const SMALL = 0.96

/** How the page behind dims: 250ms on the one curve. */
const DIM = { duration: 0.25, ease: EASE } as const

export interface MicSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The button it grows from, or null to sit in the middle of the window. */
  anchor: RefObject<HTMLElement | null> | null
  children: ReactNode
  className?: string
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}

export function MicSheet({
  open,
  onOpenChange,
  anchor,
  children,
  className,
  onKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: MicSheetProps) {
  const still = useStill()
  const [place, setPlace] = useState<CardPlace | null>(null)
  // Where the focus was as it opened: it goes back there (Radix only returns it to a Trigger).
  const returnTo = useRef<HTMLElement | null>(null)

  // Measured as it opens, before the first paint, and again if the window changes size.
  useLayoutEffect(() => {
    if (!open) return undefined
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const measure = (): void => {
      const button = anchor?.current
      setPlace(
        button
          ? placeCard(button.getBoundingClientRect(), {
              width: window.innerWidth,
              height: window.innerHeight,
            })
          : null,
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [open, anchor])

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
                'pointer-events-none fixed inset-0 z-50',
                !place && 'flex items-center justify-center p-4',
              )}
            >
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-describedby={undefined}
                onOpenAutoFocus={onOpenAutoFocus}
                onCloseAutoFocus={(event) => {
                  onCloseAutoFocus?.(event)
                  if (event.defaultPrevented) return
                  event.preventDefault()
                  ;(anchor?.current ?? returnTo.current)?.focus()
                }}
              >
                <m.div
                  data-slot="mic-sheet"
                  data-place={place ? (place.top === undefined ? 'above' : 'below') : 'middle'}
                  className={cn(
                    'pointer-events-auto flex w-[min(25rem,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain rounded-lg border bg-popover text-ui text-popover-foreground shadow-float outline-none',
                    place ? 'fixed' : 'max-h-[calc(100dvh-2rem)]',
                    className,
                  )}
                  style={
                    place
                      ? {
                          left: place.left,
                          top: place.top,
                          bottom: place.bottom,
                          maxHeight: place.maxHeight,
                          transformOrigin: place.origin,
                        }
                      : { transformOrigin: 'center' }
                  }
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
