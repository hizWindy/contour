/** The call script as plain text, for "Copy script" (PLAN-V10 D4). */
import type { PrepFacts, PrepOut, PrepScript, ScriptLine } from '@/api/types'
import { formatDate } from '@/lib/format'

export const STILL_WORDS: Record<PrepScript['still_there'], string> = {
  yes: 'Still there',
  no: 'Has left',
  unknown: 'Not found',
  not_checked: 'Not checked',
}

/** The script as plain text, for "Copy script". */
export function scriptText(facts: PrepFacts | undefined, prep: PrepOut): string {
  const script = prep.script
  if (!script) return ''
  const who = prep.person
    ? `${prep.person.name}${prep.person.title ? `, ${prep.person.title}` : ''}, ${prep.company_name}`
    : `${prep.company_name} (cold call)`
  const list = (lines: ScriptLine[]): string => lines.map((line) => `- ${line.text}`).join('\n')
  const parts = [
    `Call prep: ${who}`,
    `Still there: ${STILL_WORDS[script.still_there]}.`,
    facts?.last_call?.called_at ? `Last call: ${formatDate(facts.last_call.called_at)}.` : null,
    script.news[0] ? `News: ${script.news[0].text}` : null,
    `1. Opener\n${list(script.opener)}`,
    `2. Why now\n${list(script.why_now)}`,
    `3. Questions to ask\n${list(script.questions)}`,
    `4. If they say\n${script.if_they_say
      .map((item) => `- "${item.they_say}": ${item.answer.text}`)
      .join('\n')}`,
    script.goal ? `5. Goal of the call\n- ${script.goal.text}` : null,
  ]
  return parts.filter(Boolean).join('\n\n')
}
