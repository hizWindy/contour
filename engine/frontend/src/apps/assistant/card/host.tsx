/**
 * Where the review card shows (PLAN-V22 T3-3): beside the voice bar, so it is on every page the bar
 * is. The card's code loads the first time a card opens, or ahead of that while the bar works a
 * command out (`preloadCard`), never in the first visit.
 *
 * A closed card stays drawn, closed, until the next one opens, so it can shrink away (150ms). Each
 * opening is a new card, with its own draft. A draft a closed page cut off in its hold is offered
 * again here, once.
 */
import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { ReviewCardProps } from './card'
import { cutHolds } from './drafts'
import { loadCard } from './load'
import { closeCard, openCard, useOpenCard, type CardRequest } from './store'
import { draftsLeftWords, OPEN } from './words'

const ReviewCard = lazy(loadCard)

/** For tests: what the card is handed (the fake mic, the waits). */
export type CardHostProps = Pick<ReviewCardProps, 'env' | 'makeTool' | 'read' | 'times'>

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
  const [shown, setShown] = useState<CardRequest | null>(request)
  if (request !== null && request !== shown) setShown(request)
  if (shown === null) return null
  return (
    <Suspense fallback={null}>
      <ReviewCard
        key={shown.id}
        {...props}
        request={shown}
        open={request?.id === shown.id}
        onClose={closeCard}
      />
    </Suspense>
  )
}
