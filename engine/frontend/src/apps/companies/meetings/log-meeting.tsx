/**
 * "Log meeting" on a past meeting (PLAN-V17 T3-11, "The screens" part 5): a panel from the right,
 * or the whole screen on a phone, with a box for the meeting's transcript. The rep pastes it, or
 * reads a .txt or .vtt file into it. The file is read in the browser, as text, and never uploaded:
 * its words and its name go when the rep saves (`transcript.ts`). Saving makes a call note linked
 * to the meeting, in the same batch on Activity as the calls (`log-meeting-save.ts`), with the same
 * toast and Undo as Log call.
 *
 * - **The limit:** 60,000 characters (the plan's, TBC: the contract doesn't say it). The count shows
 *   in the last tenth, and over it the box says so. A .vtt's times come out on the server, so for
 *   one the box says that, and the server says if its words are still too long.
 * - **Nothing is lost:** the panel stays open while it saves, with the words in the box. A save
 *   that fails says why, in the server's words, and the words stay. Closed before it is saved, the
 *   transcript is kept for this meeting while the page is open.
 * - **The transcript holds the client's words:** it is only ever shown as text.
 * - **Keys:** Ctrl+Enter (Cmd+Enter on a Mac) saves. Esc closes.
 *
 * Only a meeting from HubSpot that wasn't cancelled has "Log meeting" (`row-parts.tsx`), while call
 * notes are on.
 */
