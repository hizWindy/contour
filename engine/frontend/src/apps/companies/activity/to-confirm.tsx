/**
 * "To confirm" (PLAN-V17 T3-6, "The screens" part 3): one card for each call the rep logged and
 * hasn't sent, and one Navy button, "Send 7 to HubSpot".
 *
 * - **The order:** a note the sorter was unsure of first, then the calls in the order they were
 *   made. Cards keep their place while the rep works: a new note joins at the end, and a card
 *   that leaves lets the ones under it glide up (`ListExit`).
 * - **HubSpot's values now:** opening the tab asks for the preview of the notes with changes, so
 *   each change shows what HubSpot has. Pressing Send asks again, for the totals in the dialog.
 * - **Keys:** J and K move between cards, E edits the active one (its first field takes the
 *   focus), X leaves it out or puts it back, and Ctrl+Enter (Cmd+Enter on a Mac) opens the send
 *   dialog. J, K, E and X never fire inside a text field; Ctrl+Enter does.
 * - **Sending:** the dialog's Send, then POST /call-notes/confirm, which answers at once. The bar
 *   fills as each note lands (`use-batch.ts`). A second press meanwhile does nothing.
 * - **A call the server won't send** (`skipped`, T3-11): the dialog names it with why before it
 *   goes. After the send it stays here, out of the batch, and its card says why at the top, until
 *   it is changed or sent again, so it never looks forgotten.
 * - **The line beside the button** says only what the button doesn't: the count is on the button,
 *   so the line is "1 left out." or "2 still sorting.", or nothing (DESIGN.md "Say it once").
 * - **Waiting for write access:** the button is greyed, with the reason beside it. Everything up
 *   to the click still works: edit, leave out, remove.
 * - **On a phone** the button sits at the bottom of the screen, above the safe area.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { memo, useEffect, useEffectEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  confirmCallNotesOptions,
  previewCallNotesOptions,
  refreshCallNoteLists,
  updateNoteInLists,
  useCallNotePreview,
  useCallNotes,
} from '@/api/hooks/call-notes'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions, CallNoteOut } from '@/api/v17'
import { ErrorState } from '@/components/error-state'
import { ListExit, ListExitItem, RollingNumber } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Progress } from '@/components/ui/progress'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { isMac } from '@/lib/platform'
import { changeDetail } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { NoteCard, type EditNote } from './note-card'
import { applyPreview, isCallNotesOff, sortForConfirm } from './notes'
import { activityQuery } from './params'
import { removeCallNote, useRemoving } from './remove'
import { SendDialog, type SkippedCall } from './send-dialog'
import { CallNotesOff, CardsPending, TabEmpty } from './states'
import type { Batch, Landing } from './use-batch'
import { useEditCallNote } from './use-edit'
import {
  ALL_LEFT_OUT,
  ALREADY_SENDING,
  batchSentence,
  firstOfWords,
  LOAD_FAILED,
  NONE_READY,
  NOT_SENT,
  NOTHING_SENT,
  REST_NEXT,
  SEND_OFF,
  sendingWords,
} from './words'

/** No call left out by the last send: the same empty map on every draw. */
const NONE_LEFT: ReadonlyMap<string, string> = new Map()

/** The words of the list, for a screen reader. */
const LIST_LABEL = 'Calls to confirm'

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/**
 * The ids in the order they first showed. One that is still there keeps its place; a new one
 * joins at the end. So a card never jumps while the rep reads it.
 */
function useStableOrder(
  sortedIds: readonly string[],
  stillThere: (id: string) => boolean,
): readonly string[] {
  const [order, setOrder] = useState<readonly string[]>([])
  const kept = order.filter(stillThere)
  const known = new Set(kept)
  const next = [...kept, ...sortedIds.filter((id) => !known.has(id))]
  if (next.length !== order.length || next.some((id, index) => id !== order[index])) {
    setOrder(next)
  }
  return next
}

