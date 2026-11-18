/**
 * The Assistant's command step (PLAN-V22 T1-1, the contract part 1): one thing a rep said or
 * typed, read into one action. It writes nothing and sends nothing: the review card does that
 * (T3-3). It loads with the voice bar, not in the first visit, so it isn't in `index.ts`.
 */
import { api, unwrap } from '../client'
import type { AssistantCommand, AssistantCommandIn } from '../types'

/** What the command would do, or the `ApiProblem` (409 `assistant_off`, 429, 503 and the rest). */
export async function readCommand(
  body: AssistantCommandIn,
  signal?: AbortSignal,
): Promise<AssistantCommand> {
  return unwrap(await api.POST('/companies/assistant/command', { body, signal }))
}
