/**
 * The V key (PLAN-V22 T3-1, "Decided in chat" 2): tap V on any page and the voice bar rises from
 * the bottom and listens. The rules for a V are in `keys.ts`. Not for a Viewer (choice 18), and
 * only for a person who sees the Assistant: the frame draws a project's part only for them.
 *
 * Only this listener is in the first visit. The bar's code loads once the page is idle, or on the
 * first V or press of "Speak (V)" in the top bar, or as a review card opens from a button. If its
 * file can't be downloaded (an old file gone after a deploy), the bar closes again and the page goes
 * on.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { useIsViewer } from '@/auth/can'
import { whenIdle } from '@/lib/idle'
import { isPlainV } from './keys'
import {
  closeVoiceBar,
  isVoiceBarOpen,
  openVoiceBar,
  useVoiceBarOpen,
  useVoiceCodeWanted,
} from './store'

/** The bar's file is gone: nothing shows, and the bar closes again each time it is asked for. */
function Gone() {
  const open = useVoiceBarOpen()
  useEffect(() => {
    if (open) closeVoiceBar()
  }, [open])
  return null
}

const Bar = lazy(async (): Promise<{ default: ComponentType }> => {
  try {
    return await import('./bar')
  } catch {
    return { default: Gone }
  }
})

export function VoiceKey() {
  const viewer = useIsViewer()
  const open = useVoiceBarOpen()
  // Once asked for, the bar stays drawn (closed between uses), so its code is there.
  const [asked, setAsked] = useState(false)
  if (open && !asked) setAsked(true)
  const [idle, setIdle] = useState(false)
  // A review card opened from a button or Ctrl+K before any V (PLAN-V23 T4-3) needs it too.
  const wanted = useVoiceCodeWanted()

  useEffect(() => {
    if (viewer) return undefined
    const onKey = (event: KeyboardEvent): void => {
      // Once the bar is open, its own keys take over (V finishes, Esc throws away).
      if (isVoiceBarOpen() || !isPlainV(event)) return
      event.preventDefault()
      openVoiceBar()
    }
    document.addEventListener('keydown', onKey)
    // The bar's code, quietly, once the browser has nothing better to do.
    const cancel = whenIdle(() => {
      setIdle(true)
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      cancel()
    }
  }, [viewer])

  if (viewer || (!asked && !idle && !wanted)) return null
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  )
}
