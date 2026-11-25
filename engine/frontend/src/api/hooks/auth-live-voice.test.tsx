/**
 * Live voice after an in-app sign-in (PLAN-V28): the sign-in's answer says `live_voice`, as
 * who-am-I does, and it goes straight into the who-am-I cache, so the first V knows it at once.
 * Made-up names only; a fake server.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '@/api/query'
import { SAMPLE_USER, stubAuthBackend } from '@/test/fake-auth'
import { createTestQueryClient } from '@/test/render'
import { liveVoiceOf, useLogin, type SignIn } from './auth'

function signIn(liveVoice: boolean | undefined) {
  stubAuthBackend({
    me: Response.json({ auth_required: true, user: null, session: null }),
    login: Response.json({
      user: SAMPLE_USER,
      session: { id: 'session-1', current: true },
      ...(liveVoice === undefined ? {} : { live_voice: liveVoice }),
    }),
  })
  const client = createTestQueryClient()
  const { result } = renderHook(() => useLogin(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { client, result }
}

const BODY = { login: 'jsample', password: 'a long phrase of words', keep_signed_in: false }

describe('live voice right after signing in', () => {
  it('is known at once when the sign-in says it may start', async () => {
    const { client, result } = signIn(true)
    await act(async () => {
      await result.current.mutateAsync(BODY)
    })
    const me = client.getQueryData<SignIn>(queryKeys.auth.me())

    expect(me?.state).toBe('signed_in')
    expect(liveVoiceOf(me)).toBe(true)
  })

  it('stays off when it says no, or says nothing (an older backend)', async () => {
    for (const liveVoice of [false, undefined]) {
      const { client, result } = signIn(liveVoice)
      await act(async () => {
        await result.current.mutateAsync(BODY)
      })

      expect(liveVoiceOf(client.getQueryData<SignIn>(queryKeys.auth.me()))).toBe(false)
    }
  })
})
