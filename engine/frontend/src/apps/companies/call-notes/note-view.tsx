/**
 * Log call's note view (PLAN-V17 T3-5, "The screens" part 1): what happened on one call, inside
 * the call prep panel. It comes in from the right like a phone app's next screen (`PushView`, in
 * `prep-sheet.tsx`), and Back (Esc, or the arrow) returns to the script.
 *
 * Top to bottom: who the call was with (from the panel, or "Who was the call with?"), the text
 * box with the mic in its corner (PLAN-V18 T3-4, laptops only), the outcome as chips (one or none),
 * the follow-up (only with the AI off), then "Save and next", the one Navy button. Ctrl+Enter
 * (Cmd+Enter on a Mac) saves. There is no timer: a stopwatch with no label told the rep nothing
 * they could act on (Al-khair, 17 Nov 2026).
 *
 * - **The draft is safe.** Every change is kept in the browser for this call (`draft.ts`),
 *   through a refresh and a closed panel, until the server has the note. It is the signed-in
 *   rep's own: another rep on the same browser never sees it.
 * - **Saving answers at once** (`save.ts`): the panel closes, focus goes back to the list's row,
 *   and the toast has Undo. Nothing waits for the sort, which runs on the server.
 * - **Focus** moves into the text box as the view opens, so the rep types straight after L.
 * - **On a phone** the view fills the screen, the text box comes first, and "Save and next" sits
 *   at the bottom, above the safe area. The keyboard's own mic does the talking.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useMe } from '@/api/hooks'
import { voiceToolOf } from '@/api/hooks/call-note-counts'
import { useCallNoteSummary } from '@/api/hooks/call-notes'
import type { CompanyDetail, CallNoteOptions } from '@/api/types'
import { ChipGroup } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { melbourneDate } from '@/lib/format'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { PanelDescription, PanelTitle } from '../panel-title'
import type { PrepPerson } from '../prep-box'
import {
  draftOwner,
  dropDraft,
  keepDraft,
  newestDraft,
  readDraft,
  startDraft,
  type DraftOwner,
  type NoteDraft,
} from './draft'
import { FollowUpFields } from './follow-up-fields'
import { checkFollowUp } from './follow-up'
import { fixedWords } from './mic/words'
import { NoteMic } from './note-mic'
import { logCallNote } from './save'
import { WhoWith } from './who-with'
import {
  BACK_TO_SCRIPT,
  countWords,
  LOG_CALL,
  nearTheEnd,
  NOTE_LABEL,
  NOTE_PLACEHOLDER,
  NOTHING_TO_SAVE,
  OUTCOME,
  SAVE_AND_NEXT,
  whoLine,
} from './words'

export interface NoteViewProps {
  companyKey: string
  companyName: string
  /** The person the panel is on. Null: a call that wasn't prepped, or a cold call. */
  person: PrepPerson | null
  /** The company's record, for "Who was the call with?". Undefined while it loads. */
  company: CompanyDetail | undefined
  companyFailed: boolean
  /** The call prep the panel has open, or null. */
  prepId: string | null
  options: CallNoteOptions
  onPhone: boolean
  /**
   * Back to the script. A host with no script (Call logs' Log call, T3-6) leaves it out: there is
   * no back arrow, and Esc or the panel's own Close shuts it.
   */
  onBack?: () => void
  /** Saved: the panel closes. */
  onSaved: () => void
}

/**
 * The call's draft, if the rep has one kept: for the person called, or the company's newest.
 * Else a new one.
 */
function firstDraft(owner: DraftOwner, companyKey: string, person: PrepPerson | null): NoteDraft {
  const kept = person ? readDraft(owner, companyKey, person.id) : newestDraft(owner, companyKey)
  return kept ?? startDraft(owner, companyKey, person)
}

