/**
 * The pre-read (PLAN-V17 T3-10, "The screens" part 6), at /companies/meetings/{form_id}: its own
 * page under Meetings, so Track 2's morning email can link to it and it opens straight from that
 * link.
 *
 * Top to bottom: the meeting (`header.tsx`), who got it if it was sent (`sent.tsx`), the facts
 * with no AI (`facts.tsx`), the three summaries with the pencil and Redraft (`summaries.tsx`),
 * then the rep's two blanks and "Check and send", the one Navy button (`your-part.tsx`), which
 * opens the send dialog with the email and the people (`send-dialog.tsx`, T3-11).
 *
 * - **While it drafts** (a new pre-read, or a redraft), the page asks again every 2 seconds and
 *   stops once it is ready or failed (`useMeetingForm`). What changes doesn't move: the status
 *   fades from one word to the next, and the summaries take the place of their grey blocks.
 * - **Every state is drawn:** loading (a still shape of the page after 200ms), not found (a 404,
 *   or an address that can't be a pre-read: plain words and the way back to Meetings), pre-meeting
 *   forms switched off (the words Meetings uses), and any other failure in the error box. Not
 *   found sits in the page's own frame, as switched off does, not on the full error page: importing
 *   that here split a part of the first visit's main file into a file of its own (one more file to
 *   load, about 1 kB more).
 * - Meetings' rows follow the form, so Back shows where it stands at once.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  isFormMissing,
  isMeetingFormsOff,
  putFormOnRows,
  useMeetingForm,
} from '@/api/hooks/meetings'
import type { MeetingFormOut } from '@/api/types'
import { BackButton } from '@/components/back-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { MEETINGS_PATH } from '../params'
import { MeetingFormsOff } from '../states'
import { FactsRowsPending, FactsSection } from './facts'
import { PreReadHeader } from './header'
import { SendDialog } from './send-dialog'
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

/**
 * The still shape of the page while it loads: the header with its status line, the facts (their
 * own still rows), the summaries.
 */
function PreReadPending() {
  return (
    <>
      <Back />
      <Pending label={LOADING}>
        <div className="flex max-w-3xl flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            </div>
            <div className="pl-13">
              <Skeleton className="h-8 w-56 touch:h-11" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <FactsRowsPending />
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

/** The page's own title, for the states with no meeting to name. */
function PlainHeader() {
  return <PageHeader icon={FileText} tone="companies" title={PRE_READ} />
}

/**
 * Not there for this person (404), or an address whose id can't be a pre-read's: plain words and
 * the way back to Meetings, in the page's own frame, as the switched-off state is.
 */
function PreReadMissing() {
  return (
    <>
      <PlainHeader />
      <EmptyState
        icon={SearchX}
        title={MISSING_TITLE}
        description={MISSING_DESCRIPTION}
        headingLevel={2}
        action={
          <Button asChild variant="outline">
            <Link to={MEETINGS_PATH}>
              <ArrowLeft aria-hidden="true" />
              {BACK_TO_MEETINGS}
            </Link>
          </Button>
        }
      />
    </>
  )
}

function PreReadView({ form }: { form: MeetingFormOut }) {
  const client = useQueryClient()
  const onPhone = useMediaQuery(PHONE)
  const [sending, setSending] = useState(false)
  // Sent from this page just now: "Sent" draws its tick once.
  const [justSent, setJustSent] = useState(false)
  const { id, status } = form
  const meetingId = form.meeting.meeting_id
  useEffect(() => {
    putFormOnRows(client, { id, status }, meetingId)
  }, [client, id, status, meetingId])
  return (
    <>
      <Back />
      {/*
        One column, the header in it, with the status on its own line under the title. On a
        phone the page ends above "Check and send", which stays at the bottom while it is offered.
      */}
      <div
        className={cn(
          'flex w-full max-w-3xl flex-col gap-8',
          onPhone && status !== 'sent' && 'pb-28',
        )}
      >
        <PreReadHeader form={form} justSent={justSent} />
        <SentNote form={form} />
        <FactsSection form={form} />
        <SummariesSection form={form} />
        <YourPart
          form={form}
          onCheckAndSend={() => {
            setSending(true)
          }}
        />
      </div>
      <SendDialog
        form={form}
        open={sending}
        onOpenChange={setSending}
        onSent={() => {
          setJustSent(true)
        }}
      />
    </>
  )
}

export default function PreReadPage() {
  const { formId = '' } = useParams()
  const form = useMeetingForm(formId)

  // Keyed by the form, so another pre-read starts with its own boxes closed and its own blanks.
  if (form.data) return <PreReadView key={form.data.id} form={form.data} />
  if (form.error) {
    if (isFormMissing(form.error)) return <PreReadMissing />
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
