/**
 * "Log call" on Activity, for a call that wasn't prepped (PLAN-V17 "The screens", part 1). It asks
 * for the company first, in a combobox (DESIGN.md "shadcn parts": Popover with Command, filtering
 * as you type; the server finds the matches, about 250ms after the last key). Then it opens Log
 * call's own note view (`call-notes/note-view.tsx`) in a panel from the right, which asks who the
 * call was with. The panel has no script, so the note view shows no back arrow: Esc or Close
 * shuts it. "Save and next" saves at once and closes it; the note joins "To confirm" while it
 * sorts.
 */
import { NotebookPen } from 'lucide-react'
import { useRef, useState } from 'react'
import { useCompany, useCompanySearch } from '@/api/hooks'
import type { CallNoteOptions } from '@/api/v17'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useDebounced } from '@/hooks/useDebounced'
import { NoteView } from '../call-notes/note-view'
import { LOG_CALL } from '../call-notes/words'
import { companyPlace } from '../words'
import { FIND_COMPANY, LOOKING, NO_MATCH, TYPE_TWO, WHICH_COMPANY } from './words'

/** Typed searches wait this long after the last key (DESIGN.md "Speed"). */
const SETTLE_MS = 250

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
  const [text, setText] = useState('')
  // A company was picked: the note view takes the focus, so it doesn't go back to the button.
  const picked = useRef(false)
  const settled = useDebounced(text, SETTLE_MS)
  const search = useCompanySearch(settled)
  const query = settled.trim()
  const companies = query.length >= 2 ? (search.data?.companies ?? []) : []
  const typed = text.trim().length >= 2
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setText('')
      }}
    >
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
        {/* Seen here; a screen reader hears it once, as the search box's name (`label`). */}
        <p aria-hidden="true" className="px-3 pt-3 pb-1 text-ui font-semibold text-foreground">
          {WHICH_COMPANY}
        </p>
        <Command shouldFilter={false} label={WHICH_COMPANY}>
          <CommandInput
            placeholder={FIND_COMPANY}
            value={text}
            className="touch:text-body"
            onValueChange={setText}
          />
          <CommandList aria-label={WHICH_COMPANY}>
            {!typed ? (
              <p className="px-3 py-4 text-ui text-muted-foreground">{TYPE_TWO}</p>
            ) : companies.length === 0 ? (
              <p role="status" className="px-3 py-4 text-ui text-muted-foreground">
                {search.isFetching || text.trim() !== query ? LOOKING : NO_MATCH}
              </p>
            ) : (
              <CommandGroup>
                {companies.map((company) => {
                  const place = companyPlace({ ...company, staff: null })
                  return (
                    <CommandItem
                      key={company.key}
                      value={company.key}
                      onSelect={() => {
                        picked.current = true
                        setOpen(false)
                        setText('')
                        onPick({ companyKey: company.key, companyName: company.name })
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{company.name}</span>
                        {place ? (
                          <span className="truncate text-caption text-muted-foreground">
                            {place}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
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
