/**
 * What a line of the sign-in log says on the Activity page (PLAN-V26 T3-3), in plain words. The
 * log keeps facts in `details`; only the ones named here are shown.
 */
import type { SignInItem } from '@/api/hooks/activity'

const EVENTS: Record<string, string> = {
  sign_in: 'Signed in',
  sign_in_failed: 'Wrong password',
  account_locked: 'Locked after too many wrong tries',
  sign_out: 'Signed out',
  sign_out_everywhere: 'Signed out everywhere',
  password_changed: 'Password changed',
  account_created: 'Account made',
  account_changed: 'Account changed',
}

const FIELDS: Record<string, string> = {
  username: 'username',
  position: 'position',
  role: 'role',
  features: 'access',
  active: 'can sign in',
  hubspot_owner: 'HubSpot user',
  name: 'name',
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** "Password changed", "Unlocked", "Changed: username, position". */
export function eventWords({ event, details }: SignInItem): string {
  if (event === 'account_changed') {
    if (details.unlocked === true) return 'Unlocked'
    const fields: unknown[] = Array.isArray(details.fields) ? details.fields : []
    const named = fields.flatMap((field) => {
      const word = typeof field === 'string' ? FIELDS[field] : undefined
      return word ? [word] : []
    })
    if (named.length > 0) return `Changed: ${named.join(', ')}`
  }
  return EVENTS[event] ?? event
}

/** The facts under it: the username's change, who did it, and from where. */
export function eventFacts({ ip, device, details }: SignInItem): string[] {
  const facts: string[] = []
  if ('username_to' in details) {
    const from = text(details.username_from) ?? 'none'
    const to = text(details.username_to) ?? 'none'
    facts.push(`Username ${from} to ${to}`)
  }
  if (details.signed_out === false) facts.push('Open browsers stayed signed in')
  const signedOut = text(details.signed_out_device)
  if (signedOut) facts.push(signedOut)

  const admin = text(details.admin_name)
  if (admin) {
    facts.push(`By ${admin}`)
    const from = [text(details.admin_device), text(details.admin_ip)].filter(Boolean).join(', ')
    if (from) facts.push(from)
  } else if (details.by === 'command') {
    facts.push('By a server command')
  }
  const own = [device, ip].filter(Boolean).join(', ')
  if (own) facts.push(own)
  return facts
}
