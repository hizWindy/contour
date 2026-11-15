/**
 * The line editor (PLAN-V14 T3-6): a pencil on each editable line of the script (an opener line, a
 * why-now line, a question, an "If they say" answer and the goal). The line turns into a text box;
 * Save keeps it for this call, only for you, and Cancel or Esc closes it. An edited line is marked
 * "Yours" (an icon and a word), with Reset beside it to bring back the draft.
 *
 * After the first save on a card, one small row offers "Make it my style", which opens the style
 * sheet with a note filled in from the line. Nothing is shared by it.
 *
 * The script gives the call and the callbacks through `LineEditContext`. Without a call (a test, or
 * a card still picking who to call) there is no pencil. The pencil and the box themselves are in
 * `line-box.tsx`, which the pre-read's summaries use too (PLAN-V17 T3-10).
 */
import { PenLine } from 'lucide-react'
import { useContext, useRef, useState, type ReactNode } from 'react'
import { toApiProblem } from '@/api/client'
import { useResetScriptEdit, useSaveScriptEdit } from '@/api/hooks/script'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { problemHint, toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { EditPencil, LineTextBox } from './line-box'
import { LineEditContext } from './line-edit-context'
import type { GuideLine, ScriptCall } from './playbook'

/** The most a line edit may hold (the API's limit). */
export const LINE_MAX_CHARS = 400

function problemWords(error: unknown): string {
  const problem = toApiProblem(error)
  return [problem.title, problem.detail, problemHint(problem)]
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part ?? '') ? part : `${part ?? ''}.`))
    .join(' ')
}

/** The text box a script line turns into: it saves the call's own wording, or resets it. */
function LineBox({
  line,
  slot,
  call,
  label,
  onDone,
}: {
  line: GuideLine
  slot: string
  call: ScriptCall
  label: string
  onDone: () => void
}) {
  const { onSaved } = useContext(LineEditContext)
  const save = useSaveScriptEdit()
  const reset = useResetScriptEdit()
  const busy = save.isPending || reset.isPending
  const failed = save.isError ? save.error : reset.isError ? reset.error : null
  return (
    <LineTextBox
      initial={line.text}
      label={label}
      maxChars={LINE_MAX_CHARS}
      hint="Only for this call, and only you see it."
      busy={busy}
      problem={failed ? problemWords(failed) : null}
      onCancel={onDone}
      onType={() => {
        if (save.isError) save.reset()
      }}
      onSubmit={(trimmed) => {
        if (trimmed === line.text.trim()) {
          onDone()
          return
        }
        // An emptied box brings back the draft, like Reset.
        if (!trimmed) {
          if (!line.edited) {
            onDone()
            return
          }
          reset.mutate({ ...call, slot }, { onSuccess: onDone })
          return
        }
        save.mutate(
          {
            company_key: call.companyKey,
            contact_id: call.contactId,
            slot,
            text: trimmed,
          },
          {
            onSuccess: () => {
              onSaved(slot, trimmed)
              onDone()
            },
          },
        )
      }}
    />
  )
}

/** "Yours", and Reset to bring back the draft. */
function YoursRow({ line, slot, call }: { line: GuideLine; slot: string; call: ScriptCall }) {
  const reset = useResetScriptEdit()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">
        <PenLine aria-hidden="true" />
        Yours
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-caption text-muted-foreground"
        disabled={reset.isPending}
        title={line.edited?.draft ? `The draft: ${line.edited.draft}` : undefined}
        aria-label={
          line.edited?.draft
            ? `Reset to the draft: ${line.edited.draft}`
            : 'Reset: remove your line'
        }
        onClick={() => {
          reset.mutate({ ...call, slot }, { onError: toastProblem })
        }}
      >
        Reset
      </Button>
    </div>
  )
}

/** "Use this wording for all your scripts? Make it my style", once, after the first save. */
function StyleOffer() {
  const { onMakeStyle, onDismissOffer } = useContext(LineEditContext)
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-background px-3 py-2 text-ui"
    >
      <span className="text-muted-foreground">Use this wording for all your scripts?</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 font-semibold"
        onClick={onMakeStyle}
      >
        Make it my style
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-1.5 text-caption text-muted-foreground"
        onClick={onDismissOffer}
      >
        Not now
      </Button>
    </div>
  )
}

export interface EditableLineProps {
  line: GuideLine
  slot: string
  /** What the line is, for the pencil's label: "Opener line 1", "Goal of the call". */
  label: string
  /** The line as it shows when it is not being edited. */
  children: ReactNode
  className?: string
}

/** A line of the script with its pencil, its "Yours" mark and Reset. */
export function EditableLine({ line, slot, label, children, className }: EditableLineProps) {
  const { call, offerSlot } = useContext(LineEditContext)
  const [editing, setEditing] = useState(false)
  const pencil = useRef<HTMLButtonElement>(null)
  if (!call) return <div className={className}>{children}</div>
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {editing ? (
        <LineBox
          line={line}
          slot={slot}
          call={call}
          label={label}
          onDone={() => {
            setEditing(false)
            // Back to the pencil, so the keyboard carries on from the line.
            requestAnimationFrame(() => pencil.current?.focus())
          }}
        />
      ) : (
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1">{children}</div>
          <EditPencil
            ref={pencil}
            label={label}
            onClick={() => {
              setEditing(true)
            }}
          />
        </div>
      )}
      {line.edited && !editing ? <YoursRow line={line} slot={slot} call={call} /> : null}
      {offerSlot === slot && !editing ? <StyleOffer /> : null}
    </div>
  )
}
