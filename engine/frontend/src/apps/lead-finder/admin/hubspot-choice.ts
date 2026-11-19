/**
 * The rules behind each person's "HubSpot user" on Admin's People tab (PLAN-V23 T3-4, choices 12
 * and 13), in plain code with no screen, so each can be tested on its own: the choice, where a
 * person's work lands, and the closest name to suggest. The screen is `hubspot-user.tsx`.
 */
import type { Person } from '@/api/hooks'
import { ownerOf } from '@/api/hooks/hubspot-owners'
import type { HubSpotOwnerOption } from '@/api/types'

// --- The choice -----------------------------------------------------------------------------------

/** A HubSpot user, or "No HubSpot user". Null where it is used: nothing picked yet. */
export type HubSpotChoice = { kind: 'user'; owner: HubSpotOwnerOption } | { kind: 'none' }

/** Where a person's work lands: their mark, or what their link says on an older server. */
export function hubSpotStateOf(person: Person): 'linked' | 'none' | 'not_set' {
  if (person.hubspot) return person.hubspot
  return ownerOf(person) ? 'linked' : 'not_set'
}

/** A person's choice as it is saved, or null for "Not set". */
export function choiceOf(person: Person): HubSpotChoice | null {
  const owner = ownerOf(person)
  if (owner) return { kind: 'user', owner: { id: owner.id, name: owner.name } }
  return hubSpotStateOf(person) === 'none' ? { kind: 'none' } : null
}

export function sameChoice(a: HubSpotChoice | null, b: HubSpotChoice | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind
  return a.owner.id === b.owner.id
}

/** Who is linked to which HubSpot user: the user's id and the person's name. */
export function takenUsers(people: readonly Person[]): ReadonlyMap<string, string> {
  const taken = new Map<string, string>()
  for (const person of people) {
    const owner = ownerOf(person)
    if (owner) taken.set(owner.id, person.name)
  }
  return taken
}

// --- The closest name -----------------------------------------------------------------------------

/** A name's words: lower case, no accents, "Al-khair" and "O'Brien" kept whole. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’-]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function letterPairs(text: string): string[] {
  const pairs: string[] = []
  for (let index = 0; index < text.length - 1; index += 1) pairs.push(text.slice(index, index + 2))
  return pairs
}

/** How alike two names are, from 0 to 1: the letter pairs they share (Dice's measure). */
export function nameLikeness(a: string, b: string): number {
  const left = letterPairs(a)
  const right = letterPairs(b)
  if (left.length === 0 || right.length === 0) return a !== '' && a === b ? 1 : 0
  const pool = new Map<string, number>()
  for (const pair of right) pool.set(pair, (pool.get(pair) ?? 0) + 1)
  let shared = 0
  for (const pair of left) {
    const count = pool.get(pair) ?? 0
    if (count > 0) {
      shared += 1
      pool.set(pair, count - 1)
    }
  }
  return (2 * shared) / (left.length + right.length)
}

/** The first names agree: the same, or one starts the other (Jo, Joanne), 2 letters or more. */
function sameFirstName(a: string, b: string): boolean {
  return a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))
}

/** Half the letter pairs in common, or more (TBC at Al-khair's look). */
export const CLOSE_ENOUGH = 0.5

/**
 * The HubSpot user whose name is closest to the person's, or null when none is close enough:
 * the first names must agree, then the most letter pairs in common wins. Users in `skip` (linked
 * to someone else already) are never suggested.
 */
export function closestOwner(
  name: string,
  owners: readonly HubSpotOwnerOption[],
  skip: ReadonlySet<string> = new Set(),
): HubSpotOwnerOption | null {
  const typed = nameWords(name)
  const first = typed[0]
  if (first === undefined) return null
  const whole = typed.join(' ')
  let best: HubSpotOwnerOption | null = null
  let bestScore = 0
  for (const owner of owners) {
    if (skip.has(owner.id)) continue
    const theirs = nameWords(owner.name)
    if (theirs[0] === undefined || !sameFirstName(first, theirs[0])) continue
    const score = nameLikeness(whole, theirs.join(' '))
    if (score > bestScore) {
      best = owner
      bestScore = score
    }
  }
  return bestScore >= CLOSE_ENOUGH ? best : null
}
