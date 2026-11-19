/**
 * The review card's layout for each action (PLAN-V22 T3-3, choice 24):
 *
 * - **A call:** who (the company and the person), then, once the server has sorted the note, how it
 *   went, the note, the field changes (HubSpot's value now, an arrow, the new one, from a fresh
 *   preview) and the follow-ups. Call logs' own parts show them (`note-parts.tsx`).
 * - **A task:** the company, what, when, the kind, for whom and more words.
 * - **An email:** to whom, the subject and the body. The body is text in a box, never HTML.
 * - **A pre-read** whose meeting the command couldn't pin down: "Which meeting?", or the plan's line
 *   when there is none ahead, with New pre-read.
 *
 * A choice the command left open ("Which James?") shows as buttons in its place, and the part
 * shows once it is picked. Every part a send waits for carries `data-box`.
 */
import { Hourglass, X } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useCompanySearch } from '@/api/hooks'
import { useTeam } from '@/api/hooks/meetings'
import type {
  AssistantMeetingHit,
  CallNoteOptions,
  CallNoteOut,
  CallNotePreview,
  CompanyHit,
  HubSpotWrite,
  TaskKind,
  TeamEmail,
  TeamMember,
  VoiceToolKind,
} from '@/api/types'
import { CardText, ChangeList, TaskList } from '@/apps/companies/call-logs/note-parts'
import { KIND_LABELS, SORTING } from '@/apps/companies/call-logs/words'
import { FIND_COMPANY, LOOKING, NO_MATCH } from '@/apps/companies/words'
import { Segmented } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { dueDateText } from '@/lib/due-date'
import { formatDateTime } from '@/lib/format'
import { useDebounced } from '@/hooks/useDebounced'
import {
  BODY_MAX,
  dueOf,
  isPending,
  MOST_PEOPLE,
  recipientOf,
  SUBJECT_MAX,
  type CallDraft,
  type Company,
  type EmailDraft,
  type Find,
  type Recipient,
  type TaskDraft,
} from './draft'
import { BoxField, CardLine, ChoiceList, PartProblem } from './parts'
import {
  ADD,
  ADD_PLACEHOLDER,
  ADD_SOMEONE,
  BODY,
  COMPANY,
  dueLine,
  FOR_WHOM,
  FOR_YOU,
  HOW_IT_WENT,
  HUBSPOT_OFF,
  KIND,
  MORE,
  NEW_PRE_READ,
  noCompanyWords,
  noMeetingWords,
  NO_ONE,
  NOT_SAID,
  NOTHING_ADDED,
  OPEN_CALL_LOGS,
  REMOVE,
  SUBJECT,
  THE_NOTE,
  TO,
  WHAT,
  WHEN,
  WHEN_PAST,
  WHEN_UNREADABLE,
  whichWords,
  WHICH_COMPANY,
  WHICH_MEETING,
  WHICH_PERSON,
  WHICH_TEAMMATE,
  WHO,
} from './words'

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as TaskKind[]).map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}))

// --- The company ----------------------------------------------------------------------------------

/** Find a company in our HubSpot copy, when the command found none: the box, then the matches. */
function CompanyPicker({ heard, onPick }: { heard: string; onPick: (company: Company) => void }) {
  const [text, setText] = useState(heard)
  const settled = useDebounced(text, 250)
  const search = useCompanySearch(settled)
  const hits: readonly CompanyHit[] =
    settled.trim().length >= 2 ? (search.data?.companies ?? []) : []
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui text-foreground">{noCompanyWords(heard)}</p>
      <Input
        id={id}
        data-box="company"
        aria-label={FIND_COMPANY}
        placeholder={FIND_COMPANY}
        autoComplete="off"
        value={text}
        className="touch:text-body"
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          // Down goes into the matches, which then move with the arrow keys.
          if (event.key !== 'ArrowDown') return
          const first = event.currentTarget
            .closest('[data-slot=company-picker]')
            ?.querySelector<HTMLButtonElement>('[data-slot=card-choice]')
          if (!first) return
          event.preventDefault()
          first.focus()
        }}
      />
      {hits.length > 0 ? (
        <ChoiceList
          label={WHICH_COMPANY}
          box="company"
          options={hits.slice(0, 6).map((hit) => ({
            id: hit.key,
            title: hit.name,
            detail: [hit.industry, hit.city].filter(Boolean).join(' · ') || null,
          }))}
          onPick={(key) => {
            const hit = hits.find((one) => one.key === key)
            if (hit) onPick({ key: hit.key, name: hit.name })
          }}
        />
      ) : settled.trim().length >= 2 ? (
        <p role="status" className="text-caption text-muted-foreground">
          {search.isFetching ? LOOKING : NO_MATCH}
        </p>
      ) : null}
    </div>
  )
}

