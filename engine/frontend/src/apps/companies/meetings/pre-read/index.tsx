/**
 * The pre-read (PLAN-V17 T3-10, "The screens" part 6), at /companies/meetings/{form_id}: its own
 * page under Meetings, so the morning email can link to it and it opens straight from that link.
 *
 * **One centered form** (PLAN-V18 T2-5), about 840px wide (TBC after Al-khair's look), one card on
 * the page's background, like a sheet of paper, in HubSpot's form pattern with Contour's look. Top
 * to bottom: the meeting's title and company with the status (`header.tsx`), who got it if it was
 * sent (`sent.tsx`), then the card: the draft's steps while AI drafts it (`draft-progress.tsx`),
 * four numbered sections (1 The meeting and 2 The company, the facts with no AI, `facts.tsx`; 3
 * The summaries, boxes the rep types into, `summaries.tsx`; 4 Your part, two required blanks,
 * `your-part.tsx`), and a footer that stays at the bottom of the form with the status and "Check
 * and send", the one Navy button, which opens the send dialog (`send-dialog.tsx`, T3-11).
 *
 * - **It opens once:** the four sections rise 4px and fade in, 40ms apart (`Reveal`). The footer
 *   stays still. With reduced motion everything is simply there.
 * - **Keyboard:** Tab goes from top to bottom. Ctrl+Enter (or Cmd+Enter) opens "Check and send";
 *   while it can't be pressed, the focus goes to the first blank still to fill.
 * - **Phone:** one column, and the footer is fixed at the bottom of the screen, above the safe area.
 * - **While it drafts** (a new pre-read, or a redraft), the page asks again every 2 seconds and
 *   stops once it is ready or failed (`useMeetingForm`). What changes doesn't move: the status
 *   fades from one word to the next, the facts take the place of their still fields, and the
 *   summaries of their grey blocks. The draft's steps fill as each real state arrives, and a
 *   failed draft stops at its step with why and Try again.
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
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
import { Reveal } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBarRoom } from '@/lib/use-bar-room'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { MEETINGS_PATH } from '../params'
import { MeetingFormsOff } from '../states'
import { DraftProgress } from './draft-progress'
import { CompanyFields, FieldsPending, MeetingFields } from './facts'
import { FormSection } from './form-section'
import { PreReadHeader } from './header'
import { BLANK_MAX_CHARS, sendBlock } from './rules'
import { SendDialog } from './send-dialog'
import { SentNote } from './sent'
import { SummariesSection } from './summaries'
import { useBlank } from './use-blank'
import {
  BACK_TO_MEETINGS,
  FACTS_NOTE,
  GOING,
  GOING_PLACEHOLDER,
  LOAD_FAILED,
  LOADING,
  MEETINGS,
  MISSING_DESCRIPTION,
  MISSING_TITLE,
  NEXT_STEP,
  NEXT_STEP_PLACEHOLDER,
  PRE_READ,
  THE_COMPANY,
  THE_MEETING,
  YOUR_PART,
  YOUR_PART_NOTE,
} from './words'
import { BlankField, FormFooter } from './your-part'

/** The form's width: about 840px (TBC after Al-khair's look). */
const COLUMN = 'mx-auto flex w-full max-w-[52.5rem] flex-col'

/** Back to Meetings: the page before, or Meetings itself when the page opened from a link. */
function Back() {
  return <BackButton fallbackTo={MEETINGS_PATH} fallbackLabel={MEETINGS} />
}

/** The column every state of the page sits in, centered. */
function Column({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(COLUMN, 'gap-6', className)}>{children}</div>
}

/** A section's still shape while the page loads: its heading and line, then its fields. */
function SectionPending({ fields }: { fields: number }) {
  return (
    <div className="flex flex-col gap-4 px-6 py-6 max-sm:px-4">
      <div className="border-b pb-3">
        <Skeleton className="h-6 w-40" />
      </div>
      <FieldsPending count={fields} />
    </div>
  )
}

/**
 * The still shape of the page while it loads: the header with its status line, then the form's
 * card with its sections and its footer.
 */
function PreReadPending() {
  return (
    <Column>
      <Back />
      <Pending label={LOADING}>
        <div className="flex flex-col gap-6">
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
          <div className="flex flex-col divide-y rounded-lg border bg-card">
            <SectionPending fields={5} />
            <SectionPending fields={5} />
            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-9 w-36 touch:h-11" />
            </div>
          </div>
        </div>
      </Pending>
    </Column>
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
    <Column>
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
    </Column>
  )
}

