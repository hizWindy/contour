/**
 * The Data tab's edit screens (PLAN-V26 T4-3, choices 18 and 20): a side panel for one row, and
 * the table's edits with Undo. The backend says which fields can change and keeps the rules.
 *
 * Only the fields that changed are sent. A hidden email or phone number stays hidden, and the
 * backend refuses a value that still has its dots.
 */
import { ChevronsUpDown, Trash2, Undo2 } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import {
  useDeleteRow,
  useEditForm,
  useEditRow,
  useTableEdits,
  useUndoEdit,
  type DataEdit,
  type EditField,
} from '@/api/hooks/data-edits'
import { CompanySearch, type CompanyMatch } from '@/apps/companies/company-search'
import { ErrorState } from '@/components/error-state'
import { Pager } from '@/components/pager'
import { PendingForm } from '@/components/skeletons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

const EDITS_PAGE = 20
const NONE = '__none__' // a Select can't hold an empty value
const HIDDEN_HINT = 'Part of it is hidden. To change it, type the whole value.'

function CompanyField({
  id,
  shown,
  onPick,
}: {
  id: string
  shown: string
  onPick: (company: CompanyMatch) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="w-full justify-between">
          <span className="truncate">{shown || 'Pick a company'}</span>
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <CompanySearch
          label="Which company was the call with?"
          onPick={(company) => {
            onPick(company)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function FieldRow({
  field,
  draft,
  picked,
  error,
  waits,
  onChange,
  onPick,
}: {
  field: EditField
  draft: string
  picked: CompanyMatch | null
  error: string | undefined
  /** Why this field can't be changed yet, like the person once the company changed. */
  waits: string | null
  onChange: (value: string) => void
  onPick: (company: CompanyMatch) => void
}) {
  const id = useId()
  const hint = waits ?? (field.hidden ? HIDDEN_HINT : null)
  const described = hint ? `${id}-hint` : undefined
  const invalid = error ? true : undefined
  return (
    <Field>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.kind === 'company' ? (
        <CompanyField id={id} shown={picked?.name ?? field.value ?? ''} onPick={onPick} />
      ) : field.kind === 'choice' ? (
        <Select
          value={draft === '' ? NONE : draft}
          disabled={waits !== null || field.choices.length === 0}
          onValueChange={(value) => {
            onChange(value === NONE ? '' : value)
          }}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-describedby={described}
            aria-invalid={invalid}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.required ? null : <SelectItem value={NONE}>None</SelectItem>}
            {draft !== '' && !field.choices.some((choice) => choice.value === draft) ? (
              <SelectItem value={draft}>As it is now</SelectItem>
            ) : null}
            {field.choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === 'long' ? (
        <Textarea
          id={id}
          rows={5}
          value={draft}
          maxLength={field.max_chars}
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      ) : (
        <Input
          id={id}
          value={draft}
          maxLength={field.max_chars}
          autoComplete="off"
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      )}
      {hint ? <FieldDescription id={described}>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

function EditBody({ table, rowId, onDone }: { table: string; rowId: string; onDone: () => void }) {
  const form = useEditForm(table, rowId)
  const save = useEditRow(table)
  const remove = useDeleteRow(table)
  const undo = useUndoEdit()
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [company, setCompany] = useState<CompanyMatch | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (form.error) {
    return (
      <ErrorState
        error={form.error}
        context="This row couldn't be loaded."
        onRetry={() => void form.refetch()}
      />
    )
  }
  if (!form.data) return <PendingForm label="Loading the row." fields={3} />
  const { fields, blocked, deletable } = form.data

  const values: Record<string, string | null> = {}
  for (const field of fields) {
    if (field.kind === 'company') {
      if (company) values[field.key] = company.key
      continue
    }
    if (field.key === 'person' && company) continue // the new company clears the person
    const value = typed[field.key]
    if (value !== undefined && value.trim() !== (field.value ?? '').trim()) {
      values[field.key] = value.trim() === '' ? null : value.trim()
    }
  }
  const changed = Object.keys(values).length > 0

  const done = (words: string, editId: string | null): void => {
    if (editId) {
      toast(words, {
        action: {
          label: 'Undo',
          onClick: () => {
            undo.mutate(editId, {
              onSuccess: () => toast('Undone.'),
              onError: toastProblem,
            })
          },
        },
      })
    } else {
      toast('Nothing was different.')
    }
    onDone()
  }

  return (
    <div className="flex flex-col gap-5 px-4">
      {blocked ? <p className="text-ui text-foreground">{blocked}</p> : null}
      {!blocked && fields.length > 0 ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!changed || save.isPending) return
            setErrors({})
            save.mutate(
              { rowId, values },
              {
                onSuccess: (answer) => {
                  done('Saved.', answer.edit_id)
                },
                onError: (problem) => {
                  const found: Record<string, string> = {}
                  if (isApiProblem(problem)) {
                    for (const item of problem.errors) {
                      found[item.field.replace(/^body\.values\./, '')] = item.message
                    }
                  }
                  if (Object.keys(found).length > 0) setErrors(found)
                  else toastProblem(problem)
                },
              },
            )
          }}
        >
          {fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              draft={typed[field.key] ?? field.value ?? ''}
              picked={company}
              error={errors[field.key]}
              waits={
                field.key === 'person' && company
                  ? 'Save the company first, then pick one of its people.'
                  : null
              }
              onChange={(value) => {
                setTyped((now) => ({ ...now, [field.key]: value }))
              }}
              onPick={setCompany}
            />
          ))}
          <div>
            <Button type="submit" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving.' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
      {!blocked && deletable ? (
        <div className="border-t pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={remove.isPending}>
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this row?</AlertDialogTitle>
                <AlertDialogDescription>
                  It goes from Contour at once. Undo under Edits can put it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    remove.mutate(rowId, {
                      onSuccess: (answer) => {
                        done('Deleted.', answer.edit_id)
                      },
                      onError: toastProblem,
                    })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  )
}

export function EditRowSheet({
  table,
  label,
  rowId,
  onClose,
}: {
  table: string
  label: string
  rowId: string | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={rowId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="flex flex-col gap-6 overflow-y-auto pb-6">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>Every change is recorded, and has an Undo.</SheetDescription>
        </SheetHeader>
        {rowId ? <EditBody key={rowId} table={table} rowId={rowId} onDone={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function editTitle(edit: DataEdit): string {
  if (edit.action === 'delete') return 'Deleted'
  if (edit.action === 'undo') return 'Undone'
  const labels = edit.changes.map((item) => item.label.toLowerCase())
  return labels.length > 0 ? `Changed: ${labels.join(', ')}` : 'Changed'
}

export function TableEdits({ table }: { table: string }) {
  const [page, setPage] = useState(0)
  const list = useTableEdits(table, page * EDITS_PAGE)
  const undo = useUndoEdit()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t pt-4">
      <h2 id={titleId} className="text-section font-semibold text-foreground">
        Edits
      </h2>
      {list.error ? (
        <ErrorState error={list.error} context="The edits couldn't be loaded." />
      ) : !list.data || list.data.total === 0 ? (
        <p className="text-ui text-muted-foreground">
          {list.data ? 'No edits yet.' : 'Loading the edits.'}
        </p>
      ) : (
        <>
          <ul aria-labelledby={titleId} className="divide-y">
            {list.data.items.map((edit) => (
              <li
                key={edit.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-ui font-semibold text-foreground">{editTitle(edit)}</span>
                  {edit.changes.map((item) => (
                    <span key={item.label} className="text-caption break-words text-foreground">
                      {`${item.label}: ${item.before ?? 'empty'} to ${item.after ?? 'empty'}`}
                    </span>
                  ))}
                  <span className="text-caption text-muted-foreground">
                    {`${formatDateTime(edit.at)}${edit.admin_name ? `, by ${edit.admin_name}` : ''}`}
                  </span>
                </span>
                {edit.can_undo ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={undo.isPending}
                    onClick={() => {
                      undo.mutate(edit.id, {
                        onSuccess: () => toast('Undone.'),
                        onError: toastProblem,
                      })
                    }}
                  >
                    <Undo2 aria-hidden="true" />
                    Undo
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {list.data.total > EDITS_PAGE ? (
            <Pager
              page={{ pageIndex: page, pageSize: EDITS_PAGE, total: list.data.total }}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
