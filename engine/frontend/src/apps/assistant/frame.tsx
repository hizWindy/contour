/**
 * The Assistant's parts drawn once in the app frame, on every page: the mic check that Ctrl+K and
 * the account menu open (PLAN-V18 T3-4), and the V key with its voice bar (PLAN-V22 T3-1). The
 * mic check loads late in a `Suspense` of its own, so the V key listens from the first draw.
 */
import { Suspense } from 'react'
import { MicCheckHost } from './parts'
import { VoiceKey } from './voice/key'

export function AssistantFrame() {
  return (
    <>
      <Suspense fallback={null}>
        <MicCheckHost />
      </Suspense>
      <VoiceKey />
    </>
  )
}
