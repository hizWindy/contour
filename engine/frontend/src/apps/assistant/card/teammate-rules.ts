/**
 * A teammate for work that can't be yours (PLAN-V23 T3-4, choice 15). Someone with no HubSpot user
 * has no HubSpot tasks, so a task they add, or a follow-up of a call they log, needs a teammate in
 * its "For" box before Send. The server refuses it otherwise (409 `no_hubspot_user`) and writes
 * nothing. The words are the plan's ("Words for when things go wrong"), word for word.
 *
 * A change to the follow-ups sends the whole list, so each one's teammate goes back as it came: the
 * id the server sends with the name (`CallNoteTask.owner_id`), so two people with one name stay
 * apart. An answer without the id (older test data) falls back to that name in the team list.
 */
import { isApiProblem } from '@/api/client'
import type { CallNoteTask, TeamMember } from '@/api/types'

/** A task for yourself, with no HubSpot user. */
export const GIVE_IT_TO_A_TEAMMATE =
  "You don't have a HubSpot user, so this task can't go to HubSpot. Give it to a teammate."
/** A follow-up with no one to do it. */
export const WHO_DOES_IT = 'Who should do this follow-up? Pick a teammate.'

/** The server's refusal of a task or a follow-up with nobody to do it. */
export function isNoHubSpotUser(error: unknown): boolean {
  return isApiProblem(error) && error.code === 'no_hubspot_user'
}

/** A follow-up not in HubSpot yet with nobody in its "For" box. */
export function lacksTeammate(task: Pick<CallNoteTask, 'owner' | 'in_hubspot'>): boolean {
  return !task.in_hubspot && !task.owner?.trim()
}

/** Any follow-up still waiting for a teammate holds Send up. */
export function needsTeammate(tasks: readonly CallNoteTask[]): boolean {
  return tasks.some(lacksTeammate)
}

/** The teammate a follow-up is for, as the server takes it: its id, or the id of its name. */
export function ownerIdOf(
  task: Pick<CallNoteTask, 'owner' | 'owner_id'>,
  team: readonly TeamMember[] | undefined,
): string | null {
  if (task.owner_id !== undefined) return task.owner_id
  const name = task.owner?.trim()
  if (!name || !team) return null
  return team.find((member) => member.name.trim() === name)?.owner_id ?? null
}

/** Each typed word starts a word of the name, in the order typed: "sam s" is Sam Sample. */
function nameFits(name: string, asked: readonly string[]): boolean {
  const words = name.toLowerCase().split(/\s+/)
  let from = 0
  for (const one of asked) {
    const at = words.findIndex((word, index) => index >= from && word.startsWith(one))
    if (at === -1) return false
    from = at + 1
  }
  return true
}

/**
 * The teammates to offer: everyone on the team list but you, the ones whose name fits what was
 * typed, at most `most`, in the list's order (by name).
 */
export function teammatesFor(
  team: readonly TeamMember[],
  typed: string,
  most: number,
): TeamMember[] {
  const asked = typed.toLowerCase().split(/\s+/).filter(Boolean)
  return team.filter((member) => !member.is_me && nameFits(member.name, asked)).slice(0, most)
}
