/**
 * Why a lead is rejected (PLAN-V9 D1): one reason from a fixed list, and a note that "Other" needs.
 * The counts by reason, on Admin's Runs tab, show which rule to tune. The lead card and the review
 * page both use the dialog here, so the choice reads the same in both places.
 */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { REJECT_REASONS, type RejectReason } from './reject-reasons-data'

export function RejectDialog({
  open,
  onOpenChange,
  title,
  description = 'Pick why, so the rules can learn from it. You can undo this.',
  pending,
  onReject,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  pending: boolean
  onReject: (reason: RejectReason, note: string | null) => void
}) {
  const id = useId()
  const [reason, setReason] = useState<RejectReason | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean): void => {
    if (next) {
      setReason(null)
      setNote('')
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = (): void => {
    if (reason === null) {
      setError('Pick a reason.')
      return
    }
    const text = note.trim()
    if (reason === 'other' && text === '') {
      setError('Say what the other reason is.')
      return
    }
    onReject(reason, text === '' ? null : text)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Reason"
          value={reason ?? ''}
          onValueChange={(value) => {
            setReason(value === '' ? null : (value as RejectReason))
            setError(null)
          }}
          className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {REJECT_REASONS.map((item) => (
            <ToggleGroupItem
              key={item.id}
              value={item.id}
              className="justify-start rounded-md border px-3 data-[state=on]:border-primary data-[state=on]:font-semibold"
            >
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>
            {reason === 'other' ? 'What is the reason?' : 'A note (optional)'}
          </FieldLabel>
          <Textarea
            id={`${id}-note`}
            value={note}
            maxLength={1000}
            onChange={(event) => {
              setNote(event.target.value)
            }}
            aria-invalid={error !== null && reason === 'other' ? true : undefined}
            placeholder="Like: they signed with another fitout company last month"
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              change(false)
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={submit}>
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
