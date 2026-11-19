/**
 * "Log call" on Call logs (PLAN-V19 T2-2, choice 15):
 *
 * - "Log call" (or Ctrl+K's "Log a call") opens a 576px Sheet from the right (full screen at
 *   390px, sliding in over 400ms on `smooth`).
 * - Opened from the header / Ctrl+K, the panel starts on the company list (`company-list.tsx`)
 *   with the search box focused, the newest companies listed 50 at a time, and live search from 2
 *   letters. Arrow keys and Enter pick a company.
 * - Picking a company slides `NoteView` (`call-notes/note-view.tsx`) in via `PushView`, with a
 *   back arrow to return to the list while keeping the typed search and returning focus to it.
 * - Opened directly for a company from History ("Log another call with ..."), it opens straight
 *   on `NoteView` with no back arrow.
 * - Esc closes the panel cleanly in either view.
 */
import { NotebookPen } from 'lucide-react'
import { useRef, useState } from 'react'
import { useCompany } from '@/api/hooks'
import type { CallNoteOptions } from '@/api/types'
import { useCan } from '@/auth/can'
import { PushView } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { NoteView } from '../call-notes/note-view'
import { LOG_CALL } from '../call-notes/words'
import { CompanyList } from './company-list'
import { BACK_TO_COMPANIES } from './words'

export interface LogTarget {
  companyKey: string
  companyName: string
}

export type LogCallState =
  { from: 'picker'; picked: LogTarget | null } | { from: 'direct'; target: LogTarget }

export function LogCallButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button type="button" variant="outline" data-slot="log-call" onClick={onOpen}>
      <NotebookPen aria-hidden="true" />
      {LOG_CALL}
    </Button>
  )
}

/** The Log call panel from the right, 576px wide, or the whole screen on a phone. */
export function LogCallSheet({
  state,
  options,
  onPhone,
  onPickCompany,
  onBackToList,
  onClose,
  focusBack,
}: {
  state: LogCallState | null
  options: CallNoteOptions | undefined
  onPhone: boolean
  onPickCompany: (target: LogTarget) => void
  onBackToList: () => void
  onClose: () => void
  /**
   * As it closes, the page that opened it puts the focus back where it belongs (Today: the row it
   * came from, PLAN-V23 T4-3), and says whether it could. Else Call logs' own Log call button.
   */
  focusBack?: () => boolean
}) {
  // While the panel slides shut, it keeps showing what it had.
  const [shown, setShown] = useState(state)
  if (state !== null && state !== shown) {
    setShown(state)
  }

  const activeTarget = shown?.from === 'direct' ? shown.target : (shown?.picked ?? null)
  // Staff with only the Call logs tick cannot call GET /companies/{key}; skip fetching so no 403
  // fires and WhoWith offers "No one in particular".
  const canSeeCompany = useCan('companies.companies')
  const company = useCompany(canSeeCompany ? activeTarget?.companyKey : undefined)
  const panel = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const noteView =
    activeTarget && options ? (
      <NoteView
        key={activeTarget.companyKey}
        companyKey={activeTarget.companyKey}
        companyName={activeTarget.companyName}
        person={null}
        company={company.data}
        companyFailed={canSeeCompany && Boolean(company.error)}
        peopleHidden={!canSeeCompany}
        prepId={null}
        options={options}
        onPhone={onPhone}
        backLabel={shown?.from === 'picker' ? BACK_TO_COMPANIES : undefined}
        onBack={
          shown?.from === 'picker'
            ? () => {
                onBackToList()
                requestAnimationFrame(() => {
                  searchInput.current?.focus()
                })
              }
            : undefined
        }
        onSaved={onClose}
      />
    ) : null

  return (
    <Sheet
      open={state !== null}
      // On a laptop the list stays usable beside the panel; on a phone the panel is the screen.
      modal={onPhone}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        ref={panel}
        side="right"
        className="w-full max-w-full gap-0 p-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-open:duration-(--duration-smooth) data-open:ease-(--spring-smooth) data-closed:duration-(--duration-exit)"
        onInteractOutside={(event) => {
          event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (shown?.from === 'picker' && shown.picked === null) {
            searchInput.current?.focus()
            return
          }
          panel.current?.querySelector('textarea')?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (focusBack?.()) {
            event.preventDefault()
            return
          }
          const button = document.querySelector<HTMLElement>('[data-slot="log-call"]')
          if (button) {
            event.preventDefault()
            button.focus()
          }
        }}
      >
        {shown?.from === 'picker' ? (
          <PushView pushed={noteView} className="min-h-0 flex-1">
            <CompanyList
              active={shown.picked === null}
              inputRef={searchInput}
              onPick={(picked) => {
                onPickCompany({ companyKey: picked.key, companyName: picked.name })
              }}
            />
          </PushView>
        ) : (
          noteView
        )}
      </SheetContent>
    </Sheet>
  )
}
