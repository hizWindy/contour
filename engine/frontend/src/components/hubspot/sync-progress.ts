/**
 * How a HubSpot sync is getting on, in words and as a bar (PLAN-V15 T2-6). The Companies page's
 * "Sync with HubSpot" and Admin's Syncs card both use it.
 *
 * The backend says which phase a running sync is in: reading HubSpot, saving to our copy, saving
 * people, then updating profiles. Each gets its own words, so the bar no longer sits at 95%
 * through the last two. The bar fills by phase; while reading, the last full copy's totals say
 * how far there is to go (a sync of changes has none, so it shows no bar there: nothing is made
 * up).
 */
import type { HubSpotSync } from '@/api/types'
import { formatNumber } from '@/lib/format'

/** A full copy's usual length, until one has finished. */
export const FULL_MINUTES = 10

/** How long the last full copy took, in minutes. */
export function minutesOf(sync: HubSpotSync | undefined): number {
  if (!sync?.finished_at) return FULL_MINUTES
  const taken = new Date(sync.finished_at).getTime() - new Date(sync.started_at).getTime()
  return Math.max(1, Math.round(taken / 60_000))
}

export interface SyncProgress {
  words: string
  /** 0 to 100 once there is something to measure by, else null (then no bar). */
  value: number | null
}

/*
  Where each phase sits on the bar: reading companies 0 to 50, reading deals 50 to 70, saving 70
  to 75, people 75 to 80, profiles 80 to 100.
*/
function readingProgress(running: HubSpotSync, lastFull: HubSpotSync | undefined): SyncProgress {
  const full = running.mode === 'full' ? lastFull : undefined
  const companies = full?.companies_read ?? 0
  const deals = full?.deals_read ?? 0
  if (running.deals_read > 0) {
    const share = deals > 0 ? Math.min(1, running.deals_read / deals) : null
    return {
      words: `Reading HubSpot: ${formatNumber(running.deals_read)}${deals ? ` of about ${formatNumber(deals)}` : ''} deals.`,
      value: share === null ? null : 50 + share * 20,
    }
  }
  if (running.companies_read > 0) {
    const share = companies > 0 ? Math.min(1, running.companies_read / companies) : null
    return {
      words: `Reading HubSpot: ${formatNumber(running.companies_read)}${companies ? ` of about ${formatNumber(companies)}` : ''} companies.`,
      value: share === null ? null : share * 50,
    }
  }
  return {
    words:
      running.mode === 'full'
        ? `Reading HubSpot. A full copy takes about ${String(minutesOf(lastFull))} minutes.`
        : 'Reading HubSpot.',
    value: null,
  }
}

/** How far a running sync has got. `lastFull` is the newest finished full copy, for its totals. */
export function syncProgress(running: HubSpotSync, lastFull?: HubSpotSync): SyncProgress {
  switch (running.phase) {
    case 'saving':
      return { words: 'Saving to our copy.', value: 72 }
    case 'people':
      return { words: `Saving people (${formatNumber(running.people_saved)}).`, value: 77 }
    case 'profiles': {
      const total = running.profiles_total
      if (total <= 0) return { words: 'Updating profiles.', value: 80 }
      const done = Math.min(running.profiles_done, total)
      return {
        words: `Updating profiles (${formatNumber(done)} of ${formatNumber(total)}).`,
        value: 80 + (done / total) * 20,
      }
    }
    default:
      return readingProgress(running, lastFull)
  }
}

/** True while a Stop was pressed and the sync hasn't stopped yet (another backend may stop it). */
export function isStopping(sync: HubSpotSync): boolean {
  return sync.status === 'running' && Boolean(sync.cancel_requested_at)
}

/**
 * What a stopped sync kept, in the backend's words (the last of its warnings): "Stopped. Our copy
 * didn't change." or "Stopped after saving companies. People and profiles update with the next
 * sync."
 */
export function stoppedWords(sync: HubSpotSync): string {
  return sync.warnings.at(-1) ?? 'Stopped.'
}
