/**
 * Words for call prep's "still there?" answer (PLAN-V10 D4). "Copy script" copies the script on
 * show, free or call prep's, with `guideText` in playbook.ts.
 */
import type { PrepScript } from '@/api/types'

export const STILL_WORDS: Record<PrepScript['still_there'], string> = {
  yes: 'Still there',
  no: 'Has left',
  unknown: 'Not found',
  not_checked: 'Not checked',
}
