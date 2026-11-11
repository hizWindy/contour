/**
 * The script column's header (PLAN-V14 T2-2): the title, and what the script was written from.
 * The modal draws it above `<SalesScript>`, inside the section it names.
 */
import type { CallGuide } from './playbook'

/** The id of the title, for the section's `aria-labelledby`. */
export const SCRIPT_TITLE_ID = 'sales-script'

export function ScriptHeader({ madeFrom }: { madeFrom: CallGuide['madeFrom'] }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={SCRIPT_TITLE_ID} className="text-body font-semibold text-foreground">
        Sales script
      </h3>
      <p className="text-caption text-muted-foreground">
        {madeFrom === 'hubspot'
          ? 'Written from our HubSpot copy.'
          : 'Written by call prep, with a web check.'}
      </p>
    </div>
  )
}
