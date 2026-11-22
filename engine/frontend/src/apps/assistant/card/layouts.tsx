/**
 * The review card's layout for each action (PLAN-V22 T3-3, choice 24):
 *
 * - **A call:** who (the company and the person), then, once the server has sorted the note, how it
 *   went, the note, the field changes (HubSpot's value now, an arrow, the new one, from a fresh
 *   preview) and the follow-ups. Call logs' own fields show them (`note-parts.tsx`), so each part
 *   takes typing as well as voice (PLAN-V23 T4-2). A call saved before its company (PLAN-V24
 *   T3-2) shows only its company part until the company is picked.
 * - **A task:** the company, what, when, the kind, for whom and more words.
 * - **An email:** to whom, the subject and the body. The body is text in a box, never HTML.
 * - **A pre-read** whose meeting the command couldn't pin down: "Which meeting?", or the plan's line
 *   when there is none ahead, with New pre-read.
 *
 * A choice the command left open ("Which James?") shows as buttons in its place, and the part
 * shows once it is picked. With a level (PLAN-V25 T1-2), each unclear company, person, teammate and
 * meeting shows in the one suggestion part (`suggest.tsx`): a suggestion with its reason, or up to
 * 3 choices and Search. A person found before their company (T2-2) is suggested with it ("Jo
 * Sample at Northwind Sample Pty Ltd?"), and taking them fills both. Every part a send waits for carries `data-box`. The company, with
 * "Add to HubSpot" when it is nowhere (PLAN-V23 T1-6), is its own part (`company.tsx`).
 */
import { useQueryClient } from '@tanstack/react-query'
import { Hourglass, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTeam } from '@/api/hooks/meetings'
import { queryKeys } from '@/api/query'
import type {
  AssistantMeetingHit,
  CallNoteChange,
  CallNoteOptions,
  CallNoteOut,
  CallNotePatch,
  CallNotePreview,
  CallNoteTask,
  HubSpotWrite,
  TaskKind,
  TeamEmail,
  TeamMember,
  VoiceToolKind,
} from '@/api/types'
import {
  CardText,
  ChangeList,
  NEW_PART,
  SummaryField,
  TaskList,
} from '@/apps/companies/call-logs/note-parts'
import {
  callTypesOf,
  changeLabel,
  DEFAULT_CALL_TYPE,
  isMeetingNotes,
  KIND_LABELS,
  removedChangeWords,
  removedTaskWords,
  SORTING,
  UNDO,
  type CallType,
} from '@/apps/companies/call-logs/words'
import { useNoHubSpotUser } from '@/auth/hubspot-user'
import { ChipGroup, Segmented } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { dueDateText } from '@/lib/due-date'
import { formatDateTime } from '@/lib/format'
import { CompanyPart, type CompanyVoice } from './company'
import {
  BODY_MAX,
  dueOf,
  isDueSuggested,
  isPending,
  isPersonFirst,
  isPersonNowhere,
  MOST_PEOPLE,
  nudgeDayOf,
  pickCompany,
  pickDue,
  pickPerson,
  recipientOf,
  SUBJECT_MAX,
  turnDown,
  type CallDraft,
  type CompanyFind,
  type EmailDraft,
  type Recipient,
  type TaskDraft,
} from './draft'
import { CallTypePart, DueChoices, FollowUpNudge, SubjectAsk } from './gaps'
import { BoxField, CardLine, ChoiceList, PartProblem } from './parts'
import { SuggestPart } from './suggest'
import { FollowUpFor, TeammatePicker } from './teammate'
import { GIVE_IT_TO_A_TEAMMATE, ownerIdOf } from './teammate-rules'
import {
  ADD,
  ADD_PLACEHOLDER,
  ADD_SOMEONE,
  BODY,
  dueAskWords,
  dueLine,
  followUpWithWords,
  FOR_WHOM,
  FOR_YOU,
  HOW_IT_WENT,
  HUBSPOT_OFF,
  KIND,
  MEETING,
  MORE,
  NEW_PRE_READ,
  noMeetingWords,
  NO_ONE,
  personAtWords,
  personNowhereWords,
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
  WHICH_MEETING,
  WHICH_PERSON,
  WHICH_TEAMMATE,
  WHO,
} from './words'

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as TaskKind[]).map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}))

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