/** The company: as found, to pick from two or more, or to find. */
function CompanyPart({
  company,
  onPick,
}: {
  company: Find<Company>
  onPick: (company: Company) => void
}) {
  if (company.found) return <CardLine label={COMPANY}>{company.found.name}</CardLine>
  if (isPending(company)) {
    return (
      <ChoiceList
        label={whichWords(company.heard, WHICH_COMPANY)}
        box="company"
        options={company.choices.map((one) => ({ id: one.key, title: one.name }))}
        onPick={(key) => {
          const picked = company.choices.find((one) => one.key === key)
          if (picked) onPick(picked)
        }}
      />
    )
  }
  return (
    <div data-slot="company-picker">
      <CompanyPicker heard={company.heard} onPick={onPick} />
    </div>
  )
}

// --- A call -------------------------------------------------------------------------------------------

/** While the server sorts the note: the word with the hourglass, over still grey lines. */
function SortingPart() {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Hourglass aria-hidden="true" className="size-4 shrink-0" />
        {SORTING}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}

export interface CallLayoutProps {
  draft: CallDraft
  onDraft: (draft: CallDraft) => void
  /** The saved note, as the server has it now, once saved. */
  note: CallNoteOut | undefined
  preview: CallNotePreview | undefined
  options: CallNoteOptions | undefined
  today: string
  onOpenCallLogs: () => void
}

export function CallLayout({
  draft,
  onDraft,
  note,
  preview,
  options,
  today,
  onOpenCallLogs,
}: CallLayoutProps) {
  const { person } = draft
  const companyPicked = draft.company.found !== null
  const fresh = preview?.items.find((one) => one.id === note?.id)
  const sorted = note !== undefined && note.status !== 'sorting'
  return (
    <div className="flex flex-col gap-4">
      <CompanyPart
        company={draft.company}
        onPick={(company) => {
          onDraft({
            ...draft,
            company: { ...draft.company, found: company, choices: [] },
            edited: true,
          })
        }}
      />
      {companyPicked ? (
        isPending(person) ? (
          <ChoiceList
            label={whichWords(person.heard, WHICH_PERSON)}
            box="person"
            options={[
              ...person.choices.map((one) => ({ id: one.id, title: one.name, detail: one.title })),
              { id: '', title: NO_ONE },
            ]}
            onPick={(id) => {
              const picked = person.choices.find((one) => one.id === id) ?? null
              onDraft({ ...draft, person: { ...person, found: picked, choices: [] }, edited: true })
            }}
          />
        ) : (
          <CardLine label={WHO}>
            {person.found ? (
              <>
                {person.found.name}
                {person.found.title ? (
                  <span className="text-muted-foreground">, {person.found.title}</span>
                ) : null}
              </>
            ) : (
              NO_ONE
            )}
          </CardLine>
        )
      ) : null}
      {draft.noteId !== null ? (
        sorted ? (
          <>
            <CardLine label={HOW_IT_WENT}>{note.call.outcome ?? NOT_SAID}</CardLine>
            <CardLine label={THE_NOTE}>
              <CardText text={note.call.summary.trim() || note.text} />
            </CardLine>
            <ChangeList
              changes={fresh?.changes ?? note.changes}
              fields={options?.fields ?? []}
              editing={false}
              onSave={() => undefined}
              onCancel={() => undefined}
            />
            <TaskList
              tasks={note.tasks}
              editing={false}
              today={today}
              onSave={() => undefined}
              onCancel={() => undefined}
            />
            {preview && !preview.sending_ready ? (
              <div className="flex flex-col items-start gap-2">
                <PartProblem>{HUBSPOT_OFF}</PartProblem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:h-11"
                  onClick={onOpenCallLogs}
                >
                  {OPEN_CALL_LOGS}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <SortingPart />
        )
      ) : null}
    </div>
  )
}

// --- For whom, and to whom ---------------------------------------------------------------------------

function nameOf(one: Recipient): string {
  return one.found?.name ?? one.address ?? one.heard
}

/** One teammate or address: as found, with why it can't be sent to, or to pick from. */
function RecipientPart({
  one,
  label,
  onPick,
  onRemove,
}: {
  one: Recipient
  label: string
  onPick: (member: TeamMember) => void
  onRemove: () => void
}) {
  if (one.found === null && one.choices.length > 0) {
    return (
      <li>
        <ChoiceList
          label={whichWords(one.heard, WHICH_TEAMMATE)}
          box={label === FOR_WHOM ? 'for-whom' : 'to'}
          options={one.choices.map((member) => ({ id: member.owner_id, title: member.name }))}
          onPick={(id) => {
            const member = one.choices.find((choice) => choice.owner_id === id)
            if (member) onPick(member)
          }}
        />
      </li>
    )
  }
  const name = nameOf(one)
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="touch:size-11"
          aria-label={`${REMOVE} ${name}`}
          data-box={one.problem ? (label === FOR_WHOM ? 'for-whom' : 'to') : undefined}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </span>
      {one.problem ? <PartProblem>{one.problem}</PartProblem> : null}
    </li>
  )
}

/** Add a teammate by name, or a Contour address typed in full (the server checks it). */
function AddSomeone({ onAdd, full }: { onAdd: (one: Recipient) => void; full: boolean }) {
  const team = useTeam()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const id = useId()
  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const typed = text.trim()
    if (typed === '' || full) return
    const words = typed.toLowerCase()
    const members = (team.data ?? []).filter(
      (member) => member.has_account && member.name.toLowerCase().includes(words),
    )
    if (members.length === 1 && members[0]) {
      onAdd(
        recipientOf({ heard: typed, found: members[0], choices: [], address: null, problem: null }),
      )
    } else if (members.length > 1) {
      onAdd(
        recipientOf({ heard: typed, found: null, choices: members, address: null, problem: null }),
      )
    } else if (typed.includes('@')) {
      onAdd(recipientOf({ heard: typed, found: null, choices: [], address: typed, problem: null }))
    } else {
      setProblem(NOTHING_ADDED)
      return
    }
    setText('')
    setProblem(null)
  }
  return (
    <form noValidate className="flex flex-col gap-1.5" onSubmit={add}>
      <label htmlFor={id} className="sr-only">
        {ADD_SOMEONE}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          placeholder={ADD_PLACEHOLDER}
          autoComplete="off"
          className="touch:text-body"
          onChange={(event) => {
            setText(event.target.value)
            setProblem(null)
          }}
        />
        <Button type="submit" variant="outline" className="touch:h-11" disabled={full}>
          {ADD}
        </Button>
      </div>
      {problem ? <PartProblem>{problem}</PartProblem> : null}
    </form>
  )
}

