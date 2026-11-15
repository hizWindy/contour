import { createContext, useContext } from 'react'

/**
 * Whether the view a part sits in is the one on show (`PushView`, PLAN-V17 T3-8). False while the
 * view is covered by the one pushed over it, or while it leaves. Outside a PushView it is true.
 *
 * The call prep panel's title uses it: only the view on show names the panel, so the panel never
 * holds two titles with the same id (`panel-title.tsx`).
 */
export const ViewShown = createContext(true)

export function useViewShown(): boolean {
  return useContext(ViewShown)
}
