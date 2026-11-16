/**
 * One of the rep's two blanks on the pre-read, "Ideal next step" and "Who is going" (PLAN-V17
 * "The screens", part 6): the text as the rep sees it, and its save to the server.
 *
 * - **It saves when it is left** (a PATCH with `next_step` or `going`), and only if it changed, so
 *   leaving a sent pre-read untouched never makes it a draft again (the server does that on a
 *   change). After a save the field shows what the server keeps, unless the rep has typed on.
 * - **A failed save keeps the text** and says why, with Try again. One that fails after the rep
 *   has left the page says so in a toast, as Log meeting does.
 * - The blanks are the rep's own while the page is open: a new answer from the server (the page
 *   asks every 2 seconds while the summaries are written) doesn't touch them.
 *
 * The page lifts both blanks above the form (PLAN-V18 T2-5), so the footer's "Check and send"
 * knows when both are filled, and the footer's status says when the form was last saved.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useEditMeetingForm } from '@/api/hooks/meetings'
import type { MeetingFormOut, MeetingFormPatch } from '@/api/types'
import { BLANK_MAX_CHARS } from './rules'
import { leftNotSavedWords, notSavedWords } from './words'

export type BlankName = 'next_step' | 'going'
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export interface Blank {
  name: BlankName
  text: string
  change: (text: string) => void
  state: SaveState
  /** Why the last save didn't go, in plain words. */
  problem: string | null
  tooLong: boolean
  /** The field was left: save it if it changed. */
  commit: () => void
  /** Save it again after a failure. */
  retry: () => void
}

/**
 * One blank. `label` names it in the toast of a save that fails once the rep has left the page.
 * `onSaved` hears each save the server keeps.
 */
export function useBlank(
  form: MeetingFormOut,
  name: BlankName,
  label: string,
  onSaved?: () => void,
): Blank {
  const edit = useEditMeetingForm(form.id)
  const [text, setText] = useState(form[name] ?? '')
  // What the server holds, as far as the page knows: a field the same as it has nothing to save.
  const [saved, setSaved] = useState(form[name] ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const tooLong = text.trim().length > BLANK_MAX_CHARS
  // Only the newest save's answer counts, as one left on its way may answer after it.
  const newest = useRef(0)
  // Still on screen: a save that fails after the rep left the page says so in a toast instead.
  const shownNow = useRef(true)
  useEffect(() => {
    shownNow.current = true
    return () => {
      shownNow.current = false
    }
  }, [])

  const save = (value: string): void => {
    const next = value.trim()
    if (next.length > BLANK_MAX_CHARS) return
    setState('saving')
    setProblem(null)
    const patch: MeetingFormPatch = {}
    patch[name] = next
    newest.current += 1
    const mine = newest.current
    // Its promise answers even once the page is gone, which a callback given to `mutate` doesn't.
    void edit.mutateAsync({ patch }).then(
      (answer) => {
        if (mine !== newest.current) return
        const kept = answer[name] ?? ''
        setSaved(kept)
        // Show what the server keeps (it tidies spaces), unless the rep has typed on since.
        setText((now) => (now === value ? kept : now))
        setState('saved')
        onSaved?.()
      },
      (error: unknown) => {
        if (mine !== newest.current) return
        if (!shownNow.current) {
          const words = leftNotSavedWords(label, form.meeting.company_name, error)
          toast.error(words.title, { description: words.description })
          return
        }
        setState('failed')
        setProblem(notSavedWords(error))
      },
    )
  }

  return {
    name,
    text,
    change: (next) => {
      setText(next)
      if (state === 'saved') setState('idle')
    },
    state,
    problem,
    tooLong,
    commit: () => {
      if (text.trim() === saved.trim()) {
        // Back to what the server has: nothing is waiting to be saved.
        if (state === 'failed') {
          setState('idle')
          setProblem(null)
        }
        return
      }
      save(text)
    },
    retry: () => {
      save(text)
    },
  }
}
