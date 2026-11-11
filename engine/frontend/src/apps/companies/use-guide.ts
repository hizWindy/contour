/**
 * The call guide the card shows and copies (PLAN-V14 T2-2): call prep's script once it is ready,
 * or else the free script written here from our HubSpot copy (`playbook.ts`). Moved out of
 * `prep-modal.tsx` with no change, so the script's own parts can grow here (Track 3).
 */
import { useMemo } from 'react'
import type { CompanyDetail, PrepScript } from '@/api/types'
import { buildGuide, guideFromPrep, type CallGuide } from './playbook'

export interface UseGuideInput {
  /** Call prep's script, once it is ready. */
  script: PrepScript | null
  /** Each source's id and its label, for the lines' source marks. */
  labels: ReadonlyMap<string, string>
  company: CompanyDetail | undefined
  /** "Who are you calling?" is open, so there is no script yet. */
  picking: boolean
  /** The person being called, or null for a cold call to the switchboard. */
  person: { name: string; title?: string | null } | null
  /** The caller's name, or null when nobody is signed in. */
  caller: string | null
  /** Today in Melbourne, as YYYY-MM-DD. */
  today: string
  /** The call this guide is for. Unused today; a person's line edits are saved per call. */
  companyKey: string | undefined
  /** The contact being called, or null for a cold call. Unused today, like `companyKey`. */
  contactId: string | null
}

/** The guide, or null while the company loads or "Who are you calling?" is open. */
export function useGuide({
  script,
  labels,
  company,
  picking,
  person,
  caller,
  today,
}: UseGuideInput): CallGuide | null {
  return useMemo(() => {
    if (script) return guideFromPrep(script, labels)
    if (!company || picking) return null
    return buildGuide({
      company,
      person: person ? { name: person.name, title: person.title ?? null } : null,
      caller,
      today,
    })
  }, [script, labels, company, picking, person, caller, today])
}
