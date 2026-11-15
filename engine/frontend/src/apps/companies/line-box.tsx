/**
 * The line editor's two parts (PLAN-V14 T3-6), on their own so any page edits a line the same way:
 * the pencil beside a line (`EditPencil`), and the text box the line turns into (`LineTextBox`),
 * with its hint, what went wrong, Save and Cancel, and Esc for Cancel. The script's lines use them
 * (`line-editor.tsx`), and so do the pre-read's summaries (PLAN-V17 T3-10). What a save does is
 * the caller's: this file only draws the parts, so it brings no route with it.
 */
import { Pencil } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState, type Ref, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Esc closes the text box, not the call card around it. The card's dialog listens for Esc on the
 * document, before the box does, so the box listens on the window, which comes first, and stops
 * the key there while it is inside the box.
 */
function useEscapeInside(
  box: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const escape = useEffectEvent(onEscape)
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!(event.target instanceof Node) || !box.current?.contains(event.target)) return
      event.stopPropagation()
      event.preventDefault()
      escape()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [active, box])
}

export interface LineTextBoxProps {
  /** The text the box opens with. */
  initial: string
  /** What the line is, for the box's name: "Opener line 1" gives "Opener line 1, your wording". */
  label: string
  /** The most the box may hold. */
  maxChars: number
  /** The line under the box while the text fits. */
  hint: string
  /** A save is on its way: Save and Cancel wait. */
  busy?: boolean
  /** Why the last save didn't go, in plain words, or none. */
  problem?: string | null
  /** How tall the box opens, in lines. */
  rows?: number
  /**
   * Save as a quiet outline button, for a page whose one Navy button is elsewhere (the pre-read's
   * "Check and send"). Call prep's script keeps the Navy Save.
   */
  quietSave?: boolean
  /** Save, with the text trimmed. Only called when it fits. */
  onSubmit: (text: string) => void
  /** Cancel or Esc. */
  onCancel: () => void
  /** The text changed, so a failed save's words can go. */
  onType?: () => void
}

/**
 * The text box a line turns into: the box (it takes the focus at once, with the caret at the
 * end), its hint or how much is too long, why the last save didn't go, then Save and Cancel. Esc
 * is Cancel.
 */
export function LineTextBox({
  initial,
  label,
  maxChars,
  hint,
  busy = false,
  problem = null,
  rows = 2,
  quietSave = false,
  onSubmit,
  onCancel,
  onType,
}: LineTextBoxProps) {
  const [text, setText] = useState(initial)
  const box = useRef<HTMLFormElement>(null)
  const id = useId()
  useEscapeInside(box, true, onCancel)
  const trimmed = text.trim()
  const tooLong = trimmed.length > maxChars
  return (
    <form
      ref={box}
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (tooLong) return
        onSubmit(trimmed)
      }}
    >
      <Textarea
        // The box opens on a click of the pencil, so it takes the focus at once.
        autoFocus
        value={text}
        rows={rows}
        aria-label={`${label}, your wording`}
        aria-describedby={`${id}-hint`}
        aria-invalid={problem !== null || tooLong || undefined}
        className="text-body"
        onFocus={(event) => {
          const end = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(end, end)
        }}
        onChange={(event) => {
          setText(event.target.value)
          onType?.()
        }}
      />
      <p
        id={`${id}-hint`}
        className={cn(
          'text-caption tabular-nums',
          tooLong ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {tooLong
          ? `Too long: ${formatNumber(trimmed.length)} of ${formatNumber(maxChars)} characters.`
          : hint}
      </p>
      {problem ? (
        <p role="alert" className="text-ui text-destructive">
          {problem}
        </p>
      ) : null}
      {/* 44px tall on a touch screen, as every button there is. */}
      <div className="flex flex-wrap gap-2 max-sm:*:flex-1">
        <Button
          type="submit"
          variant={quietSave ? 'outline' : 'default'}
          size="sm"
          className="touch:h-11"
          disabled={busy || tooLong}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

export interface EditPencilProps {
  /** What the line is: "Goal of the call" gives the button's name "Edit goal of the call". */
  label: string
  onClick: () => void
  ref?: Ref<HTMLButtonElement>
  className?: string
}

/** The pencil beside a line: it opens the box. */
export function EditPencil({ label, onClick, ref, className }: EditPencilProps) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('-my-0.5 shrink-0 text-muted-foreground', className)}
      aria-label={`Edit ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      onClick={onClick}
    >
      <Pencil aria-hidden="true" />
    </Button>
  )
}
