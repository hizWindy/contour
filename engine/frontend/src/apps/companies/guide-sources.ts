/**
 * The sources of the call script on show (PLAN-V10 F1): call prep's F and W ids, with their
 * labels, so a line's chips can say where it came from. The free script has no ids, so it is
 * empty then.
 */
import { createContext } from 'react'
import type { PrepSource } from '@/api/types'

export const SourcesContext = createContext<ReadonlyMap<string, PrepSource>>(new Map())
