import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap, type ApiProblem } from '../client'
import { queryKeys } from '../query'
import type { SettingsOut, SettingValue } from '../types'

/** The editable settings with their limits, and what is left of today's cost limit. */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: async ({ signal }) => unwrap(await api.GET('/settings', { signal })),
  })
}

/** A change to settings alters the caps the Start page shows, so those are refreshed too. */
function refreshAfterSettings(queryClient: QueryClient, settings: SettingsOut): void {
  queryClient.setQueryData(queryKeys.settings.all, settings)
  void queryClient.invalidateQueries({ queryKey: queryKeys.runOptions.all })
  void queryClient.invalidateQueries({ queryKey: ['runs', 'estimate'] })
}

/** Saves some settings (`PATCH /settings`). Wrong values come back as field errors `values.<key>`. */
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation<SettingsOut, ApiProblem, Record<string, SettingValue>>({
    mutationFn: async (values) => unwrap(await api.PATCH('/settings', { body: { values } })),
    onSuccess: (settings) => {
      refreshAfterSettings(queryClient, settings)
    },
  })
}

/** Puts one setting back to its default. */
export function useResetSetting() {
  const queryClient = useQueryClient()
  return useMutation<SettingsOut, ApiProblem, string>({
    mutationFn: async (key) =>
      unwrap(await api.DELETE('/settings/{key}', { params: { path: { key } } })),
    onSuccess: (settings) => {
      refreshAfterSettings(queryClient, settings)
    },
  })
}
