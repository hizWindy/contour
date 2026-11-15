/**
 * The pre-read's header (PLAN-V17 "The screens", part 6): the meeting's title as the page's h1,
 * then the company (a link to its record). Under them, on a line of their own: the pre-read's
 * status, and "Open in HubSpot" for a meeting in HubSpot.
 *
 * - **When and where aren't here:** the facts say them (`facts.tsx`), in the email's own words and
 *   with their source, so the page says them once (DESIGN.md "Say it once").
 * - **The status line is always a line of its own,** never beside the title when there is room:
 *   a new word (Draft ready to Sent) is narrower or wider, and must move nothing on the page.
 * - The status is an icon and a word, as on Meetings. When it changes (Drafting to Draft ready,
 *   Draft ready to Sent), the old one fades out and the new one in (`FadeSwap`), and a screen
 *   reader hears the new word. When the rep's own send lands (T3-11), "Sent" draws its tick once
 *   (`TickIn`); a pre-read that was sent before the page opened shows the still icon.
 * - The form's copy of the meeting has no HubSpot link, so the page reads the meeting itself for
 *   it (`useMeeting`). While it loads, the button's place is kept, unseen, so the header doesn't
 *   move when it comes. A meeting typed in has no link, and one that can't be read shows none.
 */
import { ExternalLink, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { useMeeting } from '@/api/hooks/meetings'
import type { MeetingFormOut } from '@/api/v17'
import { TickIn } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { safeHref } from '@/lib/safe-href'
import { STATUS_LOOK } from '../status-look'
import { STATUS_WORDS } from '../words'
import { FadeSwap } from './fade-swap'
import { NEW_TAB, OPEN_IN_HUBSPOT, PRE_READ } from './words'

/** A company's own record, like "/companies/101" or "/companies/lead%3A7". */
function companyHref(key: string): string {
  return `/companies/${encodeURIComponent(key)}`
}

/**
 * The pre-read's status, as on Meetings' rows. A screen reader hears it when it changes. Sent by
 * the rep here and now (`justSent`), its tick draws once as the new badge comes in.
 */
function StatusMark({ status, justSent }: { status: MeetingFormOut['status']; justSent: boolean }) {
  const { icon: Icon, ink } = STATUS_LOOK[status]
  return (
    <span role="status" data-slot="pre-read-status" className="inline-flex">
      <FadeSwap swapKey={status} className="inline-flex">
        <Badge variant="outline" className={ink}>
          {status === 'sent' && justSent ? <TickIn /> : <Icon aria-hidden="true" />}
          {STATUS_WORDS[status]}
        </Badge>
      </FadeSwap>
    </span>
  )
}

function OpenInHubSpot({ meetingId }: { meetingId: string | null }) {
  const meeting = useMeeting(meetingId)
  const href = safeHref(meeting.data?.meeting.hubspot_url)
  if (meetingId && meeting.isPending) {
    // Its place, unseen and out of the keyboard's way, until the meeting answers.
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        tabIndex={-1}
        aria-hidden="true"
        className="invisible touch:h-11"
      >
        <ExternalLink aria-hidden="true" />
        {OPEN_IN_HUBSPOT}
      </Button>
    )
  }
  if (!href) return null
  return (
    <Button asChild variant="outline" size="sm" className="touch:h-11">
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        <ExternalLink aria-hidden="true" />
        {OPEN_IN_HUBSPOT}
        <span className="sr-only"> {NEW_TAB}</span>
      </a>
    </Button>
  )
}

export function PreReadHeader({
  form,
  justSent,
}: {
  form: MeetingFormOut
  /** The rep sent it from this page just now: "Sent" draws its tick once. */
  justSent: boolean
}) {
  const { meeting } = form
  return (
    <PageHeader
      icon={FileText}
      tone="companies"
      title={meeting.title.trim() || PRE_READ}
      description={
        <Link
          to={companyHref(meeting.company_key)}
          className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          {meeting.company_name}
        </Link>
      }
      // A column: the status line sits under the title whatever the width of its word.
      className="flex-col gap-3"
      actions={
        // In line with the title's words, past the 40px tile and its 12px gap.
        <div data-slot="pre-read-status-line" className="flex flex-wrap items-center gap-2 pl-13">
          <StatusMark status={form.status} justSent={justSent} />
          <OpenInHubSpot meetingId={meeting.meeting_id} />
        </div>
      }
    />
  )
}
