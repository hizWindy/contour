/**
 * The card's teammate picker (PLAN-V23 T3-4, choice 15), for someone with no HubSpot user:
 *
 * - **A task** for yourself can't go to HubSpot, so its "For whom" asks for a teammate:
 *   "You don't have a HubSpot user, so this task can't go to HubSpot. Give it to a teammate."
 * - **A call's follow-up** needs a teammate in its "For" box before Send: "Who should do this
 *   follow-up? Pick a teammate." Once picked, the box says "For Sam Sample", with Change.
 *
 * The team list (`GET /companies/team`) shows as the card's choices ("Which James?"), at most six,
 * with a box to find the rest. Enter with a choice still to make comes here (`data-box`). The rules
 * are in `teammate-rules.ts`.
 */
import { useId, useState } from 'react'
import { toApiProblem } from '@/api/client'
import { useTeam } from '@/api/hooks/meetings'
import type { CallNoteTask, TeamMember } from '@/api/types'
import { forWhom } from '@/apps/companies/call-logs/words'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Box } from './draft'
import { ChoiceList, PartProblem } from './parts'
import { teammatesFor, WHO_DOES_IT } from './teammate-rules'

/** The most teammates shown at once: a box finds the rest. */
const MOST_SHOWN = 6

const FIND_TEAMMATE = 'Find a teammate'
const NO_TEAMMATE = 'No teammate by that name.'
const TEAM_LOADING = 'Loading the team.'
const TEAM_FAILED = "The team list couldn't be loaded."
const TRY_AGAIN = 'Try again'
const CHANGE = 'Change'

/** Why the team list didn't come: the server's words where it refused, else Try again. */
function TeamProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const problem = toApiProblem(error)
  // Refused (the team list is behind the Meetings tick): its words say who to ask.
  if (problem.status === 403) return <PartProblem>{problem.detail ?? TEAM_FAILED}</PartProblem>
  return (
    <div className="flex flex-col items-start gap-2">
      <PartProblem>{TEAM_FAILED}</PartProblem>
      <Button type="button" variant="outline" size="sm" className="touch:h-11" onClick={onRetry}>
        {TRY_AGAIN}
      </Button>
    </div>
  )
}

/** The question, the teammates as choices, and a box to find one who isn't shown. */
export function TeammatePicker({
  question,
  box,
  onPick,
}: {
  question: string
  box: Box
  onPick: (member: TeamMember) => void
}) {
  const team = useTeam()
  const [typed, setTyped] = useState('')
  const findId = useId()
  const everyone = team.data ?? []
  const shown = teammatesFor(everyone, typed, MOST_SHOWN)
  const others = everyone.filter((member) => !member.is_me)
  const pick = (id: string): void => {
    const member = others.find((one) => one.owner_id === id)
    if (member) onPick(member)
  }
  return (
    <div data-slot="teammate-picker" className="flex flex-col gap-2">
      <ChoiceList
        label={question}
        box={box}
        options={shown.map((member) => ({ id: member.owner_id, title: member.name }))}
        onPick={pick}
      />
      {team.isPending ? (
        <p role="status" className="text-caption text-muted-foreground">
          {TEAM_LOADING}
        </p>
      ) : team.isError ? (
        <TeamProblem
          error={team.error}
          onRetry={() => {
            void team.refetch()
          }}
        />
      ) : null}
      {others.length > MOST_SHOWN ? (
        <form
          noValidate
          onSubmit={(event) => {
            // Enter with one teammate left picks them.
            event.preventDefault()
            const [only, ...more] = shown
            if (only && more.length === 0) onPick(only)
          }}
        >
          <label htmlFor={findId} className="sr-only">
            {FIND_TEAMMATE}
          </label>
          <Input
            id={findId}
            value={typed}
            placeholder={FIND_TEAMMATE}
            autoComplete="off"
            className="touch:text-body"
            onChange={(event) => {
              setTyped(event.target.value)
            }}
          />
        </form>
      ) : null}
      {typed.trim() !== '' && shown.length === 0 ? (
        <p role="status" className="text-caption text-muted-foreground">
          {NO_TEAMMATE}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A follow-up's "For" box on the call card, for someone with no HubSpot user: the teammate it is
 * for, with Change, or the question and the team list. One already in HubSpot can't change.
 */
export function FollowUpFor({
  task,
  onPick,
}: {
  task: CallNoteTask
  onPick: (member: TeamMember) => void
}) {
  const [changing, setChanging] = useState(false)
  const owner = task.owner?.trim()
  if (task.in_hubspot) {
    return <p className="text-caption text-muted-foreground">{forWhom(task.owner)}</p>
  }
  if (owner && !changing) {
    return (
      <p
        data-slot="follow-up-for"
        className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground"
      >
        <span>{forWhom(owner)}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="touch:h-11"
          onClick={() => {
            setChanging(true)
          }}
        >
          {CHANGE}
          <span className="sr-only">{`: who does ${task.subject}`}</span>
        </Button>
      </p>
    )
  }
  return (
    <TeammatePicker
      question={WHO_DOES_IT}
      box="for-whom"
      onPick={(member) => {
        setChanging(false)
        onPick(member)
      }}
    />
  )
}
