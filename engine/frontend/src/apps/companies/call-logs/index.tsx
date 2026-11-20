/**
 * Call logs (PLAN-V17 T3-6, "The screens" part 3; called Activity until PLAN-V18 T3-2), at
 * /assistant/call-logs (the Assistant's since PLAN-V22 T2-1; the code stays here, choice 3): the
 * calls the rep logged, in three tabs with a sliding underline (`TabIndicator`). The old addresses,
 * /companies/call-logs and /companies/activity, send you on (`apps/assistant/old-route.tsx`).
 *
 * - **To confirm:** one card per call, to check and fix, then one Navy button sends them all to
 *   HubSpot (`to-confirm.tsx`).
 * - **History:** every call you logged, newest first, by day, with a search and filters; a call
 *   opens in place (`history.tsx`, PLAN-V18 T3-6). It took the place of Activity's Logged.
 * - **Needs a look:** a save that failed, or one HubSpot may or may not have, with what to do
 *   (`needs-look.tsx`).
 *
 * Above the tabs, "Needs a company" (PLAN-V24 T3-3) lists the calls saved before their company
 * was found, with their count, and only when there are some (`needs-company.tsx`). The page waits
 * for the counts as well as the switches before it draws the tabs, so the group never pushes them
 * down as it arrives.
 *
 * The rep sees their own notes (`mine`). A team view for Admins is TBC. The tab is in the address,
 * so a link or Back opens the same one. "Log call" in the header logs a call that wasn't prepped
 * (`log-call.tsx`). Ctrl+K's "Log a call" opens this page with `?log=1` (T3-7): the company
 * picker opens once call notes are known to be on, and the address drops `log` at once, so Back
 * or a reload doesn't open it again. While HubSpot isn't ready for writing, one quiet line above
 * the tabs says so, in the server's words; everything up to the send still works. With call notes
 * off, the page says so in plain words.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Hourglass, PhoneLog } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useCallNoteOptions, useCallNoteSummary } from '@/api/hooks/call-notes'
import { useCanWrite } from '@/auth/can'
import { FeatureGuard } from '@/auth/guard'
import { ErrorState } from '@/components/error-state'
import { RollingNumber, TabIndicator } from '@/components/motion'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { LogCallButton, LogCallSheet, type LogCallState, type LogTarget } from './log-call'
import { History } from './history'
import { NeedsCompany } from './needs-company'
import { NeedsLook } from './needs-look'
import {
  CALL_LOGS_TABS,
  readHistory,
  readLog,
  readTab,
  withoutLog,
  writeTab,
  type CallLogsTab,
} from './params'
import { warmOtherTabs } from './prefetch'
import { CallNotesOff, CardsPending } from './states'
import { ToConfirm } from './to-confirm'
import { useBatch } from './use-batch'
import {
  CALL_LOGS_DESCRIPTION,
  CALL_LOGS_TITLE,
  LOAD_FAILED,
  TAB_HISTORY,
  TAB_NEEDS_LOOK,
  TAB_TO_CONFIRM,
  waitingLine,
} from './words'

const TAB_LABELS: Readonly<Record<CallLogsTab, string>> = {
  to_confirm: TAB_TO_CONFIRM,
  history: TAB_HISTORY,
  needs_look: TAB_NEEDS_LOOK,
}

function CallLogsContent() {
  const [params, setParams] = useSearchParams()
  const tab = readTab(params)
  const options = useCallNoteOptions()
  const summary = useCallNoteSummary()
  // Here, not in the tab: a batch carries on, and still says how it went, while another tab is
  // open (a tab that isn't shown is taken off the page).
  const batch = useBatch()
  const canLog = useCanWrite('companies.call_logs')
  const onPhone = useMediaQuery(PHONE)
  const today = melbourneDate()
  const [logPanel, setLogPanel] = useState<LogCallState | null>(null)
  const notes = options.data
  const on = notes?.enabled === true

  // Once this tab's list is in, the other two are asked for quietly (Improvements 1, #10), so a
  // click on a tab shows its rows at once, not grey blocks. It joins this tab's own request.
  const client = useQueryClient()
  const search = params.toString()
  useEffect(
    () => (on ? warmOtherTabs(client, tab, readHistory(new URLSearchParams(search))) : undefined),
    [on, client, tab, search],
  )

  // `?log=1` (Ctrl+K's "Log a call"): the panel opens once call notes and access are known (not
  // for a Viewer). Set while rendering, not in an effect, so it opens with the page. `answered`
  // stops it opening twice for the same ask, and resets once the address has dropped `log`.
  const asked = readLog(params)
  const [answered, setAnswered] = useState(false)
  if (asked && on && canLog && !answered) {
    setAnswered(true)
    setLogPanel({ from: 'picker', picked: null })
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
  const counts: Partial<Record<CallLogsTab, number>> = {
    to_confirm: summary.data?.to_confirm,
    needs_look: summary.data?.needs_look,
  }
  // The calls saved before their company was found (PLAN-V24): the group above the tabs.
  const needsCompany = summary.data?.needs_company ?? 0

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
  } else if (summary.isPending) {
    // The counts first: they say whether "Needs a company" sits above the tabs.
    body = <CardsPending />
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
        <NeedsCompany count={needsCompany} today={today} />
        <Tabs
          value={tab}
          onValueChange={(next) => {
            const picked = CALL_LOGS_TABS.find((value) => value === next)
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
            {CALL_LOGS_TABS.map((value) => {
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
                  <TabIndicator group="call-logs-tabs" active={tab === value} />
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value="to_confirm">
            <ToConfirm options={notes} today={today} onPhone={onPhone} batch={batch} />
          </TabsContent>
          <TabsContent value="history">
            <History
              options={notes}
              today={today}
              onLogCall={
                canLog
                  ? (target: LogTarget) => {
                      setLogPanel({ from: 'direct', target })
                    }
                  : undefined
              }
            />
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
        icon={PhoneLog}
        tone="companies"
        title={CALL_LOGS_TITLE}
        description={onPhone ? undefined : CALL_LOGS_DESCRIPTION}
        actions={
          on && canLog ? (
            <LogCallButton
              onOpen={() => {
                setLogPanel({ from: 'picker', picked: null })
              }}
            />
          ) : undefined
        }
      />
      {body}
      <LogCallSheet
        state={logPanel}
        options={notes}
        onPhone={onPhone}
        onPickCompany={(picked) => {
          setLogPanel({ from: 'picker', picked })
        }}
        onBackToList={() => {
          setLogPanel((current) =>
            current?.from === 'picker' ? { from: 'picker', picked: null } : current,
          )
        }}
        onClose={() => {
          setLogPanel(null)
        }}
      />
    </>
  )
}

export default function CallLogsPage() {
  return (
    <FeatureGuard feature="companies.call_logs" page="Call logs">
      <CallLogsContent />
    </FeatureGuard>
  )
}
