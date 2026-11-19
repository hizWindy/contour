/**
 * Today's "Pre-reads for you" (PLAN-V23 T2-4, choice 9): the pre-reads a teammate sent me, for
 * meetings from today on, soonest first (at most 20, as the server lists them). It works with or
 * without a HubSpot user: the server finds them by my HubSpot user and by my own address.
 *
 * - **Each row** says when the meeting is ("Tomorrow, 2:00 pm"), its company, its title and who
 *   sent it. Its one button, Open, opens the pre-read, as Enter on the row does.
 * - **The rows are Today's rows** (`RowShell`): J and K move through them with the rest, and L logs
 *   a call with the row's company.
 * - The part shows only where the server lists it: a pre-read opens only with the Meetings tick.
 *   Today places it right after Meetings, in Today's own part card.
 */
import { useId } from 'react'
import { meetingDay } from '@/apps/companies/meetings/words'
import { preReadRowId, type TodayPreRead, type TodayRow } from './rows'
import { ActButton, RowShell, type RowBase } from './rows-view'
import { sentByWords } from './words'

/** One pre-read sent to me. */
export function PreReadRow({
  preRead,
  day,
  ...base
}: RowBase & { preRead: TodayPreRead; day: string }) {
  const labelId = useId()
  const timeId = useId()
  const when = meetingDay(preRead.starts_at, day)
  const sender = preRead.sent_by?.trim()
  const context = `: the pre-read for ${preRead.company.name}, ${when}`
  return (
    <RowShell
      {...base}
      labelledBy={`${timeId} ${labelId}`}
      words={
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={timeId} className="text-caption text-muted-foreground tabular-nums">
            {when}
          </p>
          <p id={labelId} className="font-semibold break-words text-foreground">
            {preRead.company.name}
          </p>
          {preRead.title.trim() ? (
            <p className="line-clamp-1 break-words text-foreground">{preRead.title}</p>
          ) : null}
          {sender ? (
            <p className="text-caption break-words text-muted-foreground">{sentByWords(sender)}</p>
          ) : null}
        </div>
      }
      buttons={base.main ? <ActButton act={base.main} context={context} /> : null}
    />
  )
}

/** The part's rows, soonest first. Today shows the empty line itself, as for its other parts. */
export function PreReadRows({
  preReads,
  day,
  rowProps,
}: {
  preReads: readonly TodayPreRead[]
  day: string
  /** Today's own props for a row: active, its main button, Enter. */
  rowProps: (row: TodayRow) => RowBase
}) {
  return (
    <ul className="divide-y border-t">
      {preReads.map((preRead) => {
        const row: TodayRow = { kind: 'pre_read', id: preReadRowId(preRead), preRead }
        return (
          <li key={row.id}>
            <PreReadRow {...rowProps(row)} preRead={preRead} day={day} />
          </li>
        )
      })}
    </ul>
  )
}
