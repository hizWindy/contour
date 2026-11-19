/**
 * Log call from Today (PLAN-V22 choice 8: L, or a call task's "Log a call"): Call logs' own panel,
 * opened straight on the note for the row's company (`LogCallSheet`, `from: 'direct'`), so the rep
 * stays on Today. Its code, with the note view's, loads the first time it is asked for. As it
 * closes, the focus goes back to the row it came from (`focusBack`, PLAN-V23 T4-3).
 */
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { LogCallSheet, type LogTarget } from '@/apps/companies/call-logs/log-call'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'

export interface TodayLogCallProps {
  /** The company to log a call with, or null while the panel is shut. */
  target: LogTarget | null
  onClose: () => void
  /** As the panel closes: puts the focus back on the row, and says whether it could. */
  focusBack?: () => boolean
}

export default function TodayLogCall({ target, onClose, focusBack }: TodayLogCallProps) {
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
      focusBack={focusBack}
    />
  )
}
