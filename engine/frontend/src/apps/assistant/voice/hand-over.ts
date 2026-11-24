/**
 * Where the voice bar hands what it heard (PLAN-V22 T3-1 to T3-3). This is the one seam between the
 * bar and what a command does. The bar knows nothing of either: it calls `handOver` with the
 * command step's answer, and does what comes back.
 *
 * - `open` goes to its page, and the bar closes (no card: choice 24).
 * - `log_call`, `task` and `email` open the review card (`card/`), and the bar closes. Nothing is
 *   sent from here: the card does that, after the rep's check.
 * - A quick log (PLAN-V25 T3-3, `command.quick`) skips the card: the bar's `quickLog` saves the
 *   call and starts the hold, whose toast says what goes, with Undo (`card/quick.ts`).
 * - `pre_read`: its card is the pre-read's own page (choice 24). With the meeting found, the page
 *   opens, after the pre-read starts if it has none yet ("Working it out" stays on meanwhile).
 *   With two or more meetings, or none ahead, the card asks.
 * - `research` (PLAN-V27 T4-2, choice 18): a lead card from the last 30 days opens at once, and a
 *   HubSpot company that isn't quiet opens its call prep, each with its line in a toast. A new or
 *   quiet company, or a maybe, opens the research card, which asks once with the cost. With no
 *   name, the bar asks for one.
 * - `unknown` shows its read-back (what the Assistant can do), with Try again.
 * - `unclear` (PLAN-V23 T1-6) stops before any card: the words wait in the bar's text line, with
 *   the stop line ("We didn't catch that clearly...") and "Say it again".
 * - `change`, `send` and `cancel` only mean something on an open card, which reads them itself.
 * - With the AI that reads commands off (409 `assistant_off`), V works as dictation (choice 17):
 *   for a rep who can log calls, Log call opens with the words in a new call note, and the rep picks
 *   the company. Anyone else is told the Assistant can't read commands yet.
 */
import { api, toApiProblem, unwrap } from '@/api/client'
import type {
  AssistantCommand,
  AssistantMeetingHit,
  AssistantOpen,
  CommandSource,
} from '@/api/types'
import { toast } from 'sonner'
import { placeOf } from '../card/research-flow'
import { NO_NAME } from '../card/research-words'
import { openCard } from '../card/store'
import { CALL_LOGS_PATH, MEETINGS_PATH, TODAY_PATH } from '../paths'
import { isVoiceBarOpen } from './store'
import { CANT_READ_YET, unclearWords } from './words'

/**
 * The Lead Finder's first page in the menu ("Start a run"). Written here, not read from its module:
 * this file loads late, and reaching into the first visit's own files from here splits them into
 * files of their own, which makes the first visit bigger. A test checks it against the module.
 */
export const LEAD_FINDER_START = '/start'

/** What the bar heard, once the command step has answered. */
export type Heard =
  /** The command step read it into an action. */
  | { kind: 'command'; command: AssistantCommand; words: string; source: CommandSource }
  /** The AI that reads commands is off: the words are only words (dictation). */
  | { kind: 'dictation'; words: string; source: CommandSource }

/** What the bar does next. */
export type AfterAnswer =
  /** The answer went where it belongs (a page, or the review card): the bar closes. */
  | { kind: 'close' }
  /** The bar shows this line. `again`: it offers Try again (say it another way). */
  | { kind: 'show'; line: string; unsure: string | null; again: boolean }
  /** The words were too unclear (PLAN-V23 T1-6): they wait in the text line, under the line. */
  | { kind: 'unclear'; words: string; line: string }

/** The stop for words too unclear to make a command: the server's line, else the plan's. */
export function unclearAnswer(command: AssistantCommand, said: string): AfterAnswer {
  const words = command.read_back.trim() || said.trim()
  return { kind: 'unclear', words, line: command.unsure?.trim() || unclearWords(words) }
}

/** Starts a meeting's pre-read, as Meetings' "Draft it" does. Answers with its id. */
export type StartPreRead = (meetingId: string) => Promise<{ id: string }>

export interface HandOverTools {
  /** Opens a page of the app. */
  go: (to: string) => void
  /**
   * With the AI off: Log call opens with the words in a new call note (choice 17). False when the
   * rep can't log calls: then the bar says the Assistant can't read commands yet.
   */
  dictate?: (words: string, source: CommandSource) => boolean
  /** For tests: starts a pre-read. */
  start?: StartPreRead
  /**
   * A quick log (PLAN-V25 T3-3): a call that is only an outcome, sure of its company and person,
   * skips the card. True: it started. Left out, or false: the card opens, as before.
   */
  quickLog?: (heard: Extract<Heard, { kind: 'command' }>) => boolean
  /**
   * The rep may use call prep (PLAN-V27 T4-2): a HubSpot company's research opens its call prep,
   * else its page. Left out: they may.
   */
  canPrep?: () => boolean
  /** Says a line as a page opens (a toast). For tests. */
  tell?: (line: string) => void
}

