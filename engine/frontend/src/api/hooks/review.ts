/**
 * The review page (PLAN-V9 C3), the reject reasons (D1) and the People tab (E1).
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import type { Schemas } from '../types'
import { refreshLeads } from './leads'

export type Review = Schemas['ReviewOut']
export type ReviewResult = Schemas['ReviewResult']
export type ReviewStatusBody = Schemas['ReviewStatusBody']
export type RejectReasonCounts = Schemas['RejectReasonCounts']
export type Person = Schemas['PersonOut']
export type PersonIn = Schemas['PersonIn']
export type PersonPatch = Schemas['PersonPatch']

const KEYS = {
  review: (runId: string) => ['review', runId] as const,
  rejectReasons: (days: number) => ['leads', 'reject-reasons', days] as const,
  people: ['people'] as const,
}

/** The review bar for one run: its numbers, and whether HubSpot writing is on. */
export function reviewQueryOptions(runId: string) {
  return queryOptions({
    queryKey: KEYS.review(runId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/review/{run_id}', {
          params: { path: { run_id: runId } },
          signal,
        }),
      ),
  })
}

export function useReview(runId: string | null) {
  return useQuery({ ...reviewQueryOptions(runId ?? ''), enabled: runId !== null })
}

/** Watch or reject the ticked leads. Each lead gets its own line in the answer. */
export function useReviewStatus() {
  const queryClient = useQueryClient()
  return useMutation<ReviewResult, ApiProblem, ReviewStatusBody>({
    mutationFn: async (body) => unwrap(await api.POST('/lead-finder/review/status', { body })),
    onSuccess: () => {
      refreshLeads(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['leads', 'detail'] })
      void queryClient.invalidateQueries({ queryKey: ['leads', 'reject-reasons'] })
    },
  })
}

/** Approve the ticked leads and send them to HubSpot. Each lead gets its own line. */
export function useReviewSend() {
  const queryClient = useQueryClient()
  return useMutation<ReviewResult, ApiProblem, string[]>({
    mutationFn: async (leadIds) =>
      unwrap(await api.POST('/lead-finder/review/send', { body: { lead_ids: leadIds } })),
    onSuccess: () => {
      refreshLeads(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['leads', 'detail'] })
    },
  })
}

/** How many leads were rejected for each reason over the last `days` days. */
export function useRejectReasons(days = 90) {
  return useQuery({
    queryKey: KEYS.rejectReasons(days),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/lead-finder/leads/reject-reasons', { params: { query: { days } }, signal }),
      ),
  })
}

/** Everyone with an account (Admins only). */
export function usePeople() {
  return useQuery({
    queryKey: KEYS.people,
    queryFn: async ({ signal }) => unwrap(await api.GET('/people', { signal })),
  })
}

export function useAddPerson() {
  const queryClient = useQueryClient()
  return useMutation<Person, ApiProblem, PersonIn>({
    mutationFn: async (body) => unwrap(await api.POST('/people', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.people })
    },
  })
}

export function useChangePerson() {
  const queryClient = useQueryClient()
  return useMutation<Person, ApiProblem, { userId: string; patch: PersonPatch }>({
    mutationFn: async ({ userId, patch }) =>
      unwrap(
        await api.PATCH('/people/{user_id}', {
          params: { path: { user_id: userId } },
          body: patch,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.people })
      void queryClient.invalidateQueries({ queryKey: ['auth'] })
    },
  })
}
