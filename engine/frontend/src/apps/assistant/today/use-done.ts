/**
 * Done on a task (PLAN-V22 choice 7; DESIGN.md "Act at once, undo after"): the row leaves at once
 * (it fades out in 150ms) and a toast says so, with Undo. HubSpot hears it at once
 * (`POST /tasks/{id}/done`). If HubSpot says no, the row comes back and a toast says why, in a
 * task's own words. Undo opens the task again (`POST /tasks/{id}/reopen`): the row comes back at
 * once, and if HubSpot says no, it leaves again and a toast says why.
 *
 * Each change is made on Today's own answer in the cache, so the Home card's counts follow it. A
 * read of Today on its way is stopped first, so it can't put back what was just changed, and
 * Today is read again once HubSpot has the change (the server shows it at once).
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toApiProblem } from '@/api/client'
import { reopenTask, tickTaskDone, todayKey } from '@/api/hooks/assistant'
import type { Today, TodayTask } from '@/api/types'
import { platformAdminAsker, usePlatformAdminName } from '@/auth/can'
import { changeDetail } from '@/lib/problems'
import {
  doneWords,
  noLinkWords,
  NOT_YOUR_TASK,
  OPEN_AGAIN,
  STILL_DONE,
  STILL_OPEN,
  TASK_GONE,
  TASK_WRITING_OFF,
  UNDO,
} from './words'

/** Takes the task off Today. Returns where it was, or -1 when it wasn't there. */
function take(client: QueryClient, task: TodayTask): number {
  void client.cancelQueries({ queryKey: todayKey() })
  const today = client.getQueryData<Today>(todayKey())
  const index = today ? today.tasks.findIndex((one) => one.id === task.id) : -1
  if (today && index !== -1) {
    client.setQueryData<Today>(todayKey(), {
      ...today,
      tasks: today.tasks.filter((one) => one.id !== task.id),
    })
  }
  return index
}

/** Puts the task back where it was, once. */
function putBack(client: QueryClient, task: TodayTask, index: number): void {
  void client.cancelQueries({ queryKey: todayKey() })
  const today = client.getQueryData<Today>(todayKey())
  if (!today || today.tasks.some((one) => one.id === task.id)) return
  const tasks = [...today.tasks]
  tasks.splice(Math.min(index, tasks.length), 0, task)
  client.setQueryData<Today>(todayKey(), { ...today, tasks })
}

function readAgain(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: todayKey() })
}

/** Why a task's change didn't go: a task's own words for its codes, else the server's. */
export function taskProblemWords(error: unknown, admin: string): string {
  const problem = toApiProblem(error)
  switch (problem.code) {
    case 'hubspot_writing_off':
      return TASK_WRITING_OFF
    case 'no_hubspot_link':
      return noLinkWords(admin)
    case 'not_your_task':
      return NOT_YOUR_TASK
    case 'task_not_found':
      return TASK_GONE
    default: {
      const detail = changeDetail(problem)
      return detail ? `${problem.title}. ${detail}` : problem.title
    }
  }
}

/** Done for a task: at once, with Undo. */
export function useTaskDone(): (task: TodayTask) => void {
  const client = useQueryClient()
  const admin = platformAdminAsker(usePlatformAdminName())
  return (task) => {
    const index = take(client, task)
    if (index === -1) return
    const done = tickTaskDone(task.id)
    let undone = false

    const undo = (): void => {
      if (undone) return
      undone = true
      putBack(client, task, index)
      done.then(
        () =>
          reopenTask(task.id).then(
            () => {
              toast(OPEN_AGAIN)
              readAgain(client)
            },
            (error: unknown) => {
              take(client, task)
              toast.error(STILL_DONE, { description: taskProblemWords(error, admin) })
            },
          ),
        // The Done never went, so the task is still open: nothing to undo in HubSpot.
        () => undefined,
      )
    }

    const shown = toast(doneWords(task.subject), { action: { label: UNDO, onClick: undo } })
    done.then(
      () => {
        readAgain(client)
      },
      (error: unknown) => {
        toast.dismiss(shown)
        if (undone) return
        if (toApiProblem(error).code === 'task_not_found') {
          // Gone from HubSpot: it stays off Today, and Today is read again.
          readAgain(client)
          toast(TASK_GONE)
          return
        }
        putBack(client, task, index)
        toast.error(STILL_OPEN, { description: taskProblemWords(error, admin) })
      },
    )
  }
}
