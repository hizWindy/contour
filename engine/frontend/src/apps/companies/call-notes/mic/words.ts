/**
 * The mic card's words (PLAN-V18 T3-4, T3-5 and "Words for when things go wrong", the mic): plain,
 * sentence case, no em dash, and no setting or file name (the screen-words test reads them). Each
 * problem says what happened, what still works, and the one thing to do. The wording is
 * Al-khair's to change. PLAN-V24 T1-4 changed the busy mic's words (TBC at his look).
 */
import { isMac, isWindows } from '@/lib/platform'

/** The mic button in the note box, for screen readers and its tooltip. */
export const SPEAK = 'Speak'
export const SPEAK_HINT = 'Speak the note'

// --- The card's title, as it moves through the call --------------------------------------------

export const CHECKING = 'Checking your mic'
export const SPEAK_NOW = 'Speak now'
export const WRITING = 'Writing it out'
export const DONE_TITLE = 'Done'
/** "Check my mic" passed (check only, from Ctrl+K or the profile menu). */
export const MIC_WORKS = 'Your mic works'
/** A check line failed before the mic was open. */
export const MIC_NOT_READY = "Your mic isn't ready"
/** The mic stopped while the rep spoke. */
export const MIC_STOPPED = 'The mic stopped'

/** "Check my mic", in Ctrl+K and the profile menu. */
export const CHECK_MY_MIC = 'Check my mic'

// --- The check: four lines that tick as their real results come in -----------------------------

export type CheckStep = 'found' | 'allowed' | 'hear' | 'ready'

/** Each line, while it waits, once it passed, and once it failed. */
export const STEP_WORDS: Readonly<
  Record<CheckStep, { waiting: string; pass: string; fail: string }>
> = {
  found: { waiting: 'Looking for a mic', pass: 'Mic found', fail: 'No mic found' },
  allowed: { waiting: 'Asking to use the mic', pass: 'Allowed', fail: 'Not allowed' },
  hear: { waiting: 'Say a few words', pass: 'We can hear you', fail: "We can't hear you" },
  ready: {
    waiting: 'Getting voice to text ready',
    pass: 'Voice to text ready',
    fail: "Voice to text isn't ready",
  },
}

// --- What can go wrong, with what to do ----------------------------------------------------------

export type MicProblem =
  | 'no_mic'
  | 'blocked_browser'
  | 'blocked_system'
  | 'busy'
  | 'silent'
  | 'old_browser'
  | 'insecure'
  | 'tool_failed'
  | 'too_slow'
  | 'cut_off'
  | 'not_set_up'
  | 'no_speech_tool'

/** A problem's buttons, in the order they show. The first is the main one. */
export type MicAction = 'try_again' | 'type_instead' | 'pick_mic' | 'carry_on'

export const ACTION_WORDS: Readonly<Record<MicAction, string>> = {
  try_again: 'Try again',
  type_instead: 'Type instead',
  pick_mic: 'Pick a mic',
  carry_on: 'Carry on',
}

const SYSTEM_BLOCKED_WINDOWS =
  'Windows has turned the mic off for your browser. In Windows Settings, open Privacy and security, then Microphone, and turn on access for apps. Then try again.'
const SYSTEM_BLOCKED_MAC =
  'Your Mac has turned the mic off for your browser. In System Settings, open Privacy and Security, then Microphone, and turn on your browser. Then try again.'
const SYSTEM_BLOCKED_OTHER =
  'This computer has turned the mic off for your browser. Allow the browser to use the mic in the computer settings, then try again.'

/** The sentence for "blocked by the computer", for the computer the rep is on. */
export function systemBlockedWords(windows = isWindows(), mac = isMac()): string {
  if (windows) return SYSTEM_BLOCKED_WINDOWS
  if (mac) return SYSTEM_BLOCKED_MAC
  return SYSTEM_BLOCKED_OTHER
}

/** Each problem's words and buttons, from the plan's table. "Type instead" needs a note box. */
export const PROBLEMS: Readonly<
  Record<Exclude<MicProblem, 'blocked_system'>, { words: string; actions: readonly MicAction[] }>
