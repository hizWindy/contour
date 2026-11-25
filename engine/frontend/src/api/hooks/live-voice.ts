/**
 * Live voice's requests (PLAN-V28). Not in `index.ts`: the start loads with the voice bar, and the
 * month's line with Admin's Settings, never in the first visit.
 *
 * - **A talk's start** (T1-2): `POST /companies/assistant/voice/session`, with the company on
 *   screen, so its names come first. It answers the socket's path, to open within 60 seconds, or
 *   a refusal in plain words (403, 409, 429 or 503), which the free mic takes over from.
 * - **The month** (T1-5, Platform admin): "Live voice this month: 42 minutes, about US$0.51 of
 *   US$4.00." A saved setting reads it again (`refreshAfterSettings`), so a new limit shows.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { queryKeys } from '../query'
import type { VoiceMonth, VoiceSessionOut } from '../types'

/** Starts a talk: its socket's path and its limits, or the `ApiProblem` that refused it. */
export async function startLiveVoice(
  companyKey: string | null,
  signal?: AbortSignal,
): Promise<VoiceSessionOut> {
  return unwrap(
    await api.POST('/companies/assistant/voice/session', {
      body: companyKey ? { company_key: companyKey } : {},
      signal,
    }),
  )
}

export function liveVoiceMonthQueryOptions() {
  return queryOptions<VoiceMonth>({
    queryKey: queryKeys.settings.liveVoiceMonth(),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/companies/assistant/voice/month', { signal })),
  })
}

/** This month's live voice, for the Platform admin's Settings. */
export function useLiveVoiceMonth(enabled = true) {
  return useQuery({ ...liveVoiceMonthQueryOptions(), enabled })
}
