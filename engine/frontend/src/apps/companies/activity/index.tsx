/**
 * Activity (PLAN-V17 T3-6, "The screens" part 3), at /companies/activity: the calls the rep logged,
 * in three tabs with a sliding underline (`TabIndicator`).
 *
 * - **To confirm:** one card per call, to check and fix, then one Navy button sends them all to
 *   HubSpot (`to-confirm.tsx`).
 * - **Logged:** what is in HubSpot, each with "Open in HubSpot" (`logged.tsx`).
 * - **Needs a look:** a save that failed, or one HubSpot may or may not have, with what to do
 *   (`needs-look.tsx`).
 *
 * The rep sees their own notes (`mine`). A team view for Admins is TBC. The tab is in the address,
 * so a link or Back opens the same one. "Log call" in the header logs a call that wasn't prepped
 * (`log-call.tsx`). Ctrl+K's "Log a call" opens this page with `?log=1` (T3-7): the company
 * picker opens once call notes are known to be on, and the address drops `log` at once, so Back
 * or a reload doesn't open it again. While HubSpot isn't ready for writing, one quiet line above
 * the tabs says so, in the server's words; everything up to the send still works. With call notes
 * off, the page says so in plain words.
 */
import { ClipboardCheck, Hourglass } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useCallNoteOptions, useCallNoteSummary } from '@/api/hooks/call-notes'
import { ErrorState } from '@/components/error-state'
import { RollingNumber, TabIndicator } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { LogCallPicker, LogCallSheet, type LogTarget } from './log-call'
import { Logged } from './logged'
import { NeedsLook } from './needs-look'
import { ACTIVITY_TABS, readLog, readTab, withoutLog, writeTab, type ActivityTab } from './params'
import { CallNotesOff, CardsPending } from './states'
import { ToConfirm } from './to-confirm'
import { useBatch } from './use-batch'
import {
  ACTIVITY_DESCRIPTION,
  ACTIVITY_TITLE,
  LOAD_FAILED,
  TAB_LOGGED,
  TAB_NEEDS_LOOK,
  TAB_TO_CONFIRM,
  waitingLine,
} from './words'

const TAB_LABELS: Readonly<Record<ActivityTab, string>> = {
  to_confirm: TAB_TO_CONFIRM,
  logged: TAB_LOGGED,
  needs_look: TAB_NEEDS_LOOK,
}

export default function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const tab = readTab(params)
  const options = useCallNoteOptions()
  const summary = useCallNoteSummary()
  // Here, not in the tab: a batch carries on, and still says how it went, while another tab is
  // open (a tab that isn't shown is taken off the page).
  const batch = useBatch()
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const [logging, setLogging] = useState<LogTarget | null>(null)
  const [picking, setPicking] = useState(false)
  const notes = options.data
  const on = notes?.enabled === true

  // `?log=1` (Ctrl+K's "Log a call"): the picker opens once call notes are known to be on. Set
  // while rendering, not in an effect, so it opens with the page. `answered` stops it opening twice
  // for the same ask, and resets once the address has dropped `log`.
  const asked = readLog(params)
  const [answered, setAnswered] = useState(false)
  if (asked && on && !answered) {
    setAnswered(true)
    setPicking(true)
  }
  if (!asked && answered) {
    setAnswered(false)
  }
  // The address drops `log` as soon as the switches are known (on or off), with `replace`.
  useEffect(() => {
    if (asked && notes) {
      setParams((current) => withoutLog(current), { replace: true, preventScrollReset: true })
    }
  }, [asked, notes, setParams])

  // The counts on the tabs (To confirm and Needs a look), when there are some.
  const counts: Partial<Record<ActivityTab, number>> = {
    to_confirm: summary.data?.to_confirm,
    needs_look: summary.data?.needs_look,
  }

  let body
  if (options.error) {
    body = (
      <ErrorState
        error={options.error}
        context={LOAD_FAILED}
        onRetry={() => void options.refetch()}
      />
    )
  } else if (!notes) {
    body = <CardsPending />
  } else if (!notes.enabled) {
    body = <CallNotesOff />
  } else {
    body = (
      <>
        {notes.sending_ready ? null : (
          <p
            role="status"
            data-slot="waiting-line"
            className="flex items-start gap-2 text-ui text-muted-foreground"
          >
            <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {waitingLine(notes.waiting_for)}
          </p>
        )}
        <Tabs
          value={tab}
          onValueChange={(next) => {
            const picked = ACTIVITY_TABS.find((value) => value === next)
            if (picked) {
              setParams(writeTab(params, picked), { replace: true, preventScrollReset: true })
            }
          }}
          className="gap-4"
        >
          <TabsList
            aria-label="Your calls by where they stand"
            className="w-full justify-start overflow-x-auto [scrollbar-width:none] max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:px-4"
          >
            {ACTIVITY_TABS.map((value) => {
              const count = counts[value]
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-none touch:min-h-11 focus-visible:outline-offset-[-2px]"
                >
                  {TAB_LABELS[value]}{' '}
                  {count ? (
                    <span className="text-caption text-muted-foreground">
                      <RollingNumber value={count} />
                    </span>
                  ) : null}
                  <TabIndicator group="activity-tabs" active={tab === value} />
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value="to_confirm">
            <ToConfirm options={notes} today={today} onPhone={onPhone} batch={batch} />
          </TabsContent>
          <TabsContent value="logged">
            <Logged today={today} />
          </TabsContent>
          <TabsContent value="needs_look">
            <NeedsLook ready={notes.sending_ready} today={today} />
          </TabsContent>
        </Tabs>
      </>
    )
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        tone="companies"
        title={ACTIVITY_TITLE}
        description={onPhone ? undefined : ACTIVITY_DESCRIPTION}
        actions={
          on ? (
            <LogCallPicker open={picking} onOpenChange={setPicking} onPick={setLogging} />
          ) : undefined
        }
      />
      {body}
      <LogCallSheet
        target={logging}
        options={notes}
        onPhone={onPhone}
        onClose={() => {
          setLogging(null)
        }}
      />
    </>
  )
}
