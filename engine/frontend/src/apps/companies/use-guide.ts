/**
 * The call guide the card shows and copies (PLAN-V14 T2-2): call prep's script once it is ready,
 * or else the free script written here from our HubSpot copy (`playbook.ts`).
 *
 * PLAN-V14 T3-4: the person's own line edits for this call go over it (`script-layers.ts`), so the
 * card and "Copy script" both get the edited guide, and an edit survives "Research again". Claude's
 * answer form has no tone line, so the free script's tone (the same rule) is added to it.
 */
import { useMemo } from 'react'
import { useScriptEdits } from '@/api/hooks/script'
import type { CompanyDetail, PrepScript } from '@/api/types'
import { buildGuide, guideFromPrep, guideTone, type CallGuide } from './playbook'
import { applyEdits } from './script-layers'

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
  /** The call this guide is for: a person's line edits are saved per company and contact. */
  companyKey: string | undefined
  /** The contact being called, or null for a cold call. */
  contactId: string | null
}

const NO_EDITS: never[] = []

/** The guide, or null while the company loads or "Who are you calling?" is open. */
export function useGuide({
  script,
  labels,
  company,
  picking,
  person,
  caller,
  today,
  companyKey,
  contactId,
}: UseGuideInput): CallGuide | null {
  // Until the edits load (or if they can't), the draft shows as it is.
  const edits = useScriptEdits(picking ? undefined : companyKey, contactId)

  const draft = useMemo(() => {
    const input = company
      ? {
          company,
          person: person ? { name: person.name, title: person.title ?? null } : null,
          caller,
          today,
        }
      : null
    if (script) {
      const guide = guideFromPrep(script, labels)
      return input ? { ...guide, tone: guideTone(input) } : guide
    }
    if (!input || picking) return null
    return buildGuide(input)
  }, [script, labels, company, picking, person, caller, today])

  const mine = edits.data ?? NO_EDITS
  return useMemo(() => (draft ? applyEdits(draft, mine) : null), [draft, mine])
}
