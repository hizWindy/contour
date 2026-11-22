/**
 * A short memory (PLAN-V25 T5-1, choice 21): the conversation's last turn, kept by the bar's
 * session until the conversation ends, and sent with the next command (`last_turn`). So "same
 * company", "her" and "and Jo too" work. The server uses the company and the person it found;
 * Claude gets only the names as heard. Nothing is kept after the bar closes.
 */
import type { AssistantCommand, AssistantLastTurn } from '@/api/types'

/** The longest name as heard the server takes (the contract: 120 characters). */
const HEARD_MAX = 120

const REMEMBERED = new Set<AssistantCommand['action']>(['pre_read', 'log_call', 'task', 'email'])

function heardOf(text: string | null | undefined): string {
  return (text ?? '').trim().slice(0, HEARD_MAX).trim()
}

/**
 * What a command leaves for the next turn: its company and person, found and as heard. Null when
 * it named neither, or wasn't one of the card's actions: then the turn before stays.
 */
export function lastTurnOf(command: AssistantCommand): AssistantLastTurn | null {
  if (!REMEMBERED.has(command.action)) return null
  const company = command.company?.found ?? null
  const person = command.person?.found ?? null
  if (!company && !person) return null
  return {
    action: command.action as NonNullable<AssistantLastTurn['action']>,
    company_key: company?.key ?? null,
    company_heard: heardOf(command.company?.heard),
    person_id: person?.id ?? null,
    person_heard: heardOf(command.person?.heard),
  }
}
