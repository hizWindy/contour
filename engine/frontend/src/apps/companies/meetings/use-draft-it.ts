/**
 * "Draft it" on a meeting with no pre-read yet (PLAN-V17 "The screens", part 5): it starts the
 * form, then opens its page. While the server answers, the row already says "Drafting"
 * (`pending`). If it says no, the row goes back and a toast says why. Meetings' rows and Home's
 * "Upcoming meetings" card (T3-11) each hold their own, so one row's press never moves another.
 */
import { useNavigate } from 'react-router'
import { useStartMeetingForm } from '@/api/hooks/meetings'
import type { MeetingItem } from '@/api/types'
import { toastProblem } from '@/lib/problems'
import { preReadHref } from './params'

export interface DraftIt {
  /** The server is starting the form: the row says Drafting. */
  pending: boolean
  /** Only a HubSpot meeting can be drafted from its row: a typed one always has its form. */
  possible: boolean
  draft: () => void
}

export function useDraftIt(item: MeetingItem): DraftIt {
  const start = useStartMeetingForm()
  const navigate = useNavigate()
  const meetingId = item.typed ? '' : item.meeting.id
  return {
    pending: start.isPending,
    possible: meetingId !== '',
    draft: () => {
      start.mutate(
        // The server reads a HubSpot meeting's own place; `where` must still be sent.
        { meeting_id: meetingId, where: item.meeting.where },
        {
          onSuccess: (form) => {
            void navigate(preReadHref(form.id))
          },
          onError: toastProblem,
        },
      )
    },
  }
}
