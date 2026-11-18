/**
 * Today's Sync (PLAN-V22 choice 7): read the HubSpot tasks again now. It looks and words as
 * Meetings' Sync does (`meetings/sync.tsx`): the icon turns once a press, the button says
 * "Checking HubSpot", then "Up to date" for 4 seconds. The line under the header says when the
 * tasks were read ("Checked 8:12 am", from `checked_at`), or why a press didn't go.
 *
 * The server asks HubSpot at most once a minute a person: a press inside the minute gets the copy
 * it has, which is up to date.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { readTodayAgain } from '@/api/hooks/assistant'
import type { Today } from '@/api/types'
import { UP_TO_DATE_MS, type MeetingsSync } from '@/apps/companies/meetings/use-sync'
import { checkedWords, syncNotSentWords } from '@/apps/companies/meetings/words'

export function useTodaySync(today: Today | undefined, day: string): MeetingsSync {
  const client = useQueryClient()
  const [turns, setTurns] = useState(0)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const read = useMutation({ mutationFn: () => readTodayAgain(client) })

  useEffect(() => {
    if (!done) return undefined
    const timer = setTimeout(() => {
      setDone(false)
    }, UP_TO_DATE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [done])

  const press = (): void => {
    setTurns((count) => count + 1)
    setDone(false)
    setFailed(null)
    read.mutate(undefined, {
      onSuccess: () => {
        setDone(true)
      },
      onError: (error) => {
        setFailed(syncNotSentWords(error))
      },
    })
  }

  // The time shows only for tasks that were read: when they can't be, the part says why.
  const checked = today?.tasks_state === 'ok' ? today.checked_at : null
  return {
    look: read.isPending ? 'checking' : done ? 'done' : 'idle',
    turns,
    line: failed
      ? { words: failed, problem: true }
      : checked
        ? { words: checkedWords(checked, day), problem: false }
        : null,
    disabled: false,
    press,
  }
}
