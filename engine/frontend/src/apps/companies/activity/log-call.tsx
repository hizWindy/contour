/**
 * "Log call" on Activity, for a call that wasn't prepped (PLAN-V17 "The screens", part 1). It asks
 * for the company first, in the company picker (`company-search.tsx`, which New pre-read on
 * Meetings shares). Then it opens Log call's own note view (`call-notes/note-view.tsx`) in a panel
 * from the right, which asks who the call was with. The panel has no script, so the note view
 * shows no back arrow: Esc or Close shuts it. "Save and next" saves at once and closes it; the
 * note joins "To confirm" while it sorts.
 */
import { NotebookPen } from 'lucide-react'
import { useRef, useState } from 'react'
import { useCompany } from '@/api/hooks'
import type { CallNoteOptions } from '@/api/v17'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { NoteView } from '../call-notes/note-view'
import { LOG_CALL } from '../call-notes/words'
import { CompanySearch } from '../company-search'
import { WHICH_COMPANY } from './words'

export interface LogTarget {
  companyKey: string
  companyName: string
}

export interface LogCallPickerProps {
  /** The picker is open. The page holds it, so Ctrl+K's "Log a call" (`?log=1`) can open it. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (target: LogTarget) => void
}

/** The button, and the company picker it opens. */
export function LogCallPicker({ open, onOpenChange: setOpen, onPick }: LogCallPickerProps) {
  // A company was picked: the note view takes the focus, so it doesn't go back to the button.
  const picked = useRef(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" data-slot="log-call">
          <NotebookPen aria-hidden="true" />
          {LOG_CALL}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 p-0"
        onCloseAutoFocus={(event) => {
          if (picked.current) {
            picked.current = false
            event.preventDefault()
          }
        }}
      >
        <CompanySearch
          label={WHICH_COMPANY}
          onPick={(company) => {
            picked.current = true
            setOpen(false)
            onPick({ companyKey: company.key, companyName: company.name })
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The note view in a panel from the right, 576px wide, or the whole screen on a phone. */
export function LogCallSheet({
  target,
  options,
  onPhone,
  onClose,
}: {
  target: LogTarget | null
  options: CallNoteOptions | undefined
  onPhone: boolean
  onClose: () => void
}) {
  // While the panel slides shut, it keeps showing what it had.
  const [shown, setShown] = useState(target)
  if (target !== null && target !== shown) {
    setShown(target)
  }
  const company = useCompany(shown?.companyKey)
  const panel = useRef<HTMLDivElement>(null)
  return (
    <Sheet
      open={target !== null}
      // On a laptop the list stays usable beside the panel; on a phone the panel is the screen.
      modal={onPhone}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        ref={panel}
        side="right"
        className="w-full gap-0 p-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onInteractOutside={(event) => {
          event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          // The note's text box takes the focus as it mounts.
          event.preventDefault()
          panel.current?.querySelector('textarea')?.focus()
        }}
        onCloseAutoFocus={(event) => {
          // Back to Log call, so the next call is one more press away.
          const button = document.querySelector<HTMLElement>('[data-slot="log-call"]')
          if (button) {
            event.preventDefault()
            button.focus()
          }
        }}
      >
        {shown && options ? (
          <NoteView
            key={shown.companyKey}
            companyKey={shown.companyKey}
            companyName={shown.companyName}
            person={null}
            company={company.data}
            companyFailed={Boolean(company.error)}
            prepId={null}
            options={options}
            onPhone={onPhone}
            onSaved={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