/** A change typed into the call: what the server is told, and the same change on screen at once. */
export type EditCall = (patch: CallNotePatch, apply: (note: CallNoteOut) => CallNoteOut) => void

/** The whole list of changes, as the server takes it. A part made here goes with no id. */
function changesPatch(changes: readonly CallNoteChange[]): CallNotePatch {
  return {
    changes: changes.map((change) => ({
      id: change.id.startsWith(NEW_PART) ? null : change.id,
      field: change.field,
      office: change.office,
      value: change.value,
    })),
  }
}

/**
 * The whole list of follow-ups, as the server takes it. A part made here goes with no id. Each keeps
 * the teammate it is for (PLAN-V23 T3-4): one left out is the rep's own, so a list sent without
 * them would clear them.
 */
function tasksPatch(
  tasks: readonly CallNoteTask[],
  ownerOf: (task: CallNoteTask) => string | null,
): CallNotePatch {
  return {
    tasks: tasks.map((task) => {
      const owner = ownerOf(task)
      return {
        id: task.id.startsWith(NEW_PART) ? null : task.id,
        subject: task.subject,
        due: task.due,
        due_words: task.due_words,
        kind: task.kind,
        ...(owner ? { owner_id: owner } : {}),
      }
    }),
  }
}

interface CallBoxesProps {
  note: CallNoteOut
  /** The note in a fresh preview, with HubSpot's values now. */
  fresh: CallNoteOut | undefined
  options: CallNoteOptions | undefined
  today: string
  onEdit: EditCall
  onLeaveBox: () => void
}

/**
 * A sorted call, each part a box to type in (PLAN-V23 T4-2; PLAN-V22 says typing always works where
 * voice does): how it went, the note, each change's new value, and each follow-up's words, kind and
 * day, with "Add a follow-up". They are Call logs' own fields (`note-parts.tsx`): each saves when
 * it is left, or on Enter in a one-line box. On the card, Esc leaves a box and keeps what was typed
 * (choice 19; the card stops the field's own Esc, which on Call logs puts it back). A part removed
 * goes at once, with Undo in a toast, as on Call logs.
 */
