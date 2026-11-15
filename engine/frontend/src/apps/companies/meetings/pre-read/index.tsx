/**
 * The pre-read (PLAN-V17 T3-10, "The screens" part 6), at /companies/meetings/{form_id}: its own
 * page under Meetings, so Track 2's morning email can link to it and it opens straight from that
 * link.
 *
 * Top to bottom: the meeting (`header.tsx`), who got it if it was sent (`sent.tsx`), the facts
 * with no AI (`facts.tsx`), the three summaries with the pencil and Redraft (`summaries.tsx`),
 * then the rep's two blanks and "Check and send", the one Navy button (`your-part.tsx`).
 *
 * - **While it drafts** (a new pre-read, or a redraft), the page asks again every 2 seconds and
 *   stops once it is ready or failed (`useMeetingForm`). What changes doesn't move: the status
 *   fades from one word to the next, and the summaries take the place of their grey blocks.
 * - **Every state is drawn:** loading (a still shape of the page after 200ms), not found (a 404,
 *   or an address that can't be a pre-read: plain words and the way back to Meetings), pre-meeting
 *   forms switched off (the words Meetings uses), and any other failure in the error box.
 * - Meetings' rows follow the form, so Back shows where it stands at once.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, SearchX } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import type { ApiProblem } from '@/api/client'
import {
  isFormMissing,
  isMeetingFormsOff,
  putFormOnRows,
  useMeetingForm,
} from '@/api/hooks/meetings'
import type { MeetingFormOut } from '@/api/v17'
import { BackButton } from '@/components/back-button'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { ErrorPage } from '@/shell/error-pages/error-page'
import { MEETINGS_PATH } from '../params'
import { MeetingFormsOff } from '../states'
import { FactsSection } from './facts'
import { PreReadHeader } from './header'
import { SentNote } from './sent'
import { SummariesSection } from './summaries'
import {
  BACK_TO_MEETINGS,
  LOAD_FAILED,
  LOADING,
  MEETINGS,
  MISSING_DESCRIPTION,
  MISSING_TITLE,
  PRE_READ,
} from './words'
import { YourPart } from './your-part'

/** Back to Meetings: the page before, or Meetings itself when the page opened from a link. */
function Back() {
  return <BackButton fallbackTo={MEETINGS_PATH} fallbackLabel={MEETINGS} />
}

/** The still shape of the page while it loads: the header, the facts, the summaries, the blanks. */
function PreReadPending() {
  return (
    <>
      <Back />
      <Pending label={LOADING}>
        <div className="flex max-w-3xl flex-col gap-8">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-5 w-3/4" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <div className="flex flex-col divide-y rounded-lg border bg-card">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-4/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Pending>
    </>
  )
}

/** Not there for this person (404), or an address whose id can't be a pre-read's. */
function PreReadMissing({ problem }: { problem: ApiProblem }) {
  return (
    <ErrorPage
      icon={SearchX}
      title={MISSING_TITLE}
      description={MISSING_DESCRIPTION}
      problem={problem}
      actions={
        <Button asChild variant="outline">
          <Link to={MEETINGS_PATH}>
            <ArrowLeft aria-hidden="true" />
            {BACK_TO_MEETINGS}
          </Link>
        </Button>
      }
    />
  )
}

/** The page's own title, for the states with no meeting to name. */
function PlainHeader() {
  return <PageHeader icon={FileText} tone="companies" title={PRE_READ} />
}

function PreReadView({ form }: { form: MeetingFormOut }) {
  const client = useQueryClient()
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const { id, status } = form
  const meetingId = form.meeting.meeting_id
  useEffect(() => {
    putFormOnRows(client, { id, status }, meetingId)
  }, [client, id, status, meetingId])
  return (
    <>
      <Back />
      {/*
        One column, the header in it, so the status sits at the edge of what it describes. On a
        phone the page ends above "Check and send", which stays at the bottom.
      */}
      <div className={cn('flex w-full max-w-3xl flex-col gap-8', onPhone && 'pb-28')}>
        <PreReadHeader form={form} today={today} />
        <SentNote form={form} />
        <FactsSection form={form} />
        <SummariesSection form={form} />
        <YourPart
          form={form}
          // T3-11 opens the Alert Dialog with the email and the people here.
          onCheckAndSend={() => undefined}
        />
      </div>
    </>
  )
}

export default function PreReadPage() {
  const { formId = '' } = useParams()
  const form = useMeetingForm(formId)

  // Keyed by the form, so another pre-read starts with its own boxes closed and its own blanks.
  if (form.data) return <PreReadView key={form.data.id} form={form.data} />
  if (form.error) {
    if (isFormMissing(form.error)) return <PreReadMissing problem={form.error} />
    if (isMeetingFormsOff(form.error)) {
      return (
        <>
          <Back />
          <PlainHeader />
          <MeetingFormsOff />
        </>
      )
    }
    return (
      <>
        <Back />
        <PlainHeader />
        <ErrorState error={form.error} context={LOAD_FAILED} onRetry={() => void form.refetch()} />
      </>
    )
  }
  return <PreReadPending />
}