/** The actions whose card is the review card. */
const CARD_ACTIONS: ReadonlySet<AssistantCommand['action']> = new Set(['log_call', 'task', 'email'])

const CLOSE: AfterAnswer = { kind: 'close' }

/** The address of a page the command step names. */
export function pageFor(open: AssistantOpen): string {
  switch (open.page) {
    case 'home':
      return '/'
    case 'today':
      return TODAY_PATH
    case 'meetings':
      return MEETINGS_PATH
    case 'call_logs':
      return CALL_LOGS_PATH
    case 'companies':
      return '/companies'
    case 'company':
      return open.company_key ? `/companies/${encodeURIComponent(open.company_key)}` : '/companies'
    case 'lead_finder':
      return LEAD_FINDER_START
  }
}

/** A pre-read's page (Meetings' `preReadHref`, written here for the same reason as above). */
export function preReadPath(formId: string): string {
  return `${MEETINGS_PATH}/${encodeURIComponent(formId)}`
}

/** POST /meetings/forms for a HubSpot meeting: the server reads its own place. */
export const startPreRead: StartPreRead = async (meetingId) =>
  unwrap(
    await api.POST('/companies/meetings/forms', {
      body: { meeting_id: meetingId, where: 'unknown' },
    }),
  )

/**
 * A meeting's pre-read opens: its page at once if it has one, else once it has started. A failed
 * start says why in the bar. If the rep closed the bar meanwhile, the page doesn't open.
 */
export function openMeeting(
  meeting: AssistantMeetingHit,
  go: (to: string) => void,
  start: StartPreRead = startPreRead,
): AfterAnswer | Promise<AfterAnswer> {
  if (meeting.form) {
    go(preReadPath(meeting.form.id))
    return CLOSE
  }
  const meetingId = meeting.id
  if (meetingId === null) {
    // A typed meeting always has its pre-read: nothing to start.
    go(MEETINGS_PATH)
    return CLOSE
  }
  return start(meetingId).then(
    (form): AfterAnswer => {
      if (isVoiceBarOpen()) go(preReadPath(form.id))
      return CLOSE
    },
    (error: unknown): AfterAnswer => {
      const problem = toApiProblem(error)
      return { kind: 'show', line: problem.title, unsure: problem.detail, again: false }
    },
  )
}

/** A research command (PLAN-V27 T4-2): a page, the research card, or a line asking for a name. */
function researchAnswer(
  heard: Extract<Heard, { kind: 'command' }>,
  go: (to: string) => void,
  canPrep: boolean,
  tell: (line: string) => void,
): AfterAnswer {
  const { command } = heard
  const research = command.research
  if (!research) {
    return { kind: 'show', line: command.read_back, unsure: command.unsure, again: true }
  }
  if (research.next === 'needs_name') {
    return { kind: 'show', line: command.read_back || NO_NAME, unsure: null, again: true }
  }
  const name = command.company?.found?.name ?? (command.company?.heard || research.company)
  const place = placeOf(research, name, canPrep)
  if (place) {
    go(place.to)
    // The server's line says it for a lead card and for call prep; without call prep, ours.
    tell(canPrep && command.read_back ? command.read_back : place.line)
    return CLOSE
  }
  openCard({ kind: 'command', command, words: heard.words, source: heard.source })
  return CLOSE
}

export function handOver(
  heard: Heard,
  {
    go,
    dictate = () => false,
    start = startPreRead,
    quickLog = () => false,
    canPrep = () => true,
    tell = (line) => {
      toast(line)
    },
  }: HandOverTools,
): AfterAnswer | Promise<AfterAnswer> {
  if (heard.kind === 'dictation') {
    // V still works as dictation: the words go in a new call note (choice 17).
    if (dictate(heard.words, heard.source)) return CLOSE
    return { kind: 'show', line: CANT_READ_YET, unsure: null, again: false }
  }
  const { command } = heard
  if (command.action === 'unclear') return unclearAnswer(command, heard.words)
  if (command.action === 'open' && command.open) {
    go(pageFor(command.open))
    return CLOSE
  }
  if (command.action === 'research') return researchAnswer(heard, go, canPrep(), tell)
  if (command.action === 'pre_read' && command.meeting?.found) {
    return openMeeting(command.meeting.found, go, start)
  }
  if (command.action === 'log_call' && command.quick === true && quickLog(heard)) return CLOSE
  if (CARD_ACTIONS.has(command.action) || command.action === 'pre_read') {
    openCard({ kind: 'command', command, words: heard.words, source: heard.source })
    return CLOSE
  }
  return {
    kind: 'show',
    line: command.read_back,
    unsure: command.unsure,
    again: command.action === 'unknown',
  }
}
