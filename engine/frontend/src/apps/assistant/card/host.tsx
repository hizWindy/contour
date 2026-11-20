/**
 * Where the review card shows (PLAN-V22 T3-3): beside the voice bar, so it is on every page the bar
 * is. Its code comes with the bar's, which loads late (after the page is idle, or on the first V),
 * never in the first visit. As a file of its own it split two small first-visit files out of the
 * main one (PLAN-V22 T3-6): the bar already uses the parts that did it, so with the bar it doesn't.
 * The dictation panel (Log call, with the AI off) loads on its own, only when it is needed.
 *
 * A closed card stays drawn, closed, until the next one opens, so it can shrink away (150ms). Each
 * opening is a new card, with its own draft, drawn in a transition a moment after it is asked for
 * (PLAN-V23 T4-4). A draft a closed page cut off in its hold is offered again here, once. With the
 * AI off, Log call opens here instead, with the words (`dictation.tsx`).
 */
import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useDeferredValue, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import ReviewCard, { type ReviewCardProps } from './card'
import { cutHolds } from './drafts'
import { closeCard, openCard, useOpenCard, type CardRequest } from './store'
import { draftsLeftWords, OPEN } from './words'

const Dictation = lazy(() => import('./dictation'))

/**
 * What the card is handed: for tests, the fake mic, the waits and the tone; from the voice bar, its
 * conversation, which an open card hears (PLAN-V24 T2-3).
 */
export type CardHostProps = Pick<
  ReviewCardProps,
  'env' | 'makeTool' | 'read' | 'times' | 'conversation' | 'converse' | 'tone'
>

/**
 * A draft whose hold a closed page cut off (choice 22) is offered once, as the bar's code loads on
 * the next page: a toast with Open, which opens its card again. Nothing is sent by itself.
 */
function useCutHolds(): void {
  const client = useQueryClient()
  useEffect(() => {
    const signIn = client.getQueryData<SignIn>(queryKeys.auth.me())
    const cut = cutHolds(signIn?.state === 'signed_in' ? signIn.user.id : null)
    const [newest] = cut
    if (!newest) return
    toast(draftsLeftWords(cut.length), {
      action: {
        label: OPEN,
        onClick: () => {
          openCard({ kind: 'draft', draft: newest })
        },
      },
    })
  }, [client])
}

export function CardHost(props: CardHostProps) {
  useCutHolds()
  const request = useOpenCard()
  // The card is drawn a moment later, in a transition (PLAN-V23 T4-4), not in the same render as
  // the voice bar closing. Closing stays at once: `open` reads the request itself. At 4x CPU
  // slowdown the frame it appears in is still long, mostly the browser's work for a modal dialog
  // (the page behind made inert, the focus moved in): see PLAN-V23's Part 4 Log.
  const later = useDeferredValue(request)
  const [shown, setShown] = useState<CardRequest | null>(later)
  if (later !== null && later !== shown) setShown(later)
  if (shown === null) return null
  if (shown.kind === 'dictation') {
    return (
      <Suspense fallback={null}>
        <Dictation
          key={shown.id}
          words={shown.words}
          source={shown.source}
          open={request?.id === shown.id}
          onClose={closeCard}
        />
      </Suspense>
    )
  }
  return (
    <ReviewCard
      key={shown.id}
      {...props}
      request={shown}
      open={request?.id === shown.id}
      onClose={closeCard}
    />
  )
}