> = {
  no_mic: {
    words:
      "We can't find a mic. Plug one in or switch on your headset, then try again. You can type the note meanwhile.",
    actions: ['try_again', 'type_instead'],
  },
  blocked_browser: {
    words:
      'Your browser has blocked the mic for Contour HQ. Click the icon to the left of the web address, set Microphone to Allow, then try again.',
    actions: ['try_again'],
  },
  // Share the mic, never take it (PLAN-V24, decided in chat 4): mute there, never end the call.
  busy: {
    words:
      'Another app is holding your mic, like Teams or Zoom. Mute yourself there, then try again, or type instead.',
    actions: ['try_again', 'type_instead'],
  },
  silent: {
    words:
      'Your mic is on, but we hear nothing. Check its mute switch or its volume, or pick another mic.',
    actions: ['try_again', 'pick_mic'],
  },
  old_browser: {
    words: "This browser can't use the mic. Use Chrome or Edge, or type the note.",
    actions: ['type_instead'],
  },
  insecure: {
    words: "The mic only works on Contour HQ's usual web address.",
    actions: [],
  },
  tool_failed: {
    words:
      "The voice tool didn't load. Check your connection, then try again. You can type the note meanwhile.",
    actions: ['try_again', 'type_instead'],
  },
  too_slow: {
    words:
      'This computer is slow to turn speech into words right now. Close some tabs, or type the note.',
    actions: ['type_instead'],
  },
  cut_off: {
    words: 'The mic stopped. What you said so far is kept.',
    actions: ['carry_on'],
  },
  // Whisper in the browser waits for T3-3 (Al-khair at the keyboard), so with that tool picked the
  // check ends here, after the mic itself passed.
  not_set_up: {
    words:
      "Turning speech into words isn't set up here yet. Your mic works. Type the note for now.",
    actions: ['type_instead'],
  },
  no_speech_tool: {
    words: "This browser can't turn speech into words. Use Chrome or Edge, or type the note.",
    actions: ['type_instead'],
  },
}

/**
 * On Windows only, the busy mic's second line (PLAN-V24 T1-4): an app with exclusive use of the
 * mic keeps every other app out of it, even when muted.
 */
const BUSY_WINDOWS =
  "If it still won't open, turn off 'Allow applications to take exclusive control' for your mic in the Windows sound settings."

/** The busy mic's words: "Another app is holding your mic", and the Windows line on Windows. */
export function busyWords(windows = isWindows()): string {
  return windows ? `${PROBLEMS.busy.words} ${BUSY_WINDOWS}` : PROBLEMS.busy.words
}

/** A problem's sentence, for the computer the rep is on. */
export function problemWords(problem: MicProblem): string {
  if (problem === 'blocked_system') return systemBlockedWords()
  if (problem === 'busy') return busyWords()
  return PROBLEMS[problem].words
}

/** A problem's buttons. "Type instead" only where there is a note box to type in. */
export function problemActions(problem: MicProblem, noteBox: boolean): MicAction[] {
  const actions: readonly MicAction[] =
    problem === 'blocked_system' ? ['try_again'] : PROBLEMS[problem].actions
  return actions.filter((action) => noteBox || action !== 'type_instead')
}

// --- The card's other words ------------------------------------------------------------------------

export const DONE = 'Done'
export const CANCEL = 'Cancel'
export const TYPE_INSTEAD = ACTION_WORDS.type_instead
export const CHANGE_MIC = 'Change'
export const WHICH_MIC = 'Which mic'
export const YOUR_MIC = 'Your mic'
export const LISTENING = 'Listening'
/** While the words are on their way, before the first one. */
export const WORDS_SHOW_HERE = 'Your words show here as you speak.'
/** Check only: what the rep can do with a mic that works. */
export const CHECK_PASSED =
  'Press the mic beside a call note, then speak. The words go in the note for you to check.'

/** The timer's words for a screen reader: "Speaking for 0:42". */
export function speakingFor(clock: string): string {
  return `Speaking for ${clock}`
}

/**
 * A network blip (PLAN-V24 T1-3): the speech service is tried again quietly, and the card's title
 * says so once it has lasted a second. The words so far stay.
 */
export const RECONNECTING = 'Reconnecting'

/**
 * The mic moved by itself (PLAN-V24 T1-2, "The mic changed"): a headset plugged in, or the mic in
 * use gone. "Now using Headset Microphone (Jabra Evolve2 65)."
 */
export function nowUsing(mic: string): string {
  return `Now using ${mic}.`
}

/** "Changed Vitara to Vitera." A name the mic heard nearly right, fixed once. */
export function fixedWords(fixes: readonly { from: string; to: string }[]): string {
  return fixes.map((fix) => `Changed ${fix.from} to ${fix.to}.`).join(' ')
}