import { useQueryClient } from '@tanstack/react-query'
import { FileText, FileUp, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { useMe } from '@/api/hooks'
import { useCallNoteSummary } from '@/api/hooks/call-notes'
import type { MeetingItem } from '@/api/v17'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { melbourneDate } from '@/lib/format'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { draftOwner } from '../call-notes/draft'
import {
  keepTranscriptDraft,
  logMeeting,
  readTranscriptDraft,
  type TranscriptDraft,
} from './log-meeting-save'
import {
  checkTranscript,
  FILE_ACCEPT,
  isVtt,
  nearCount,
  readTranscriptFile,
  type FileRead,
} from './transcript'
import {
  charactersWords,
  FILE_TOO_BIG,
  FILE_TYPE,
  FILE_UNREADABLE,
  fromFileWords,
  LOG_MEETING,
  LOG_MEETING_NOTE,
  logMeetingLine,
  NOTHING_PASTED,
  READ_A_FILE,
  removeFileWords,
  SAVE_NOTES,
  SAVING_NOTES,
  TRANSCRIPT,
  TRANSCRIPT_KEPT,
  TRANSCRIPT_PLACEHOLDER,
  transcriptNotSavedWords,
  transcriptTooLongWords,
  VTT_HINT,
} from './words'

/** Why a file wasn't read, in plain words. */
const FILE_WORDS: Readonly<Record<Exclude<FileRead['kind'], 'ok'>, string>> = {
  type: FILE_TYPE,
  too_big: FILE_TOO_BIG,
  unreadable: FILE_UNREADABLE,
}

interface TranscriptViewProps {
  item: MeetingItem
  onPhone: boolean
  /** Saved: the panel closes. */
  onSaved: () => void
}

function TranscriptView({ item, onPhone, onSaved }: TranscriptViewProps) {
  const client = useQueryClient()
  // The signed-in rep's own transcripts only (the app always knows who that is by now).
  const owner = draftOwner(useMe().data)
  // Asked for now, so the toast can say the count the moment the notes are saved.
  useCallNoteSummary()
  const today = melbourneDate()
  const [mac] = useState(isMac)
  const [draft, setDraft] = useState<TranscriptDraft>(() =>
    readTranscriptDraft(owner, item.meeting.id),
  )
  // The newest transcript, for a change that comes after a wait (a file being read).
  const latest = useRef(draft)
  // Still on screen: a save that fails after the panel has closed says so in a toast instead.
  const shownNow = useRef(true)
  useEffect(() => {
    shownNow.current = true
    return () => {
      shownNow.current = false
    }
  }, [])
  const [problem, setProblem] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxId = useId()
  const noteId = useId()
  const countId = useId()
  const problemId = useId()

  const check = checkTranscript(draft.text, draft.fileName)
  const near = nearCount(draft.text, draft.fileName)
  const vtt = draft.text.trim() !== '' && isVtt(draft.text, draft.fileName)
  const empty = tried && check.kind === 'empty'
  const tooLong = check.kind === 'too_long' ? check : null

  const update = (change: Partial<Pick<TranscriptDraft, 'text' | 'fileName'>>): void => {
    const next = { ...latest.current, ...change }
    keepTranscriptDraft(next)
    latest.current = next
    setDraft(next)
    setProblem(null)
  }

  const save = (): void => {
    if (saving) return
    setTried(true)
    if (check.kind !== 'ok') {
      boxRef.current?.focus()
      return
    }
    setSaving(true)
    setProblem(null)
    logMeeting(client, latest.current).then(onSaved, (error: unknown) => {
      const words = transcriptNotSavedWords(error)
      if (!shownNow.current) {
        toast.error(words, { description: TRANSCRIPT_KEPT })
        return
      }
      setSaving(false)
      setProblem(words)
    })
  }

  const readFile = async (file: File): Promise<void> => {
    const read = await readTranscriptFile(file)
    if (read.kind !== 'ok') {
      setProblem(FILE_WORDS[read.kind])
      return
    }
    update({ text: read.text, fileName: read.name })
    boxRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      save()
    }
  }

  const alertWords = problem ?? (empty ? NOTHING_PASTED : null)
  const described = [
    noteId,
    tooLong || near ? countId : null,
    alertWords ? problemId : null,
  ].filter(Boolean)

  return (
    <div data-slot="log-meeting" className="flex h-full flex-col" onKeyDown={onKeyDown}>
      {/* A plain block, not a header element: inside the panel that would read as a banner. */}
      <div className="flex flex-col gap-0.5 border-b p-5 pr-14 max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pr-14">
        <SheetTitle className="text-section">{LOG_MEETING}</SheetTitle>
        <SheetDescription className="text-ui text-foreground">
          {logMeetingLine(item.company_name, item.meeting.title, item.meeting.starts_at, today)}
        </SheetDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 max-sm:p-4">
        <div className="flex flex-col gap-3">
          <label htmlFor={boxId} className="text-ui font-semibold text-foreground">
            {TRANSCRIPT}
          </label>
          <p id={noteId} className="-mt-2 text-caption text-muted-foreground">
            {LOG_MEETING_NOTE}
          </p>
          <Textarea
            ref={boxRef}
            id={boxId}
            value={draft.text}
            placeholder={TRANSCRIPT_PLACEHOLDER}
            spellCheck={false}
            aria-invalid={tooLong !== null || empty || undefined}
            aria-describedby={described.join(' ')}
            // It grows with the words up to half the screen, then scrolls. 16px on a touch screen.
            className={cn(
              'max-h-[50dvh] min-h-48 overflow-y-auto touch:text-body',
              onPhone && 'min-h-56',
            )}
            onChange={(event) => {
              update({ text: event.target.value })
            }}
          />
          {tooLong ? (
            <p id={countId} className="text-caption text-destructive-ink tabular-nums">
              {transcriptTooLongWords(tooLong.length, tooLong.max)}
            </p>
          ) : near ? (
            <p id={countId} className="text-right text-caption text-muted-foreground tabular-nums">
              {charactersWords(near.length, near.max)}
            </p>
          ) : null}
          {vtt ? <p className="text-caption text-muted-foreground">{VTT_HINT}</p> : null}
          {alertWords ? (
            <p id={problemId} role="alert" className="text-caption text-destructive-ink">
              {alertWords}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Read in the browser, never uploaded. The button below is the control. */}
            <input
              ref={fileRef}
              type="file"
              accept={FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              data-slot="transcript-file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared, so the same file can be read again.
                event.target.value = ''
                if (file) void readFile(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-11"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp aria-hidden="true" />
              {READ_A_FILE}
            </Button>
            {draft.fileName ? (
              <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
                <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{fromFileWords(draft.fileName)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="touch:size-11"
                  aria-label={removeFileWords(draft.fileName)}
                  onClick={() => {
                    update({ text: '', fileName: null })
                    boxRef.current?.focus()
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {onPhone ? (
        <div className="border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" className="w-full" disabled={saving} onClick={save}>
            {saving ? SAVING_NOTES : SAVE_NOTES}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3 border-t bg-popover px-5 py-3">
          <KbdGroup aria-hidden="true" className="touch:hidden">
            <Kbd>{mac ? 'Cmd' : 'Ctrl'}</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <Button
            type="button"
            disabled={saving}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onClick={save}
          >
            {saving ? SAVING_NOTES : SAVE_NOTES}
          </Button>
        </div>
      )}
    </div>
  )
}

export interface LogMeetingSheetProps {
  /** The past meeting whose notes are being logged, or null while closed. */
  target: MeetingItem | null
  onPhone: boolean
  onClose: () => void
}

/** The transcript box in a panel from the right, 576px wide, or the whole screen on a phone. */
export function LogMeetingSheet({ target, onPhone, onClose }: LogMeetingSheetProps) {
  // While the panel slides shut, it keeps showing what it had.
  const [shown, setShown] = useState(target)
  if (target !== null && target !== shown) {
    setShown(target)
  }
  const panel = useRef<HTMLDivElement>(null)
  return (
    <Sheet
      open={target !== null}
      // On a laptop the list stays in view beside the panel; on a phone the panel is the screen.
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
          // The box takes the focus as it opens, so Ctrl+V pastes at once.
          event.preventDefault()
          panel.current?.querySelector('textarea')?.focus()
        }}
      >
        {shown ? (
          <TranscriptView key={shown.meeting.id} item={shown} onPhone={onPhone} onSaved={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
