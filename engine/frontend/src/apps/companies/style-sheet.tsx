/**
 * The script's style (PLAN-V14 T3-5): a "Style" row at the top of the script, and the side sheet it
 * opens, with two parts.
 *
 * - **Team style:** the active notes, each with who approved it and when, and a box to suggest a
 *   note. An Admin also sees the waiting suggestions (Approve, Reject) and can retire an active
 *   note. Anyone else sees their own suggestions and what became of them.
 * - **Your style:** one note, only for you, up to 600 characters.
 *
 * Style changes the wording of the next script call prep writes, never its facts, so a change shows
 * "Not used yet. Research again." until the next script is made. The limits come from the API.
 */
import { CircleCheck, Hourglass, SlidersHorizontal, XCircle } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { toApiProblem } from '@/api/client'
import {
  useDecideTeamNote,
  useRetireTeamNote,
  useSaveMyStyle,
  useScriptStyle,
  useSuggestTeamNote,
} from '@/api/hooks/script'
import type { ScriptStyleOut } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/lib/format'
import { problemHint, toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'
import { styleSummary, withNote } from './style-words'

type StyleNote = ScriptStyleOut['team'][number]

export const STYLE_PURPOSE =
  'Style changes the wording. It never adds facts. Press Research again to use it.'
export const NOT_USED_YET = 'Not used yet. Research again.'

/** A failed save, said under its box: what happened and what to do. */
function problemWords(error: unknown): string {
  const problem = toApiProblem(error)
  return [problem.title, problem.detail, problemHint(problem)]
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part ?? '') ? part : `${part ?? ''}.`))
    .join(' ')
}

export interface StyleRowProps {
  /** The script was written by call prep (it can use a style), or from our HubSpot copy. */
  madeFrom: 'hubspot' | 'claude'
  /** The style changed while this script was shown. */
  changedSince: boolean
  onOpen: () => void
}

/** "Style: Team (3 notes) and yours", at the top of the script. It opens the sheet. */
export function StyleRow({ madeFrom, changedSince, onOpen }: StyleRowProps) {
  const style = useScriptStyle()
  const summary = style.data ? styleSummary(style.data) : style.error ? 'Not loaded' : '...'
  const note =
    madeFrom === 'hubspot' ? "Used by call prep's scripts." : changedSince ? NOT_USED_YET : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`Style: ${summary}`}
        onClick={onOpen}
        className="max-w-full"
      >
        <SlidersHorizontal aria-hidden="true" />
        <span className="truncate">
          <span className="text-muted-foreground">Style: </span>
          {summary}
        </span>
      </Button>
      {note ? (
        <span role="status" className="text-caption text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}

/** "12 of 600", and too long in the error colour. */
function Counter({ id, length, max }: { id: string; length: number; max: number }) {
  const over = length > max
  return (
    <p
      id={id}
      className={cn(
        'text-caption tabular-nums',
        over ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {over
        ? `Too long: ${String(length)} of ${String(max)} characters.`
        : `${String(length)} of ${String(max)} characters`}
    </p>
  )
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-body font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-caption text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  )
}

function NoteText({ children }: { children: ReactNode }) {
  return <p className="text-ui whitespace-pre-line text-foreground">{children}</p>
}

/** One active team note: its words, who approved it and when, and Retire for an Admin. */
function TeamNote({
  note,
  canDecide,
  onChanged,
}: {
  note: StyleNote
  canDecide: boolean
  onChanged: () => void
}) {
  const retire = useRetireTeamNote()
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <NoteText>{note.text}</NoteText>
        <p className="text-caption text-muted-foreground">
          Approved by {note.decided_by ?? 'an Admin'}
          {note.decided_at ? `, ${formatDate(note.decided_at)}` : ''}
        </p>
      </div>
      {canDecide ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={retire.isPending}
          aria-label={`Retire: ${note.text}`}
          onClick={() => {
            retire.mutate(note.id, {
              onSuccess: () => {
                toast("Retired. It leaves everyone's next scripts.")
                onChanged()
              },
              onError: toastProblem,
            })
          }}
        >
          Retire
        </Button>
      ) : null}
    </li>
  )
}

const STATUS = {
  suggested: { icon: Hourglass, words: 'Waiting' },
  rejected: { icon: XCircle, words: 'Not approved' },
  active: { icon: CircleCheck, words: 'Approved' },
  retired: { icon: XCircle, words: 'Retired' },
} as const

/** A suggestion: an Admin decides it; its author sees what became of it. */
function Suggestion({
  note,
  canDecide,
  onChanged,
}: {
  note: StyleNote
  canDecide: boolean
  onChanged: () => void
}) {
  const decide = useDecideTeamNote()
  const status = STATUS[note.status]
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-background p-3">
      <NoteText>{note.text}</NoteText>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="mr-auto text-caption text-muted-foreground">
          {canDecide ? `Suggested by ${note.suggested_by ?? 'someone who has left'}, ` : 'Sent '}
          {formatDate(note.created_at)}
        </p>
        {canDecide && note.status === 'suggested' ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={decide.isPending}
              aria-label={`Reject: ${note.text}`}
              onClick={() => {
                decide.mutate(
                  { id: note.id, approve: false },
                  {
                    onSuccess: () => toast('Rejected.'),
                    onError: toastProblem,
                  },
                )
              }}
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={decide.isPending}
              aria-label={`Approve: ${note.text}`}
              onClick={() => {
                decide.mutate(
                  { id: note.id, approve: true },
                  {
                    onSuccess: () => {
                      toast("Approved. Everyone's next scripts use it.")
                      onChanged()
                    },
                    onError: toastProblem,
                  },
                )
              }}
            >
              Approve
            </Button>
          </>
        ) : (
          <Badge variant="outline">
            <status.icon aria-hidden="true" />
            {status.words}
          </Badge>
        )}
      </div>
    </li>
  )
}

