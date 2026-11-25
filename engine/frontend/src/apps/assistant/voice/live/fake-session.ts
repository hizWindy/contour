/**
 * A voice bar session with live voice, for the tests (PLAN-V28 Part 3 and T4-1): a fake talk, a
 * fake command step answered when the test says, the fake mic, and a card's ear as the test says.
 * Only tests import it; the app never does. Made-up names only: Sample Logistics, Jo Sample.
 *
 *   const set = await live()                      // the bar opens, and Google is ready
 *   set.talk.call('call-1', 'Log a call', 'Log a call with Jo')
 *   set.readings[0]?.answer(callCommand())        // the command step answers
 *   const card = ear(set, (words) => null)        // a card opens, and hears the talk first
 */
import { vi } from 'vitest'
import type { AssistantCommand, AssistantCommandIn } from '@/api/types'
import {
  CHROME_LAPTOP,
  FakeMic,
  type FakeMicOptions,
} from '@/apps/companies/call-notes/mic/fake-mic'
import {
  BarSession,
  type BarSessionOptions,
  type BarSnapshot,
  type CardEar,
  type CardShown,
  type CardTook,
} from '../bar-session'
import type { AfterAnswer, Heard } from '../hand-over'
import type { ScreenEnv } from '../screen'
import { FakeTalks } from './fake-talk'

export const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
export const CALL_SAID = 'Log a call with Jo Sample, no answer'

/** A laptop whose browser can run live voice. */
export const LIVE_LAPTOP: FakeMicOptions = { browser: { ...CHROME_LAPTOP, live: true } }

const SCREEN: ScreenEnv = {
  keepOn: () => Promise.resolve(null),
  hidden: () => false,
  onVisibility: () => () => undefined,
  phone: () => false,
}

/** One reading of the command step, answered when the test says. */
export interface Reading {
  body: AssistantCommandIn
  signal: AbortSignal
  answer: (command: AssistantCommand) => void
  refuse: (error: unknown) => void
}

export interface SetUp {
  /** Live voice may start for this person. Default: yes. */
  liveOn?: boolean
  mic?: FakeMicOptions
  /** Where an answer goes. Default: a review action opens its card, which hears the talk. */
  hand?: BarSessionOptions['hand']
}

export function setUp({ liveOn = true, mic: micOptions = LIVE_LAPTOP, hand }: SetUp = {}) {
  const mic = new FakeMic(micOptions)
  const talks = new FakeTalks()
  const readings: Reading[] = []
  const handed: Heard[] = []
  const world = { shown: null as CardShown }
  const onClose = vi.fn<() => void>()
  const session = new BarSession({
    env: mic.env(),
    makeTool: mic.tool,
    onPage: { company_key: '201' },
    read: (body, signal) =>
      new Promise<AssistantCommand>((answer, refuse) => {
        readings.push({ body, signal, answer, refuse })
      }),
    hand: (heard, said) => {
      handed.push(heard)
      if (hand) return hand(heard, said)
      if (heard.kind !== 'command') return { kind: 'close' }
      const { command: said_ } = heard
      if (['log_call', 'task', 'email'].includes(said_.action)) {
        world.shown = 'hears'
        return { kind: 'close' }
      }
      return { kind: 'show', line: said_.read_back, unsure: said_.unsure, again: false }
    },
    cardOpen: () => world.shown,
    onClose,
    screen: SCREEN,
    live: { on: () => liveOn, talk: talks.make },
  })
  const now = (): BarSnapshot => session.getSnapshot()
  return { mic, talks, readings, handed, world, session, onClose, now }
}

export async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Opens the bar with live voice, and Google is ready. */
export async function live(options: SetUp = {}) {
  const set = setUp(options)
  set.session.start('browser_service')
  set.talks.last().ready()
  await tick()
  return { ...set, talk: set.talks.last() }
}

/** A card open in the talk: it reads each turn first, as the test says. */
export function ear(
  set: { session: BarSession; world: { shown: CardShown } },
  take: (words: string) => CardTook | null = () => null,
  options: { every?: boolean; answer?: (heard: Heard) => AfterAnswer } = {},
) {
  const took: string[] = []
  const answered: Heard[] = []
  set.world.shown = 'hears'
  const card: CardEar = {
    take: (words) => {
      took.push(words)
      return take(words)
    },
    card: () => ({ action: 'task', boxes: ['subject', 'due'] }),
    answer: (heard) => {
      answered.push(heard)
      return options.answer ? options.answer(heard) : { kind: 'close' }
    },
    ...(options.every ? { every: true } : {}),
  }
  const release = set.session.attachCard(card)
  return { took, answered, release }
}