function CallBoxes({ note, fresh, options, today, onEdit, onLeaveBox }: CallBoxesProps) {
  const client = useQueryClient()
  // No HubSpot user (PLAN-V23 T3-4): each follow-up needs a teammate, picked from the team list.
  const noUser = useNoHubSpotUser()
  const team = useTeam({ enabled: noUser })
  const outcomeId = useId()
  const storedSummary = note.call.summary.trim()
  const outcome = note.call.outcome
  const offered = options?.outcomes ?? []
  // A logged meeting's notes have no call outcome to pick: they go to HubSpot as a note.
  const outcomes = isMeetingNotes(note)
    ? []
    : outcome && !offered.includes(outcome)
      ? [...offered, outcome]
      : offered
  // The new values are the note's, which a box changes at once; HubSpot's now come from the
  // fresh preview.
  const changes = note.changes.map((change) => {
    const now = fresh?.changes.find((one) => one.id === change.id)
    return now ? { ...change, current: now.current, current_changed: now.current_changed } : change
  })
  const saveChanges = (next: CallNoteChange[]): void => {
    onEdit(changesPatch(next), (now) => ({ ...now, changes: next }))
  }
  const saveTasks = (next: CallNoteTask[], picked?: { task: string; owner: string }): void => {
    const ownerOf = (task: CallNoteTask): string | null =>
      task.id === picked?.task ? picked.owner : ownerIdOf(task, team.data)
    onEdit(tasksPatch(next, ownerOf), (now) => ({ ...now, tasks: next }))
  }
  /** Undo puts a removed part back where it was, in the note as it is then, as a new part. */
  const offerUndo = <Part extends { id: string }>(
    words: string,
    part: Part,
    index: number,
    listOf: (now: CallNoteOut) => Part[],
    save: (list: Part[]) => void,
  ): void => {
    toast(words, {
      action: {
        label: UNDO,
        onClick: () => {
          const latest =
            client.getQueryData<CallNoteOut>(queryKeys.companies.callNote(note.id)) ?? note
          const list = [...listOf(latest)]
          list.splice(Math.min(index, list.length), 0, {
            ...part,
            id: `${NEW_PART}${crypto.randomUUID()}`,
          })
          save(list)
        },
      },
    })
  }
  return (
    <div data-slot="call-edit" className="flex flex-col gap-4">
      {outcomes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span id={outcomeId} className="text-caption text-muted-foreground">
            {HOW_IT_WENT}
          </span>
          <ChipGroup
            mode="one-or-none"
            aria-labelledby={outcomeId}
            options={outcomes.map((name) => ({ value: name, label: name }))}
            value={outcome === null ? [] : [outcome]}
            onChange={([picked]) => {
              const next = picked ?? null
              onEdit({ outcome: next }, (now) => ({ ...now, call: { ...now.call, outcome: next } }))
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground">{THE_NOTE}</span>
        {storedSummary === '' && note.text.trim() !== '' ? (
          // The rep's own words stay in view, read-only, while they write a short summary.
          <CardText text={note.text} className="text-muted-foreground" />
        ) : null}
        <SummaryField
          value={storedSummary}
          label={THE_NOTE}
          autoFocus={false}
          onSave={(text) => {
            onEdit({ summary: text }, (now) => ({ ...now, call: { ...now.call, summary: text } }))
          }}
          onCancel={onLeaveBox}
        />
      </div>
      <ChangeList
        changes={changes}
        fields={options?.fields ?? []}
        editing
        onSave={(next, removed) => {
          saveChanges(next)
          if (removed) {
            offerUndo(
              removedChangeWords(changeLabel(removed.label, removed.office)),
              removed,
              changes.findIndex((change) => change.id === removed.id),
              (now) => now.changes,
              saveChanges,
            )
          }
        }}
        onCancel={onLeaveBox}
      />
      <TaskList
        tasks={note.tasks}
        editing
        today={today}
        onSave={(next, removed) => {
          saveTasks(next)
          if (removed) {
            offerUndo(
              removedTaskWords(removed.subject),
              removed,
              note.tasks.findIndex((task) => task.id === removed.id),
              (now) => now.tasks,
              saveTasks,
            )
          }
        }}
        onCancel={onLeaveBox}
        forBox={
          noUser
            ? (task) => (
                <FollowUpFor
                  task={task}
                  onPick={(member) => {
                    saveTasks(
                      note.tasks.map((one) =>
                        one.id === task.id ? { ...one, owner: member.name } : one,
                      ),
                      { task: task.id, owner: member.owner_id },
                    )
                  }}
                />
              )
            : undefined
        }
      />
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
  /** A box typed in (PLAN-V23 T4-2). */
  onEdit: EditCall
  /** A box's own Esc, where it is reached: the focus leaves the box. */
  onLeaveBox: () => void
  /** How long the company's add check waits after the last key (PLAN-V23 T1-6). */
  previewMs?: number
  /** The company said again (PLAN-V24 T3-2). */
  voice?: CompanyVoice | null
  /**
   * The company part changed by its level (PLAN-V25): a suggestion turned down, or a sure company
   * changed or undone. A saved call's own company changes through the card (`card.tsx`).
   */
  onCompany?: ((next: CompanyFind) => void) | null
  /** A call type tapped (PLAN-V25 T3-1): the card keeps it, and tells the server. */
  onCallType?: ((type: CallType) => void) | null
}

/** A follow-up the nudge adds (PLAN-V25 T3-2): due on its day, on the call's person or company. */
function nudgeTask(draft: CallDraft, day: string): CallNoteTask {
  const name = draft.person.found?.name ?? draft.company.found?.name ?? draft.company.heard
  return {
    id: `${NEW_PART}${crypto.randomUUID()}`,
    subject: followUpWithWords(name),
    due: day,
    due_words: '',
    kind: 'call',
    owner: null,
    in_hubspot: false,
  }
}

/**
 * The person a call was with, when the command wasn't sure (PLAN-V25 T1-2, T2-2): found before
 * their company, each choice brings it ("Jo Sample at Northwind Sample Pty Ltd?") and is told apart
 * by it; at the company, by their job title, with "No one in particular" last.
 */
function PersonSuggest({
  draft,
  onDraft,
  onSearch,
}: {
  draft: CallDraft
  onDraft: (draft: CallDraft) => void
  onSearch: (() => void) | null
}) {
  const { person } = draft
  const first = isPersonFirst(draft)
  const [one] = person.choices
  return (
    <SuggestPart
      box={first ? 'company' : 'person'}
      label={WHO}
      level={person.level === 'likely' ? 'likely' : 'unsure'}
      suggestion={one ? personAtWords(one.name, first ? one.company_name : null) : undefined}
      reason={person.reason}
      question={whichWords(person.heard, WHICH_PERSON)}
      choices={person.choices.map((choice) => ({
        id: choice.id,
        title: choice.name,
        // What tells two alike apart: their company when found before it, else their job title.
        detail: first ? (choice.company_name ?? choice.title) : choice.title,
      }))}
      extra={first ? null : { id: '', title: NO_ONE }}
      onPick={(id) => {
        const picked = person.choices.find((choice) => choice.id === id) ?? null
        onDraft(pickPerson(draft, picked))
      }}
      onTurnDown={() => {
        // The last one turned down, found first: the search for people and companies opens.
        if (first && person.choices.length <= 1) onSearch?.()
        onDraft({ ...draft, person: turnDown(person), edited: true })
      }}
      onSearch={onSearch}
    />
  )
}

export function CallLayout({
  draft,
  onDraft,
  note,
  preview,
  options,
  today,
  onOpenCallLogs,
  onEdit,
  onLeaveBox,
  previewMs = 0,
  voice = null,
  onCompany = null,
  onCallType = null,
}: CallLayoutProps) {
  const { person } = draft
  // The follow-up nudge (PLAN-V25 T3-2, choice 14): "No" puts it away for this card.
  const [noNudge, setNoNudge] = useState(false)
  const nudgeDay = noNudge ? null : nudgeDayOf(draft, note)
  const companyPicked = draft.company.found !== null
  const fresh = preview?.items.find((one) => one.id === note?.id)
  // Saved before its company (PLAN-V24 T3-2): neither sorted nor sorting until it is picked.
  const needsCompany = note?.status === 'needs_company'
  const sorted = note !== undefined && note.status !== 'sorting' && !needsCompany
  // A person named with no company (PLAN-V25 T2-2): suggested with their company, or, found
  // nowhere or searched for, the search list finds people too (choice 11).
  const [peopleSearch, setPeopleSearch] = useState(false)
  const personFirst = isPersonFirst(draft) && !peopleSearch
  const nowhere = isPersonNowhere(draft)
  const people =
    !companyPicked && (nowhere || (peopleSearch && draft.company.heard.trim() === ''))
      ? {
          heard: person.heard,
          // The plan's words when the command found them nowhere; none once the rep searched.
          line: peopleSearch ? null : personNowhereWords(person.heard),
          onPick: (picked: Parameters<typeof pickPerson>[1]) => {
            onDraft(pickPerson(draft, picked, 'by_hand'))
          },
        }
      : null
  return (
    <div className="flex flex-col gap-4">
      {personFirst ? (
        <PersonSuggest
          draft={draft}
          onDraft={onDraft}
          onSearch={() => {
            setPeopleSearch(true)
          }}
        />
      ) : (
        <CompanyPart
          company={draft.company}
          previewMs={previewMs}
          voice={voice}
          savedCall={needsCompany}
          people={people}
          onCompany={
            onCompany ??
            ((next) => {
              onDraft({ ...draft, company: next, edited: true })
            })
          }
          onPick={(company, how) => {
            onDraft({ ...draft, company: pickCompany(draft.company, company, how), edited: true })
          }}
        />
      )}
      {companyPicked ? (
        isPending(person) && person.level ? (
          <PersonSuggest draft={draft} onDraft={onDraft} onSearch={null} />
        ) : isPending(person) ? (
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
      {companyPicked && onCallType ? (
        <CallTypePart
          value={draft.callType ?? DEFAULT_CALL_TYPE}
          types={callTypesOf(options)}
          onChange={onCallType}
        />
      ) : null}
      {draft.noteId !== null && (companyPicked || !needsCompany) ? (
        sorted ? (
          <>
            <CallBoxes
              note={note}
              fresh={fresh}
              options={options}
              today={today}
              onEdit={onEdit}
              onLeaveBox={onLeaveBox}
            />
            {nudgeDay ? (
              <FollowUpNudge
                day={nudgeDay}
                onAdd={() => {
                  const task = nudgeTask(draft, nudgeDay)
                  onEdit(
                    {
                      tasks: [
                        { subject: task.subject, due: task.due, due_words: '', kind: 'call' },
                      ],
                    },
                    (now) => ({ ...now, tasks: [...now.tasks, task] }),
                  )
                }}
                onNo={() => {
                  setNoNudge(true)
                }}
              />
            ) : null}
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
  onTurnDown,
}: {
  one: Recipient
  label: string
  onPick: (member: TeamMember) => void
  onRemove: () => void
  /** "Not this one" on a suggested teammate (PLAN-V25). */
  onTurnDown: () => void
}) {
  // Search: the team list, with a box to find the rest (as for someone with no HubSpot user).
  const [searching, setSearching] = useState(false)
  const box = label === FOR_WHOM ? 'for-whom' : 'to'
  if (one.found === null && one.level && (searching || one.level !== 'sure')) {
    const [first] = one.choices
    return (
      <li>
        {searching || !first ? (
          <TeammatePicker
            question={whichWords(one.heard, WHICH_TEAMMATE)}
            box={box}
            onPick={(member) => {
              setSearching(false)
              onPick(member)
            }}
          />
        ) : (
          <SuggestPart
            box={box}
            label={label}
            level={one.level === 'likely' ? 'likely' : 'unsure'}
            suggestion={first.name}
            question={whichWords(one.heard, WHICH_TEAMMATE)}
            choices={one.choices.map((member) => ({ id: member.owner_id, title: member.name }))}
            onPick={(id) => {
              const member = one.choices.find((choice) => choice.owner_id === id)
              if (member) onPick(member)
            }}
            onTurnDown={() => {
              if (one.choices.length <= 1) setSearching(true)
              onTurnDown()
            }}
            onSearch={() => {
              setSearching(true)
            }}
          />
        )}
      </li>
    )
  }
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
  /** An empty box shows as one still to fill (an empty card: once Send was tried). */
  checked?: boolean
  /** It can't be for you: no HubSpot user, so "For whom" asks for a teammate (PLAN-V23 T3-4). */
  needsTeammate?: boolean
  /** How long the company's add check waits after the last key (PLAN-V23 T1-6). */
  previewMs?: number
  /** The company said again (PLAN-V24 T3-2). */
  voice?: CompanyVoice | null
}

export function TaskLayout({
  draft,
  onDraft,
  preview,
  mic,
  today,
  checked = true,
  needsTeammate = false,
  previewMs = 0,
  voice = null,
}: TaskLayoutProps) {
  const due = dueOf(draft, today)
  const change = (part: Partial<TaskDraft>): void => {
    onDraft({ ...draft, ...part, edited: true })
  }
  const names = draft.company.found ? [draft.company.found.name] : []
  // A day or a subject not said (PLAN-V25 T3-2): a suggestion, asked about, never a blank box.
  const dueAsked = isDueSuggested(draft) ? draft.due : null
  const subjectBox = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  // "Type it": the subject's box shows, with its words selected to type over.
  const typeSubject = useRef(false)
  const asksSubject = draft.subjectSuggested === true
  useEffect(() => {
    if (!typeSubject.current || asksSubject) return
    typeSubject.current = false
    subjectBox.current?.focus()
    subjectBox.current?.select()
  }, [asksSubject])
  return (
    <div className="flex flex-col gap-4">
      <CompanyPart
        company={draft.company}
        previewMs={previewMs}
        voice={voice}
        onCompany={(company) => {
          change({ company })
        }}
        onPick={(company, how) => {
          change({ company: pickCompany(draft.company, company, how) })
        }}
      />
      {asksSubject && draft.subject.trim() !== '' ? (
        <SubjectAsk
          label={WHAT}
          subject={draft.subject}
          onUse={() => {
            change({ subjectSuggested: false })
          }}
          onType={() => {
            typeSubject.current = true
            change({ subjectSuggested: false })
          }}
        />
      ) : (
        <BoxField
          ref={subjectBox}
          label={WHAT}
          box="subject"
          value={draft.subject}
          max={SUBJECT_MAX.task}
          mic={mic}
          names={names}
          invalid={checked && draft.subject.trim() === ''}
          onChange={(subject) => {
            change({ subject })
          }}
        />
      )}
      <div className="flex flex-col gap-2">
        <BoxField
          label={WHEN}
          box="due"
          value={draft.when}
          max={60}
          mic={null}
          // Words that can't be read say so at once; an empty box, once checked.
          invalid={due.kind !== 'date' && (checked || due.kind !== 'empty')}
          hint={
            dueAsked !== null ? (
              // A day not said: the suggestion as a question (PLAN-V25 choice 13).
              <span data-slot="due-ask" className="text-ui text-foreground">
                {dueAskWords(dueAsked)}
              </span>
            ) : due.kind === 'date' ? (
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
        {dueAsked !== null ? (
          <DueChoices
            due={dueAsked}
            inAWeek={draft.dueChoices?.[1] ?? null}
            today={today}
            onPick={(date) => {
              onDraft(pickDue(draft, date))
            }}
          />
        ) : null}
      </div>
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
                  change({
                    forWhom: { ...draft.forWhom, found: member, choices: [], level: null },
                  })
              }}
              onRemove={() => {
                change({ forWhom: null })
              }}
              onTurnDown={() => {
                if (draft.forWhom) change({ forWhom: turnDown(draft.forWhom) })
              }}
            />
          </ul>
        </div>
      ) : needsTeammate ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">{FOR_WHOM}</span>
          <TeammatePicker
            question={GIVE_IT_TO_A_TEAMMATE}
            box="for-whom"
            onPick={(member) => {
              change({
                forWhom: recipientOf({
                  heard: member.name,
                  found: member,
                  choices: [],
                  address: null,
                  problem: null,
                }),
              })
            }}
          />
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
  /** An empty box shows as one still to fill (an empty card: once Send was tried). */
  checked?: boolean
}

export function EmailLayout({ draft, onDraft, preview, mic, checked = true }: EmailLayoutProps) {
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
                      each.id === one.id
                        ? { ...each, found: member, choices: [], level: null }
                        : each,
                    ),
                  })
                }}
                onRemove={() => {
                  change({ to: draft.to.filter((each) => each.id !== one.id) })
                }}
                onTurnDown={() => {
                  change({
                    to: draft.to.map((each) => (each.id === one.id ? turnDown(each) : each)),
                  })
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
        invalid={checked && draft.subject.trim() === ''}
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
        invalid={checked && draft.body.trim() === ''}
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
  /** How sure the command step is (PLAN-V25): likely suggests the first, with its reason. */
  level?: 'sure' | 'likely' | 'unsure' | null
  reason?: string | null
}

function meetingDetail(meeting: AssistantMeetingHit): string {
  return [meeting.company_name, formatDateTime(meeting.starts_at)].join(' · ')
}

export function PreReadLayout({
  meetings: all,
  company,
  onPick,
  onNew,
  level = null,
  reason = null,
}: PreReadLayoutProps) {
  // "Not this one" on a suggested meeting: the others show (PLAN-V25 T1-2).
  const [turnedDown, setTurnedDown] = useState(false)
  const meetings = turnedDown ? all.slice(1) : all
  if (level !== null && meetings.length > 0) {
    const [first] = meetings
    return (
      <SuggestPart
        box="company"
        label={MEETING}
        level={level === 'likely' && !turnedDown ? 'likely' : 'unsure'}
        suggestion={first ? `${first.title}, ${formatDateTime(first.starts_at)}` : undefined}
        reason={reason}
        question={WHICH_MEETING}
        choices={meetings.map((meeting, index) => ({
          id: String(index),
          title: meeting.title,
          detail: meetingDetail(meeting),
        }))}
        onPick={(index) => {
          const meeting = meetings[Number(index)]
          if (meeting) onPick(meeting)
        }}
        onTurnDown={() => {
          setTurnedDown(true)
        }}
      />
    )
  }
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
        detail: meetingDetail(meeting),
      }))}
      onPick={(index) => {
        const meeting = meetings[Number(index)]
        if (meeting) onPick(meeting)
      }}
    />
  )
}