/** The box to suggest a team note. An Admin's own note is active at once (TBC). */
function SuggestBox({ style, onChanged }: { style: ScriptStyleOut; onChanged: () => void }) {
  const suggest = useSuggestTeamNote()
  const [text, setText] = useState('')
  const id = useId()
  const max = style.team_max_chars
  const full = style.team.length >= style.team_max_notes
  const blank = text.trim() === ''
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (blank || text.length > max) return
        suggest.mutate(text.trim(), {
          onSuccess: () => {
            setText('')
            if (style.can_decide) {
              toast("Added to the team style. Everyone's next scripts use it.")
              onChanged()
            } else toast('Suggested. An Admin looks at it before it is used.')
          },
        })
      }}
    >
      <label htmlFor={`${id}-box`} className="text-ui font-semibold">
        {style.can_decide ? 'Add a team note' : 'Suggest a team note'}
      </label>
      <Textarea
        id={`${id}-box`}
        value={text}
        maxLength={max}
        rows={2}
        placeholder="Short openers. Ask for two minutes first."
        aria-describedby={`${id}-count ${id}-hint`}
        aria-invalid={suggest.isError || undefined}
        onChange={(event) => {
          setText(event.target.value)
          if (suggest.isError) suggest.reset()
        }}
      />
      <Counter id={`${id}-count`} length={text.length} max={max} />
      <p id={`${id}-hint`} className="text-caption text-muted-foreground">
        {full
          ? `The team style is full (${String(style.team_max_notes)} notes). An Admin retires one first.`
          : style.can_decide
            ? 'As an Admin, your note is active at once.'
            : 'An Admin approves it before anyone’s script uses it.'}
      </p>
      {suggest.isError ? (
        <p role="alert" className="text-ui text-destructive">
          {problemWords(suggest.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={blank || text.length > max || suggest.isPending || full}
      >
        {style.can_decide ? 'Add to team style' : 'Suggest to team'}
      </Button>
    </form>
  )
}

/** Your style: one box, a counter and Save. `prefill` adds a note from a line you edited. */
function MineBox({
  style,
  prefill,
  onChanged,
}: {
  style: ScriptStyleOut
  prefill: string | null
  onChanged: () => void
}) {
  const save = useSaveMyStyle()
  const [text, setText] = useState(() => withNote(style.mine, prefill))
  const id = useId()
  const max = style.mine_max_chars
  const unchanged = text.trim() === style.mine.trim()
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.length > max) return
        save.mutate(text.trim(), {
          onSuccess: (saved) => {
            setText(saved.mine)
            toast(saved.mine ? 'Your style is saved.' : 'Your style is cleared.')
            onChanged()
          },
        })
      }}
    >
      <label htmlFor={`${id}-box`} className="sr-only">
        Your style
      </label>
      <Textarea
        id={`${id}-box`}
        value={text}
        rows={5}
        // A filled-in note from a line may be checked first, so it starts focused.
        autoFocus={Boolean(prefill)}
        placeholder="Warm, short sentences. Use first names. Ask before you pitch."
        aria-describedby={`${id}-count`}
        aria-invalid={save.isError || text.length > max || undefined}
        onChange={(event) => {
          setText(event.target.value)
          if (save.isError) save.reset()
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Counter id={`${id}-count`} length={text.length} max={max} />
        {style.mine_updated_at ? (
          <p className="text-caption text-muted-foreground">
            Saved {formatDate(style.mine_updated_at)}
          </p>
        ) : null}
      </div>
      {save.isError ? (
        <p role="alert" className="text-ui text-destructive">
          {problemWords(save.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        className="w-fit"
        disabled={unchanged || text.length > max || save.isPending}
      >
        Save my style
      </Button>
    </form>
  )
}

export interface StyleSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A note to add to Your style when it opens (from "Make it my style"), or null. */
  prefill?: string | null
  /** The style that scripts use changed: yours, or the team's. */
  onChanged: () => void
}

/** The side sheet: Team style, then Your style. */
export function StyleSheet({ open, onOpenChange, prefill = null, onChanged }: StyleSheetProps) {
  const style = useScriptStyle()
  const id = useId()
  const data = style.data
  const waiting = data?.suggestions.filter((note) => note.status === 'suggested') ?? []
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="gap-1 pr-12">
          <SheetTitle>Script style</SheetTitle>
          <SheetDescription>{STYLE_PURPOSE}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-8 px-4 pb-8">
          {style.error ? (
            <ErrorState
              error={style.error}
              context="The style couldn't be loaded."
              onRetry={() => void style.refetch()}
            />
          ) : !data ? (
            <Pending label="Loading the style.">
              <SkeletonLines count={6} />
            </Pending>
          ) : (
            <>
              <Section
                id={`${id}-team`}
                title="Team style"
                lead={`${String(data.team.length)} of ${String(data.team_max_notes)} notes. Everyone's next scripts use them.`}
              >
                {data.team.length === 0 ? (
                  <p className="font-serif text-ui text-muted-foreground">No team notes yet.</p>
                ) : (
                  <ul aria-label="Team notes" className="flex flex-col gap-2">
                    {data.team.map((note) => (
                      <TeamNote
                        key={note.id}
                        note={note}
                        canDecide={data.can_decide}
                        onChanged={onChanged}
                      />
                    ))}
                  </ul>
                )}
                <SuggestBox style={data} onChanged={onChanged} />
                {data.can_decide && waiting.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-ui font-semibold">Waiting for a decision</h4>
                    <ul aria-label="Waiting for a decision" className="flex flex-col gap-2">
                      {waiting.map((note) => (
                        <Suggestion key={note.id} note={note} canDecide onChanged={onChanged} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!data.can_decide && data.suggestions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-ui font-semibold">Your suggestions</h4>
                    <ul aria-label="Your suggestions" className="flex flex-col gap-2">
                      {data.suggestions.map((note) => (
                        <Suggestion
                          key={note.id}
                          note={note}
                          canDecide={false}
                          onChanged={onChanged}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Section>
              <Section
                id={`${id}-mine`}
                title="Your style"
                lead="Only you see it. It goes into your next scripts. Nothing here is shared."
              >
                <MineBox style={data} prefill={prefill} onChanged={onChanged} />
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
