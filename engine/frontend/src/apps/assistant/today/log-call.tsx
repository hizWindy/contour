/**
 * Log call from Today (PLAN-V22 choice 8: L, or a call task's "Log a call"): Call logs' own panel,
 * opened straight on the note for the row's company (`LogCallSheet`, `from: 'direct'`), so the rep
 * stays on Today. Its code, with the note view's, loads the first time it is asked for.
 */
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { LogCallSheet, type LogTarget } from '@/apps/companies/call-logs/log-call'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'

export interface TodayLogCallProps {
  /** The company to log a call with, or null while the panel is shut. */
  target: LogTarget | null
  onClose: () => void
}

export default function TodayLogCall({ target, onClose }: TodayLogCallProps) {
  const options = useCallNoteOptions()
  const onPhone = useMediaQuery(PHONE)
  return (
    <LogCallSheet
      state={target ? { from: 'direct', target } : null}
      options={options.data}
      onPhone={onPhone}
      // Opened for one company: there is no list to pick from or go back to.
      onPickCompany={() => undefined}
      onBackToList={() => undefined}
      onClose={onClose}
    />
  )
}
