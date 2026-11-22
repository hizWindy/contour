/**
 * One person's Activity page in Admin (PLAN-V26 Part 3). Not in `hooks/index.ts`: that file is in
 * the first visit, and only this page uses these, so they load with it.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import type { Schemas } from '../types'

export type SignInItem = Schemas['SignInItem']
export type DeviceItem = Schemas['DeviceItem']
export type ActivityItem = Schemas['ActivityItem']
export type ActivityList = 'calls' | 'preps' | 'sent'
type SignedOut = Schemas['SignedOutOut']

const keys = {
  person: (userId: string) => ['people', 'activity', userId] as const,
  tab: (userId: string, tab: string, offset: number) =>
    ['people', 'activity', userId, tab, offset] as const,
}

function where(userId: string, offset: number) {
  return { params: { path: { user_id: userId }, query: { offset } } }
}

export function useSignIns(userId: string, offset: number) {
  return useQuery({
    queryKey: keys.tab(userId, 'sign-ins', offset),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/people/{user_id}/activity/sign-ins', { ...where(userId, offset), signal }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useDevices(userId: string, offset: number) {
  return useQuery({
    queryKey: keys.tab(userId, 'devices', offset),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/people/{user_id}/activity/devices', { ...where(userId, offset), signal }),
      ),
    placeholderData: keepPreviousData,
  })
}

const LISTS = {
  calls: '/people/{user_id}/activity/calls',
  preps: '/people/{user_id}/activity/preps',
  sent: '/people/{user_id}/activity/sent',
} as const

export function useActivityList(userId: string, list: ActivityList, offset: number) {
  return useQuery({
    queryKey: keys.tab(userId, list, offset),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET(LISTS[list], { ...where(userId, offset), signal })),
  })
}

export function useSpending(userId: string, offset: number) {
  return useQuery({
    queryKey: keys.tab(userId, 'spending', offset),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/people/{user_id}/activity/spending', { ...where(userId, offset), signal }),
      ),
    placeholderData: keepPreviousData,
  })
}

/** Ends one browser's session, or all of them when `sessionId` is null. */
export function useSignPersonOut(userId: string) {
  const queryClient = useQueryClient()
  return useMutation<SignedOut, ApiProblem, string | null>({
    mutationFn: async (sessionId) =>
      sessionId === null
        ? unwrap(
            await api.POST('/people/{user_id}/sign-out', { params: { path: { user_id: userId } } }),
          )
        : unwrap(
            await api.POST('/people/{user_id}/devices/{session_id}/sign-out', {
              params: { path: { user_id: userId, session_id: sessionId } },
            }),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.person(userId) })
      void queryClient.invalidateQueries({ queryKey: ['auth'] }) // it may be this browser
    },
  })
}
