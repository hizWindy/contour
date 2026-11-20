/**
 * Pick company (PLAN-V24 T3-3, choice 20): the company of a call saved before it was found. It is
 * Log call's company search (`company-list.tsx`), not a second one, in the same panel from the right
 * (576px, or the whole screen on a phone), titled "Pick company", with the search already holding
 * the name as heard and the line "Heard as "North Wind". Which company was the call with?".
 *
 * - The search box has the focus as it opens, with the name chosen, so typing replaces it. Arrow
 *   keys move, Enter or a click picks, Esc closes.
 * - A pick closes the panel; the page sends it (`use-pick.ts`). Where the focus goes as the panel
 *   closes is the page's to say (`focusBack`): the call's own Pick company after Esc, the next call
 *   after a pick.
 */
import { useRef, useState } from 'react'
import type { CallNoteOut } from '@/api/types'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { CompanyList, type CompanyPick } from './company-list'
import { SIDE_PANEL } from './log-call'
import { heardWords, PICK_COMPANY, pickCompanyLine } from './words'

export interface PickCompanySheetProps {
  /** The call whose company is being picked, or null when the panel is shut. */
  note: CallNoteOut | null
  onPhone: boolean
  onPick: (note: CallNoteOut, company: CompanyPick) => void
  onClose: () => void
  /** Puts the focus back as the panel closes. */
  focusBack: () => void
}

export function PickCompanySheet({
  note,
  onPhone,
  onPick,
  onClose,
  focusBack,
}: PickCompanySheetProps) {
  // While the panel slides shut, it keeps showing what it had.
  const [shown, setShown] = useState(note)
  if (note !== null && note !== shown) {
    setShown(note)
  }
  const search = useRef<HTMLInputElement>(null)
  const heard = shown?.company_heard?.trim() ?? ''

  return (
    <Sheet
      open={note !== null}
      // On a laptop the page stays usable beside the panel; on a phone the panel is the screen.
      modal={onPhone}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className={SIDE_PANEL}
        onInteractOutside={(event) => {
          event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          search.current?.focus()
          search.current?.select()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          focusBack()
        }}
      >
        {shown ? (
          <CompanyList
            // A new call starts its own search, from its own name as heard.
            key={shown.id}
            active
            inputRef={search}
            title={PICK_COMPANY}
            description={pickCompanyLine(heard ? heardWords(heard) : null)}
            startWith={heard}
            onPick={(company) => {
              onPick(shown, company)
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