// --- A task -----------------------------------------------------------------------------------------------

export interface TaskLayoutProps {
  draft: TaskDraft
  onDraft: (draft: TaskDraft) => void
  preview: HubSpotWrite | undefined
  mic: VoiceToolKind | null
  today: string
}

export function TaskLayout({ draft, onDraft, preview, mic, today }: TaskLayoutProps) {
  const due = dueOf(draft, today)
  const change = (part: Partial<TaskDraft>): void => {
    onDraft({ ...draft, ...part, edited: true })
  }
  const names = draft.company.found ? [draft.company.found.name] : []
  return (
    <div className="flex flex-col gap-4">
      <CompanyPart
        company={draft.company}
        onPick={(company) => {
          change({ company: { ...draft.company, found: company, choices: [] } })
        }}
      />
      <BoxField
        label={WHAT}
        box="subject"
        value={draft.subject}
        max={SUBJECT_MAX.task}
        mic={mic}
        names={names}
        invalid={draft.subject.trim() === ''}
        onChange={(subject) => {
          change({ subject })
        }}
      />
      <BoxField
        label={WHEN}
        box="due"
        value={draft.when}
        max={60}
        mic={null}
        invalid={due.kind !== 'date'}
        hint={
          due.kind === 'date' ? (
            dueLine(dueDateText(due.date))
          ) : due.kind === 'past' ? (
            <PartProblem>{WHEN_PAST}</PartProblem>
          ) : due.kind === 'unreadable' ? (
            <PartProblem>{WHEN_UNREADABLE}</PartProblem>
          ) : null
        }
        onChange={(when) => {
          change({ when })
        }}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground">{KIND}</span>
        <Segmented
          aria-label={KIND}
          options={KIND_OPTIONS}
          value={draft.kind}
          onChange={(kind) => {
            change({ kind })
          }}
        />
      </div>
      {draft.forWhom ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">{FOR_WHOM}</span>
          <ul className="flex flex-col gap-1 text-ui">
            <RecipientPart
              one={draft.forWhom}
              label={FOR_WHOM}
              onPick={(member) => {
                if (draft.forWhom)
                  change({ forWhom: { ...draft.forWhom, found: member, choices: [] } })
              }}
              onRemove={() => {
                change({ forWhom: null })
              }}
            />
          </ul>
        </div>
      ) : (
        <CardLine label={FOR_WHOM}>{FOR_YOU}</CardLine>
      )}
      <BoxField
        label={MORE}
        box="more"
        lines
        value={draft.body}
        max={BODY_MAX.task}
        mic={mic}
        names={names}
        onChange={(body) => {
          change({ body })
        }}
      />
      {preview ? (
        <PreviewLines lines={[...(preview.plan.warnings ?? []), preview.waiting_for ?? '']} />
      ) : null}
    </div>
  )
}

