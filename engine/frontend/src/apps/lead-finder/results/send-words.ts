/**
 * The words of the bulk add to HubSpot on Results (PLAN-V27 T3-2, "Words on screen": "3 selected",
 * "Add to HubSpot", "Sending in 5 s. Undo" and "2 added. 1 failed: HubSpot refused the website.").
 * The wording is Al-khair's to change.
 */
import type { HubSpotBatchSent, HubSpotWrite } from '@/api/types'
import { formatNumber, pluralise } from '@/lib/format'

/** At most this many leads a batch (choice 13, TBC). The backend refuses 26. */
export const BATCH_MAX = 25

export const ADD = 'Add to HubSpot'
/** The bar on a laptop with nothing ticked: what ticking does. */
export const IDLE = `Tick leads to add up to ${String(BATCH_MAX)} of them to HubSpot at once.`
export const CLEAR = 'Clear selection'
export const UNDO = 'Undo'
export const NO_OWNER = 'No owner'

export function selectedWords(count: number): string {
  return `${formatNumber(count)} selected`
}

/** Beyond the cap the button is off, and this says why. */
export function overCapWords(count: number): string {
  const extra = count - BATCH_MAX
  return `You can add at most ${formatNumber(BATCH_MAX)} at a time. Untick ${formatNumber(extra)} to go on.`
}

export function previewTitle(count: number): string {
  return `Add ${pluralise(count, 'lead')} to HubSpot?`
}

export function confirmWords(count: number): string {
  return `Add ${formatNumber(count)} to HubSpot`
}

/** The hold's line, counting down: "Sending in 5 s." */
export function sendingIn(seconds: number): string {
  return `Sending in ${formatNumber(seconds)} s.`
}

/** What one lead's preview would do: "New company" or "Fills 2 empty fields in Northwind". */
export function planWords(write: HubSpotWrite): string {
  const plan = write.plan
  if (plan.action === 'create') return 'New company'
  const fields = plan.fields.filter((field) => field.write).length
  if (fields > 0) {
    return `Fills ${pluralise(fields, 'empty field')} in ${plan.company_name}`
  }
  return plan.note
    ? `Nothing to fill in ${plan.company_name}. Adds the note.`
    : `Nothing to fill in ${plan.company_name}`
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * The batch in one line, said once: "2 added. 1 failed: HubSpot refused the website." One failure
 * says why; more than one points at the rows, which each say why.
 */
export function summaryWords(out: HubSpotBatchSent): string {
  const parts = [out.sent > 0 ? `${formatNumber(out.sent)} added.` : 'Nothing added.']
  if (out.already_sent > 0) {
    parts.push(`${formatNumber(out.already_sent)} already in HubSpot.`)
  }
  if (out.failed === 1) {
    const failed = out.items.find((item) => item.result === 'failed')
    parts.push(`1 failed: ${sentence(failed?.problem ?? "HubSpot didn't take it")}`)
  } else if (out.failed > 1) {
    parts.push(`${formatNumber(out.failed)} failed. Each one says why.`)
  }
  return parts.join(' ')
}