function PreReadView({ form }: { form: MeetingFormOut }) {
  const client = useQueryClient()
  const onPhone = useMediaQuery(PHONE)
  const [sending, setSending] = useState(false)
  // Sent from this page just now: "Sent" draws its tick once.
  const [justSent, setJustSent] = useState(false)
  // When the form was last saved on this visit, for the footer's "saved 2:14 pm".
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const onSaved = (): void => {
    setSavedAt(new Date().toISOString())
  }
  const nextStep = useBlank(form, 'next_step', NEXT_STEP, onSaved)
  const going = useBlank(form, 'going', GOING, onSaved)
  const nextStepBox = useRef<HTMLTextAreaElement>(null)
  const goingBox = useRef<HTMLTextAreaElement>(null)
  const block = sendBlock({
    status: form.status,
    nextStep: nextStep.text,
    going: going.text,
    unsaved: nextStep.state === 'failed' || going.state === 'failed',
  })
  // The footer stays over the form's end: a field the keyboard lands on scrolls above it.
  const barRoom = useBarRoom(form.status !== 'sent')
  // Seen drafting on this visit: the draft's steps stay, full, once it is ready (PLAN-V18 T2-4).
  const [sawDrafting, setSawDrafting] = useState(form.status === 'drafting')
  if (form.status === 'drafting' && !sawDrafting) setSawDrafting(true)
  const showSteps =
    form.status === 'drafting' ||
    form.status === 'failed' ||
    (form.status === 'draft' && sawDrafting)
  const { status } = form
  const meetingId = form.meeting.meeting_id
  useEffect(() => {
    putFormOnRows(client, form, meetingId)
  }, [client, form, meetingId])

  /** Ctrl+Enter: Check and send, or the first blank still to fill. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || status === 'sent') return
    event.preventDefault()
    if (block === null) {
      setSending(true)
      return
    }
    if (block === 'both' || block === 'next_step') nextStepBox.current?.focus()
    else if (block === 'going') goingBox.current?.focus()
  }

  return (
    <Column className={cn(onPhone && status !== 'sent' && 'pb-36')}>
      <Back />
      <PreReadHeader form={form} justSent={justSent} />
      <SentNote
        form={form}
        onSendToMore={() => {
          setSending(true)
        }}
      />
      <article
        data-slot="pre-read-form"
        aria-label={PRE_READ}
        className="flex flex-col rounded-lg border bg-card"
        onKeyDown={onKeyDown}
      >
        {showSteps ? (
          <DraftProgress form={form} className="border-b px-6 py-6 max-sm:px-4" />
        ) : null}
        <div className="flex flex-col divide-y">
          <Reveal index={0}>
            <FormSection number={1} title={THE_MEETING}>
              <MeetingFields form={form} />
            </FormSection>
          </Reveal>
          <Reveal index={1}>
            <FormSection number={2} title={THE_COMPANY} note={FACTS_NOTE}>
              <CompanyFields form={form} />
            </FormSection>
          </Reveal>
          <Reveal index={2}>
            <SummariesSection form={form} number={3} onSaved={onSaved} />
          </Reveal>
          <Reveal index={3}>
            <FormSection number={4} title={YOUR_PART} note={YOUR_PART_NOTE}>
              <div className="flex flex-col gap-4">
                <BlankField
                  ref={nextStepBox}
                  label={NEXT_STEP}
                  placeholder={NEXT_STEP_PLACEHOLDER}
                  blank={nextStep}
                  max={BLANK_MAX_CHARS}
                />
                <BlankField
                  ref={goingBox}
                  label={GOING}
                  placeholder={GOING_PLACEHOLDER}
                  blank={going}
                  max={BLANK_MAX_CHARS}
                />
              </div>
            </FormSection>
          </Reveal>
        </div>
        <FormFooter
          form={form}
          block={block}
          savedAt={savedAt}
          onPhone={onPhone}
          barRoom={barRoom}
          onCheckAndSend={() => {
            setSending(true)
          }}
        />
      </article>
      <SendDialog
        form={form}
        open={sending}
        onOpenChange={setSending}
        onSent={() => {
          setJustSent(true)
        }}
      />
    </Column>
  )
}

export default function PreReadPage() {
  const { formId = '' } = useParams()
  const form = useMeetingForm(formId)

  // Keyed by the form, so another pre-read starts with its own boxes and its own blanks.
  if (form.data) return <PreReadView key={form.data.id} form={form.data} />
  if (form.error) {
    if (isFormMissing(form.error)) return <PreReadMissing />
    if (isMeetingFormsOff(form.error)) {
      return (
        <Column>
          <Back />
          <PlainHeader />
          <MeetingFormsOff />
        </Column>
      )
    }
    return (
      <Column>
        <Back />
        <PlainHeader />
        <ErrorState error={form.error} context={LOAD_FAILED} onRetry={() => void form.refetch()} />
      </Column>
    )
  }
  return <PreReadPending />
}