/** What the server's preview says that the boxes don't: a warning, or why it can't go yet. */
function PreviewLines({ lines }: { lines: readonly string[] }) {
  const shown = lines.filter((line) => line.trim() !== '')
  if (shown.length === 0) return null
  return (
    <div data-slot="card-preview" className="flex flex-col gap-1">
      {shown.map((line) => (
        <p key={line} className="text-caption text-pretty text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  )
}

// --- An email -----------------------------------------------------------------------------------------------

export interface EmailLayoutProps {
  draft: EmailDraft
  onDraft: (draft: EmailDraft) => void
  preview: TeamEmail | undefined
  mic: VoiceToolKind | null
}

export function EmailLayout({ draft, onDraft, preview, mic }: EmailLayoutProps) {
  const change = (part: Partial<EmailDraft>): void => {
    onDraft({ ...draft, ...part, edited: true })
  }
  const toId = useId()
  const names = draft.to.map(nameOf)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span id={toId} className="text-caption text-muted-foreground">
          {TO}
        </span>
        {draft.to.length > 0 ? (
          <ul aria-labelledby={toId} className="flex flex-col gap-1 text-ui">
            {draft.to.map((one) => (
              <RecipientPart
                key={one.id}
                one={one}
                label={TO}
                onPick={(member) => {
                  change({
                    to: draft.to.map((each) =>
                      each.id === one.id ? { ...each, found: member, choices: [] } : each,
                    ),
                  })
                }}
                onRemove={() => {
                  change({ to: draft.to.filter((each) => each.id !== one.id) })
                }}
              />
            ))}
          </ul>
        ) : null}
        <div data-box={draft.to.length === 0 ? 'to' : undefined}>
          <AddSomeone
            full={draft.to.length >= MOST_PEOPLE}
            onAdd={(one) => {
              change({ to: [...draft.to, one] })
            }}
          />
        </div>
      </div>
      <BoxField
        label={SUBJECT}
        box="subject"
        value={draft.subject}
        max={SUBJECT_MAX.email}
        mic={mic}
        names={names}
        invalid={draft.subject.trim() === ''}
        onChange={(subject) => {
          change({ subject })
        }}
      />
      <BoxField
        label={BODY}
        box="body"
        lines
        value={draft.body}
        max={BODY_MAX.email}
        mic={mic}
        names={names}
        invalid={draft.body.trim() === ''}
        onChange={(body) => {
          change({ body })
        }}
      />
      {preview ? <PreviewLines lines={[preview.waiting_for ?? '']} /> : null}
    </div>
  )
}

// --- A pre-read whose meeting isn't pinned down ----------------------------------------------------

export interface PreReadLayoutProps {
  /** Two or more meetings, soonest first. Empty: none ahead. */
  meetings: readonly AssistantMeetingHit[]
  /** The company, for the line when there is no meeting ahead. */
  company: string
  onPick: (meeting: AssistantMeetingHit) => void
  onNew: () => void
}

export function PreReadLayout({ meetings, company, onPick, onNew }: PreReadLayoutProps) {
  if (meetings.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ui text-pretty text-foreground">{noMeetingWords(company)}</p>
        <Button type="button" variant="outline" onClick={onNew}>
          {NEW_PRE_READ}
        </Button>
      </div>
    )
  }
  return (
    <ChoiceList
      label={WHICH_MEETING}
      box="company"
      options={meetings.map((meeting, index) => ({
        id: String(index),
        title: meeting.title,
        detail: [meeting.company_name, formatDateTime(meeting.starts_at)].join(' · '),
      }))}
      onPick={(index) => {
        const meeting = meetings[Number(index)]
        if (meeting) onPick(meeting)
      }}
    />
  )
}
