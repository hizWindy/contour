import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/api/client'
import { problemHint } from '@/lib/problems'
import { HISTORY_FAILED, STATUS_WORDS } from './call-logs/words'
import {
  busyWords,
  problemActions,
  problemWords,
  systemBlockedWords,
  type MicProblem,
} from './call-notes/mic/words'
import { NOTE_KEPT, NOT_SAVED } from './call-notes/words'
import { FACTS_FAILED, NO_PEOPLE, PREP_OFF } from './words'

/*
  "Words for when things go wrong" (PLAN-V18, T3-8): every row of the mic table and of the Call
  logs and call prep table, with its buttons, word for word. Each row is shown on its own screen
  by that screen's tests (`mic.test.tsx`, `history.test.tsx`, `quick-look.test.tsx`,
  `call-notes.test.tsx`, `call-logs.test.tsx`); this test proves none is missing or changed.
*/

describe('the mic table', () => {
  it.each<[string, MicProblem, string, string[]]>([
    [
      'No mic',
      'no_mic',
      "We can't find a mic. Plug one in or switch on your headset, then try again. You can type the note meanwhile.",
      ['Try again', 'Type instead'],
    ],
    [
      'Blocked by the browser',
      'blocked_browser',
      'Your browser has blocked the mic for Contour HQ. Click the icon to the left of the web address, set Microphone to Allow, then try again.',
      ['Try again'],
    ],
    // PLAN-V24 T1-4: share the mic, never take it.
    [
      'Another app has it',
      'busy',
      'Another app is holding your mic, like Teams or Zoom. Mute yourself there, then try again, or type instead.',
      ['Try again', 'Type instead'],
    ],
    [
      'Silent',
      'silent',
      'Your mic is on, but we hear nothing. Check its mute switch or its volume, or pick another mic.',
      ['Try again', 'Pick a mic'],
    ],
    [
      'An old browser',
      'old_browser',
      "This browser can't use the mic. Use Chrome or Edge, or type the note.",
      ['Type instead'],
    ],
    [
      'Not the secure site',
      'insecure',
      "The mic only works on Contour HQ's usual web address.",
      [],
    ],
    [
      "The voice tool didn't load",
      'tool_failed',
      "The voice tool didn't load. Check your connection, then try again. You can type the note meanwhile.",
      ['Try again', 'Type instead'],
    ],
    [
      'Too slow',
      'too_slow',
      'This computer is slow to turn speech into words right now. Close some tabs, or type the note.',
      ['Type instead'],
    ],
    ['Cut off', 'cut_off', 'The mic stopped. What you said so far is kept.', ['Carry on']],
  ])('%s', (_, problem, words, buttons) => {
    expect(problemWords(problem)).toBe(words)
    const actions = problemActions(problem, true).map(
      (action) =>
        ({
          try_again: 'Try again',
          type_instead: 'Type instead',
          pick_mic: 'Pick a mic',
          carry_on: 'Carry on',
        })[action],
    )
    expect(actions).toEqual(buttons)
  })

  it('Blocked by Windows, with Try again', () => {
    expect(systemBlockedWords(true, false)).toBe(
      'Windows has turned the mic off for your browser. In Windows Settings, open Privacy and security, then Microphone, and turn on access for apps. Then try again.',
    )
    expect(problemActions('blocked_system', true)).toEqual(['try_again'])
  })

  it('Another app has it, on Windows: adds the line about exclusive control, there only', () => {
    expect(busyWords(true)).toBe(
      "Another app is holding your mic, like Teams or Zoom. Mute yourself there, then try again, or type instead. If it still won't open, turn off 'Allow applications to take exclusive control' for your mic in the Windows sound settings.",
    )
    expect(busyWords(false)).toBe(
      'Another app is holding your mic, like Teams or Zoom. Mute yourself there, then try again, or type instead.',
    )
  })

  it('offers Type instead only where there is a note box', () => {
    expect(problemActions('no_mic', false)).toEqual(['try_again'])
    expect(problemActions('too_slow', false)).toEqual([])
    expect(problemActions('busy', false)).toEqual(['try_again'])
  })
})

describe('the Call logs and call prep table', () => {
  it('says each row as the plan does', () => {
    expect(HISTORY_FAILED).toBe(
      "Your call history couldn't be loaded. Check your connection, then try again.",
    )
    expect(NOT_SAVED).toBe('Not saved yet. Try again.')
    expect(NOTE_KEPT).toBe('Your note is kept for this call.')
    // Sending to HubSpot failed: the "Needs a look" words, as before.
    expect(STATUS_WORDS).toEqual({
      failed: 'Not in HubSpot. Nothing landed.',
      partial: 'Partly in HubSpot. Some steps landed.',
      uncertain: 'Not sure it reached HubSpot.',
    })
    expect(NO_PEOPLE).toBe(
      'No people on record in HubSpot for this company. The script asks the switchboard for whoever looks after the office.',
    )
    expect(FACTS_FAILED).toBe(
      "The facts couldn't be read from our HubSpot copy. Try again in a moment.",
    )
    // Call prep is off: the plan's two sentences, then the one thing to do.
    expect(PREP_OFF).toMatch(
      /^Call scripts are switched off\. The facts from HubSpot still show\. /,
    )
  })

  // The server's detail, word for word (`note_store.py`), then the hint, as a toast or the error
  // box says them: the hint adds only what the detail doesn't say.
  it.each([
    [
      'call_notes_off',
      'Call notes are switched off. An admin can switch them on in Settings.',
      'Call notes are switched off. An admin can switch them on in Settings. Until then, log your calls in HubSpot as before.',
    ],
    [
      'hubspot_writes_off',
      'Waiting for HubSpot write access.',
      'Waiting for HubSpot write access. Your calls wait here until HubSpot can be written to. You can still check and change them.',
    ],
  ])("adds to %s's words the one thing they don't say", (code, detail, words) => {
    const problem = new ApiProblem({ title: 'A problem', status: 409, detail, code })
    expect([problem.detail, problemHint(problem)].join(' ')).toBe(words)
  })

  // Track 1's details end with the next step (PLAN-V18 T1-8): a hint would say it twice.
  it.each([
    'already_sending',
    'note_too_long',
    'note_empty',
    'note_sorting',
    'note_sent',
    'part_sent',
    'note_not_found',
    'not_your_note',
    'nothing_to_retry',
    'change_twice',
    'called_later',
    'task_in_past',
    'person_not_at_company',
    'prep_off',
  ])("adds no hint to %s: the server's words end with what to do", (code) => {
    expect(problemHint(new ApiProblem({ title: 'A problem', status: 409, code }))).toBeNull()
  })
})