function focusCard(id: string): void {
  const card = document.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"]`)
  card?.focus({ preventScroll: true })
  card?.scrollIntoView({ block: 'nearest' })
}

function focusFirstField(id: string): void {
  document.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"] [data-first-field]`)?.focus()
}

export interface ToConfirmProps {
  options: CallNoteOptions
  today: string
  onPhone: boolean
  /** The batch being sent. The page holds it, so it carries on while another tab is open. */
  batch: Batch
}

/**
 * A memo: the page draws again when its counts move (each landed card moves them), and the list
 * needn't. It draws for its own reads, its own state, and a change in the batch (`useBatch` keeps
 * one object until something in it changes). Found in T3-8.
 */
export const ToConfirm = memo(function ToConfirm({
  options,
  today,
  onPhone,
  batch,
}: ToConfirmProps) {
  const client = useQueryClient()
  const removing = useRemoving()
  const list = useCallNotes(activityQuery('to_confirm'), { pollSending: !batch.running })
  const editMutation = useEditCallNote()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sendIds, setSendIds] = useState<readonly string[]>([])
  // The calls the last send left out, with the server's why, until each is changed or sent again.
  const [leftBehind, setLeftBehind] = useState<ReadonlyMap<string, string>>(NONE_LEFT)
  const [mac] = useState(isMac)
  const reasonId = useId()

  // Opening the tab asks for HubSpot's values now, once, for the notes with changes.
  const [previewFor, setPreviewFor] = useState<readonly string[] | null>(null)
  if (previewFor === null && list.data) {
    setPreviewFor(
      list.data.items
        .filter((note) => note.status === 'to_confirm' && note.changes.length > 0)
        .map((note) => note.id)
        .sort(),
    )
  }
  const opening = useCallNotePreview(previewFor ?? [])
  useEffect(() => {
    if (opening.data) applyPreview(client, opening.data)
  }, [client, opening.data])

  const sendPreview = useMutation({
    ...previewCallNotesOptions(),
    onSuccess: (preview) => {
      applyPreview(client, preview)
    },
  })

  const confirm = useMutation({
    ...confirmCallNotesOptions(),
    // It answers at once: the cards say "Sending" before the server does.
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: queryKeys.companies.callNoteLists() })
      for (const id of ids) {
        updateNoteInLists(client, id, (note) => ({ ...note, status: 'sending' }))
      }
    },
    onSuccess: (answer, ids) => {
      if (answer.already_sending) {
        toast(ALREADY_SENDING)
        void refreshCallNoteLists(client)
        return
      }
      // A call the server left out wasn't sent: it is back to confirm, and its card says why.
      const skipped = answer.skipped ?? []
      const left = new Map(skipped.map((call) => [call.id, call.why]))
      for (const id of left.keys()) {
        updateNoteInLists(client, id, (note) => ({ ...note, status: 'to_confirm' }))
      }
      setLeftBehind(left.size > 0 ? left : NONE_LEFT)
      const started = ids.filter((id) => !left.has(id))
      if (started.length === 0) {
        toast(NOTHING_SENT)
        void refreshCallNoteLists(client)
        return
      }
      batch.start(started)
    },
    onError: (error) => {
      void refreshCallNoteLists(client)
      const detail = changeDetail(error)
      toast.error(NOT_SENT, detail ? { description: detail } : undefined)
    },
  })

  // The cards: the page's notes, with the newest copy of each note being sent.
  const items = list.data?.items ?? []
  const byId = new Map(items.map((note) => [note.id, note]))
  for (const [id, note] of batch.latest) byId.set(id, note)
  const order = useStableOrder(
    sortForConfirm(items).map((note) => note.id),
    (id) => byId.has(id),
  )
  const notes = order
    .filter((id) => !batch.gone.has(id) && !removing.has(id))
    .map((id) => byId.get(id))
    .filter((note): note is CallNoteOut => note !== undefined)
  const ids = notes.map((note) => note.id)

  const landingOf = (id: string): Landing | null => {
    if (!batch.ids.includes(id)) return null
    const landing = batch.landing(id)
    return landing === 'back' ? null : landing
  }
  const locked = (note: CallNoteOut): boolean =>
    note.status === 'sending' || landingOf(note.id) !== null

  const included = notes.filter((note) => note.status === 'to_confirm' && !note.left_out)
  const leftOut = notes.filter((note) => note.left_out && !locked(note)).length
  const sorting = notes.filter((note) => note.status === 'sorting').length
  const ready = options.sending_ready
  const canSend = ready && included.length > 0 && !batch.running && !confirm.isPending

  const edit =
    (id: string): EditNote =>
    (patch, apply) => {
      editMutation.mutate({ id, patch, apply })
      // Changed since the send left it out: the why may no longer hold.
      setLeftBehind((now) => {
        if (!now.has(id)) return now
        const next = new Map(now)
        next.delete(id)
        return next.size > 0 ? next : NONE_LEFT
      })
    }
  const toggleLeftOut = (note: CallNoteOut): void => {
    const leave = !note.left_out
    edit(note.id)({ left_out: leave }, (now) => ({ ...now, left_out: leave }))
  }
  const startEditing = (id: string): void => {
    setActiveId(id)
    if (editingId === id) {
      focusFirstField(id)
    } else {
      setEditingId(id)
    }
  }
  const stopEditing = (): void => {
    const id = editingId
    // The card takes the focus first, so the field being left saves, and nothing is lost.
    if (id) focusCard(id)
    setEditingId(null)
  }
  const remove = (note: CallNoteOut): void => {
    // The browser drops the focus with the card, so it moves to the next one at once.
    const index = ids.indexOf(note.id)
    const next = ids[index + 1] ?? ids[index - 1] ?? null
    if (editingId === note.id) setEditingId(null)
    setActiveId(next)
    if (next) focusCard(next)
    removeCallNote(client, note)
  }

  const openSend = (): void => {
    if (!canSend) return
    const next = included.map((note) => note.id)
    setSendIds(next)
    sendPreview.reset()
    sendPreview.mutate(next)
    setDialogOpen(true)
  }
  // The calls the preview says won't be sent, by their company, for the dialog.
  const skippedNow: SkippedCall[] = (sendPreview.data?.skipped ?? []).map((call) => ({
    id: call.id,
    name: byId.get(call.id)?.company_name ?? null,
    why: call.why,
  }))
  const send = (): void => {
    setDialogOpen(false)
    confirm.mutate(sendIds)
  }

  useListKeyboard({
    enabled: ids.length > 0,
    ids,
    activeId,
    onActiveChange: (id) => {
      setActiveId(id)
      focusCard(id)
    },
    onEscape: () => {
      if (editingId) stopEditing()
    },
    letters: {
      e: (id) => {
        const note = byId.get(id)
        if (note && note.status !== 'sorting' && !note.left_out && !locked(note)) {
          startEditing(id)
        }
      },
      x: (id) => {
        const note = byId.get(id)
        if (note && !locked(note)) toggleLeftOut(note)
      },
    },
  })

  // Ctrl+Enter (Cmd+Enter) opens the send dialog from anywhere on the tab, even a text field.
  const onSendKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== 'Enter' ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.defaultPrevented
    ) {
      return
    }
    const target = event.target instanceof Element ? event.target : null
    // A dialog or panel open on top (Log call) keeps its own Ctrl+Enter.
    if (target?.closest('[role="dialog"], [role="alertdialog"]')) return
    event.preventDefault()
    // Leaving a field saves it before the dialog takes the focus.
    if (target?.closest(EDITABLE) && target instanceof HTMLElement) target.blur()
    openSend()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      onSendKey(event)
    }
    document.addEventListener('keydown', listener)
    return () => {
      document.removeEventListener('keydown', listener)
    }
  }, [])

  if (isCallNotesOff(list.error)) return <CallNotesOff />
  if (list.error && !list.data) {
    return (
      <ErrorState error={list.error} context={LOAD_FAILED} onRetry={() => void list.refetch()} />
    )
  }
  if (!list.data) return <CardsPending />
  if (notes.length === 0) return <TabEmpty tab="to_confirm" />

  // Only what the button doesn't say: the count is on the button. Often nothing.
  const reason = !ready
    ? SEND_OFF
    : included.length > 0 || sorting > 0
      ? batchSentence(included.length, leftOut, sorting)
      : leftOut > 0
        ? ALL_LEFT_OUT
        : NONE_READY
  const described = !batch.running && reason !== ''
  const total = batch.ids.length
  const more = list.data.total > list.data.items.length

  return (
    <div className={cn('flex flex-col gap-4', onPhone && 'pb-36')}>
      <div
        data-slot="send-bar"
        className={cn(
          'z-10 flex flex-wrap items-center gap-x-4 gap-y-2',
          onPhone
            ? 'fixed inset-x-0 bottom-0 z-20 flex-col items-stretch border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
            : 'sticky top-0 -mx-1 border-b bg-background px-1 py-3 max-md:top-14',
        )}
      >
        {/* On a laptop it holds the button at the right even when empty; a phone stacks it. */}
        {onPhone && !batch.running && !described ? null : (
          <div className="min-w-0 flex-1">
            {batch.running ? (
              <div className="flex flex-col gap-1.5">
                <p aria-live="polite" className="text-ui text-foreground">
                  {sendingWords(batch.done, total)}
                </p>
                <Progress
                  value={total > 0 ? (batch.done / total) * 100 : 0}
                  aria-label="Sending to HubSpot"
                />
              </div>
            ) : described ? (
              <p id={reasonId} className="text-ui text-muted-foreground text-pretty">
                {reason}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex items-center gap-2">
          <KbdGroup aria-hidden="true" className="touch:hidden max-sm:hidden">
            <Kbd>{mac ? 'Cmd' : 'Ctrl'}</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <Button
            type="button"
            size={onPhone ? 'lg' : 'default'}
            className={onPhone ? 'w-full' : undefined}
            disabled={!canSend}
            aria-describedby={described ? reasonId : undefined}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onClick={openSend}
          >
            <Send aria-hidden="true" />
            {included.length > 0 && !batch.running ? (
              <span className="inline-flex items-baseline gap-1">
                Send <RollingNumber value={included.length} /> to HubSpot
              </span>
            ) : (
              'Send to HubSpot'
            )}
          </Button>
        </div>
      </div>
      <ListExit aria-label={LIST_LABEL} className="flex flex-col gap-3">
        {notes.map((note) => (
          <ListExitItem key={note.id}>
            <NoteCard
              note={note}
              options={options}
              today={today}
              active={note.id === activeId}
              editing={note.id === editingId}
              landing={landingOf(note.id)}
              skippedWhy={leftBehind.get(note.id) ?? null}
              onActivate={() => {
                if (activeId !== note.id) setActiveId(note.id)
              }}
              onEditing={(on) => {
                if (on) {
                  startEditing(note.id)
                } else if (editingId === note.id) {
                  stopEditing()
                }
              }}
              onToggleLeftOut={() => {
                toggleLeftOut(note)
              }}
              onRemove={() => {
                remove(note)
              }}
              edit={edit(note.id)}
            />
          </ListExitItem>
        ))}
      </ListExit>
      {more ? (
        <p className="text-ui text-muted-foreground">
          {firstOfWords(list.data.items.length, list.data.total)} {REST_NEXT}
        </p>
      ) : null}
      <SendDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        count={sendIds.length}
        preview={sendPreview.data}
        skipped={skippedNow}
        loading={sendPreview.isPending}
        error={sendPreview.error}
        onRetry={() => {
          sendPreview.mutate(sendIds)
        }}
        onSend={send}
      />
    </div>
  )
})
