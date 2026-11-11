/**
 * The call guide the card shows and copies (PLAN-V14 T2-2): call prep's script once it is ready,
 * or else the free script written here from our HubSpot copy (`playbook.ts`).
 *
 * PLAN-V14 T3-4: the person's own line edits for this call go over it (`script-layers.ts`), so the
 * card and "Copy script" both get the edited guide, and an edit survives "Research again".
 *
 * PLAN-V15 T3-6: the free script is written in the tone in use (mine, else the team's), so it
 * changes at once when the tone changes. Claude's script brings its own tone line; one from before
 * 12 Nov gets the free script's.
 */
import { useMemo } from 'react'
import { toneInUse, useScriptEdits, useScriptStyle } from '@/api/hooks/script'
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

export const NOTHING_SURE = 'Claude found nothing sure enough, so this is the free script.'
export const EDITS_FAILED = "Your own lines couldn't be loaded, so the draft shows."

/** Claude's script has at least one line left to say: not every line was dropped. */
function hasLines(script: PrepScript): boolean {
  return (
    script.opener.length > 0 ||
    script.why_now.length > 0 ||
    script.questions.length > 0 ||
    script.if_they_say.length > 0 ||
    script.goal !== null
  )
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
  companyKey,
  contactId,
}: UseGuideInput): CallGuide | null {
  // Until the edits load (or if they can't), the draft shows as it is.
  const edits = useScriptEdits(picking ? undefined : companyKey, contactId)
  // Friendly until the style loads (or if it can't). Nothing is asked while "Who are you calling?"
  // is open.
  const tone = toneInUse(useScriptStyle(!picking).data)

  const draft = useMemo(() => {
    const input = company
      ? {
          company,
          person: person ? { name: person.name, title: person.title ?? null } : null,
          caller,
          today,
          tone,
        }
      : null
    if (script && hasLines(script)) {
      const guide = guideFromPrep(script, labels)
      return input && !guide.tone ? { ...guide, tone: guideTone(input) } : guide
    }
    if (!input || picking) return null
    const free = buildGuide(input)
    // Every line of Claude's was left out for having no source (PLAN-V15 T3-7).
    return script ? { ...free, notices: [NOTHING_SURE] } : free
  }, [script, labels, company, picking, person, caller, today, tone])

  const mine = edits.data ?? NO_EDITS
  const editsFailed = edits.isError
  return useMemo(() => {
    if (!draft) return null
    const shown = applyEdits(draft, mine)
    const notices = [...(shown.notices ?? []), ...(editsFailed ? [EDITS_FAILED] : [])]
    const withNotices = notices.length ? { ...shown, notices } : shown
    // The line editor saves to this call; while "Who are you calling?" is open there is none.
    return companyKey && !picking
      ? { ...withNotices, call: { companyKey, contactId } }
      : withNotices
  }, [draft, mine, editsFailed, companyKey, contactId, picking])
}
