import { createContext } from 'react'

/**
 * True inside the app frame (its menu, top bar and connection bar are on screen). Outside it, a
 * full error page fills the screen and runs its own connection checks (PLAN-V15 T2-4).
 */
export const InFrameContext = createContext(false)