export function NoteView({
  companyKey,
  companyName,
  person,
  company,
  companyFailed,
  prepId,
  options,
  onPhone,
  onBack,
  onSaved,
}: NoteViewProps) {
  const client = useQueryClient()
  // The signed-in rep's own drafts only (the app always knows who that is by now).
  const owner = draftOwner(useMe().data)
  // Asked for now, so the toast can say the count the moment the note is saved.
  useCallNoteSummary()
  const today = melbourneDate()
  const [mac] = useState(isMac)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const whatRef = useRef<HTMLInputElement>(null)
  const whenRef = useRef<HTMLInputElement>(null)
  const countId = useId()
  const nothingId = useId()
  const outcomeId = useId()

  const [draft, setDraft] = useState(() => firstDraft(owner, companyKey, person))
  // The newest draft, for changes that come between two draws (the mic's words, T3-4).
  const latest = useRef(draft)
  const [tried, setTried] = useState(false)
  // A name the mic heard nearly right and fixed, said once under the box until the next change.
  const [fixLine, setFixLine] = useState<string | null>(null)
  const tool = voiceToolOf(options)
  const mic = !onPhone && tool !== 'typing'

  const update = (change: Partial<NoteDraft>): void => {
    const now = latest.current
    const next: NoteDraft = { ...now, ...change, updatedAt: new Date().toISOString() }
    // Another person: the draft moves to that call.
    if (next.contactId !== now.contactId) {
      dropDraft(now.owner, now.companyKey, now.contactId, now.key)
    }
    keepDraft(next)
    latest.current = next
    setDraft(next)
  }

  // Focus at once, not when the view has slid in: the first keys after L must not be lost.
  useEffect(() => {
    const box = textRef.current
    if (!box) return
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
  }, [])

  const isEmpty = (note: NoteDraft): boolean => note.text.trim() === '' && note.outcome === null
  const empty = isEmpty(draft)
  const followUp = options.ai_enabled ? null : checkFollowUp(draft.followUp, today)
  const followUpProblem =
    tried && followUp && !followUp.ok ? { field: followUp.field, words: followUp.words } : null
  const showNothing = tried && empty
  const near = nearTheEnd(draft.text.length, options.max_chars)

  const save = (): void => {
    const note = latest.current
    setTried(true)
    if (isEmpty(note)) {
      textRef.current?.focus()
      return
    }
    const check = options.ai_enabled ? null : checkFollowUp(note.followUp, today)
    if (check && !check.ok) {
      ;(check.field === 'what' ? whatRef : whenRef).current?.focus()
      return
    }
    logCallNote({ client, draft: note, prepId, aiEnabled: options.ai_enabled })
    onSaved()
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

  const described = [near ? countId : null, showNothing ? nothingId : null].filter(Boolean)
  const noteBox = (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Textarea
          ref={textRef}
          aria-label={NOTE_LABEL}
          placeholder={NOTE_PLACEHOLDER}
          value={draft.text}
          maxLength={options.max_chars > 0 ? options.max_chars : undefined}
          aria-invalid={showNothing ? true : undefined}
          aria-describedby={described.length > 0 ? described.join(' ') : undefined}
          // Room at the foot for the mic in the corner, so the last line never hides under it.
          className={cn('min-h-40 touch:text-body', onPhone && 'min-h-48', mic && 'pb-14')}
          onChange={(event) => {
            setFixLine(null)
            update({ text: event.target.value })
          }}
        />
        {mic ? (
          <NoteMic
            className="absolute right-2 bottom-2"
            tool={tool}
            box={textRef}
            names={[companyName, ...(person ? [person.name] : [])]}
            onText={(text, fixes) => {
              const now = latest.current.text
              update({ text: now ? `${now.trimEnd()} ${text}` : text, source: 'mic' })
              setFixLine(fixes.length > 0 ? fixedWords(fixes) : null)
            }}
          />
        ) : null}
      </div>
      {fixLine ? (
        <p data-slot="name-fixed" className="text-caption text-muted-foreground">
          {fixLine}
        </p>
      ) : null}
      {near ? (
        <p id={countId} className="text-right text-caption text-muted-foreground tabular-nums">
          {countWords(draft.text.length, options.max_chars)}
        </p>
      ) : null}
      {showNothing ? (
        <p id={nothingId} role="alert" className="text-caption text-destructive-ink">
          {NOTHING_TO_SAVE}
        </p>
      ) : null}
    </div>
  )

  const who = person ? null : (
    <WhoWith
      company={company}
      failed={companyFailed}
      value={draft.contactId}
      kept={
        draft.contactId !== null && draft.contactName !== null
          ? { id: draft.contactId, name: draft.contactName }
          : null
      }
      onChange={(contact) => {
        update({ contactId: contact?.id ?? null, contactName: contact?.name ?? null })
      }}
    />
  )

  const outcome =
    options.outcomes.length > 0 ? (
      <section aria-labelledby={outcomeId} className="flex flex-col gap-2">
        <h3 id={outcomeId} className="text-ui font-semibold text-foreground">
          {OUTCOME}
        </h3>
        <ChipGroup
          mode="one-or-none"
          aria-labelledby={outcomeId}
          options={options.outcomes.map((name) => ({ value: name, label: name }))}
          value={draft.outcome === null ? [] : [draft.outcome]}
          onChange={([picked]) => {
            update({ outcome: picked ?? null })
          }}
        />
      </section>
    ) : null

  return (
    <div data-slot="note-view" className="flex h-full flex-col" onKeyDown={onKeyDown}>
      {/* A plain block, not a header element: inside the panel that would read as a second banner. */}
      <div className="flex items-start gap-2 border-b p-5 pr-14 max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pr-14">
        {onBack ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mt-1.5 -ml-2"
                aria-label={BACK_TO_SCRIPT}
                aria-keyshortcuts="Escape"
                onClick={onBack}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {BACK_TO_SCRIPT} <Kbd>Esc</Kbd>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle className="text-section">{LOG_CALL}</PanelTitle>
          <PanelDescription className="text-ui text-foreground">
            {whoLine(companyName, person)}
          </PanelDescription>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 max-sm:p-4">
        <div className="flex flex-col gap-6">
          {onPhone ? (
            <>
              {noteBox}
              {who}
            </>
          ) : (
            <>
              {who}
              {noteBox}
            </>
          )}
          {outcome}
          {followUp ? (
            <FollowUpFields
              value={draft.followUp}
              problem={followUpProblem}
              today={today}
              whatRef={whatRef}
              whenRef={whenRef}
              onChange={(value) => {
                update({ followUp: value })
              }}
              onRemoved={() => {
                textRef.current?.focus()
              }}
            />
          ) : null}
        </div>
      </div>
      {onPhone ? (
        <div className="border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" className="w-full" onClick={save}>
            {SAVE_AND_NEXT}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-3 border-t bg-popover px-5 py-3">
          <KbdGroup aria-hidden="true" className="touch:hidden">
            <Kbd>{mac ? 'Cmd' : 'Ctrl'}</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <Button type="button" aria-keyshortcuts="Control+Enter Meta+Enter" onClick={save}>
            {SAVE_AND_NEXT}
          </Button>
        </div>
      )}
    </div>
  )
}
