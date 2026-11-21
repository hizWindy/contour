/**
 * Listening you can see (PLAN-V24 T5-1, choices 29 to 31), at 1440 and 390 px: while a review card
 * is open, the voice bar shrinks to the Listening pill beside it, in the card's own dialog layer,
 * and the pill goes at the end of the conversation; Stop on it ends the conversation; the soft
 * tone plays once as listening starts and once as it stops (a fake sound); and "Reconnecting",
 * "Now using {mic}." and the quiet stop are each said once to a screen reader. Where the model on
 * the device is the engine (T4-3), the pill shows its download and its problems.
 *
 * A fake mic, a fake clock, a fake tone and a fake server; nothing real is sent. Made-up names
 * only: Sample Logistics Pty Ltd, Sample Freight Pty Ltd, Jo Sample.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { AssistantCommand, AssistantCommandIn, CallNoteOptions } from '@/api/types'
import {
  FakeMic,
  HEADSET,
  IPHONE,
  LAPTOP_MIC,
  type FakeMicOptions,
} from '@/apps/companies/call-notes/mic/fake-mic'
import { PROBLEMS } from '@/apps/companies/call-notes/mic/words'
import { mockApi, type Answer } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import {
  API,
  CLOCK,
  command,
  note,
  notePath,
  notePreview,
  options,
  OTHER_SAMPLE,
  SAM,
  SAMPLE,
  taskCommand,
  teamEmail,
  write,
} from '../card/fixtures'
import { closeCard, openCard } from '../card/store'
import VoiceBar from './bar'
import type { Times } from './bar-session'
import { setKeepListening } from './keep-listening'
import { closeVoiceBar, isVoiceBarOpen, openVoiceBar } from './store'
import type { ToneKind } from './tone'

const BAR = 'Speak to the Assistant'
const HOLD = 5000
/** A short pause ends a turn; nothing else ends the conversation by itself here. */
const TALK: Partial<Times> = { pause: 50, quiet: 600_000, turn: 600_000 }

const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'
const SAY_SEND_IT = "Say 'send it' or press Enter"
const QUIET_LINE = 'Stopped listening after 2 minutes of quiet.'
const NOW_USING = 'Now using Headset Microphone (Jabra Evolve2 65).'

/** The command step answers by the words said: each test names its own. */
function byWords(answers: Record<string, AssistantCommand>): Answer {
  return (call) => {
    const said = (call.body as AssistantCommandIn).text
    return Response.json(answers[said] ?? command({ action: 'unknown', read_back: 'No.' }))
  }
}

interface Page {
  answers?: Record<string, AssistantCommand>
  mic?: FakeMicOptions
  times?: Partial<Times>
  voiceTool?: CallNoteOptions['voice_tool']
  /** "Keep listening": on, as for everyone (choice 6), unless a test says. */
  keep?: boolean
}

/** A page with the voice bar on it, a fake tone that notes each tone, and a fake server. */
function page({
  answers = { [TASK_WORDS]: taskCommand() },
  mic: micOptions,
  times = TALK,
  voiceTool = 'browser_service',
  keep = true,
}: Page = {}) {
  setKeepListening(keep)
  const mic = new FakeMic(micOptions)
  const tones: ToneKind[] = []
  const calls = mockApi({
    [API.options]: options({ voice_tool: voiceTool }),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.command]: byWords(answers),
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
    [API.notes]: note({ status: 'sorting' }),
    [notePath()]: note(),
    [API.notePreview]: notePreview(),
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(
    <VoiceBar
      env={mic.env()}
      makeTool={mic.tool}
      times={times}
      tone={(kind) => {
        tones.push(kind)
      }}
    />,
    { queryClient, route: '/assistant' },
  )
  const posts = (path: string) =>
    calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, tones, posts, ...view }
}

/** A change, and the page settled after it: what a screen reader hears of it. */
async function settled(change: () => void) {
  await act(async () => {
    change()
    await Promise.resolve()
  })
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Opens the bar and waits until it listens. */
async function listening() {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(bar.querySelector('[data-slot=voice-title]')).toHaveTextContent('Listening')
  })
  return bar
}

/** The rep says a turn: the pause after it ends it. */
async function say(mic: FakeMic, words: string) {
  act(() => {
    mic.say(words)
  })
  await wait(TALK.pause ?? 0)
}

/** A task card, opened by a spoken command in a conversation. */
async function taskCard(mic: FakeMic) {
  await listening()
  await say(mic, TASK_WORDS)
  return screen.findByRole('dialog', { name: TASK_CARD })
}

function pillOf(layer: HTMLElement = document.body): HTMLElement | null {
  return layer.querySelector<HTMLElement>('[data-slot=listening-pill]')
}

async function pillIn(layer: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(pillOf(layer)).not.toBeNull()
  })
  return pillOf(layer) as HTMLElement
}

/**
 * Every line a screen reader hears, in order: a live region's text each time it changes, or as a
 * region shows up with text in it. A region inside something hidden from screen readers says
 * nothing. Like a screen reader, it reads a region once the page has settled, so a test lets each
 * change settle (`settled`) before the next.
 */
function heard() {
  const lines: string[] = []
  const last = new WeakMap<Element, string>()
  const look = (): void => {
    for (const region of document.querySelectorAll(
      '[role="status"], [role="alert"], [aria-live]',
    )) {
      if (region.closest('[aria-hidden="true"]')) continue
      const text = (region.textContent ?? '').trim()
      if (text !== '' && last.get(region) !== text) lines.push(text)
      last.set(region, text)
    }
  }
  const observer = new MutationObserver(look)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  onTestFinished(() => {
    observer.disconnect()
  })
  look()
  return { lines, times: (line: string) => lines.filter((one) => one.includes(line)).length }
}

afterEach(() => {
  act(() => {
    closeVoiceBar()
    closeCard()
    toast.dismiss()
  })
  window.localStorage.clear()
  setKeepListening(true)
})

describe.each([
  ['1440 px (a laptop)', asLaptop],
  ['390 px (a phone)', asPhone],
])('at %s', (_, width) => {
  describe('the pill (choice 29)', () => {
    it('shows beside an open card while the mic is on, and goes as the card closes and as the conversation ends', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, posts } = page()
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      // Beside the card, in its dialog layer: not in the card's own box, and not the bar.
      expect(card.querySelector('[data-slot=review-card]')?.contains(pill)).toBe(false)
      expect(screen.queryByRole('dialog', { name: BAR })).toBeNull()
      expect(pill).toHaveAccessibleName(BAR)
      // Listening, with the bars and Stop (V), and what to say to the card.
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
      expect(pill.querySelector('[data-slot=frequency-bars]')).not.toBeNull()
      const stop = within(pill).getByRole('button', { name: /^Stop/ })
      expect(stop).toHaveAttribute('aria-keyshortcuts', 'V')
      expect(within(pill).getByText(SAY_SEND_IT)).toBeInTheDocument()
      // Said once: V's key is on the pill's Stop, so the card's keys don't name it again.
      expect(card.querySelector('[data-slot=card-hints]')).not.toHaveTextContent('Stop')
      // The words as they come show in the pill ("um" alone is dropped quietly as a turn).
      act(() => {
        mic.hear('um')
      })
      expect(within(pill).getByText('um')).toBeInTheDocument()
      // Made final, the words clear what was still heard. The card goes, and the pill with it;
      // the bar comes back, still listening.
      act(() => {
        mic.say('send it')
        mic.hear('')
      })
      await wait(TALK.pause ?? 0)
      await waitFor(() => {
        expect(pillOf()).toBeNull()
      })
      const bar = await screen.findByRole('dialog', { name: BAR })
      expect(bar.querySelector('[data-slot=voice-line]')).toHaveTextContent('Sent.')
      expect(mic.live()).toBe(1)
      await wait(HOLD)
      expect(posts(API.tasks)).toHaveLength(1)
      // "That's all": the conversation ends, and nothing more shows.
      await say(mic, "That's all")
      await waitFor(() => {
        expect(isVoiceBarOpen()).toBe(false)
      })
      expect(pillOf()).toBeNull()
      expect(mic.live()).toBe(0)
    })

    it('says to say the company’s name while the card waits on its company, then “send it”', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic } = page({
        answers: {
          [TASK_WORDS]: taskCommand({
            company: {
              found: null,
              choices: [SAMPLE, OTHER_SAMPLE],
              from_page: false,
              heard: 'Sample',
            },
          }),
        },
      })
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      expect(within(card).getByRole('group', { name: 'Which Sample?' })).toBeInTheDocument()
      expect(within(pill).getByText("Say the company's name.")).toBeInTheDocument()
      expect(within(pill).queryByText(SAY_SEND_IT)).toBeNull()
      await say(mic, 'the second one')
      await waitFor(() => {
        expect(within(pill).getByText(SAY_SEND_IT)).toBeInTheDocument()
      })
      expect(within(card).getByText(OTHER_SAMPLE.name)).toBeInTheDocument()
    })

    it('Stop on it ends the conversation: the pill goes, the card stays and keeps the focus', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, user } = page()
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      await user.click(within(pill).getByRole('button', { name: /^Stop/ }))
      await waitFor(() => {
        expect(mic.live()).toBe(0)
      })
      await waitFor(() => {
        expect(pillOf()).toBeNull()
      })
      expect(isVoiceBarOpen()).toBe(false)
      expect(screen.getByRole('dialog', { name: TASK_CARD })).toBe(card)
      expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
      // Nothing was said to the card after it opened: it ends quietly, with no "didn't hear".
      expect(screen.queryByText(/We didn't hear anything/)).toBeNull()
    })

    it('V on its Stop ends the conversation too, and the focus goes back to Send', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, user } = page()
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      within(pill).getByRole('button', { name: /^Stop/ }).focus()
      await user.keyboard('v')
      await waitFor(() => {
        expect(mic.live()).toBe(0)
      })
      await waitFor(() => {
        expect(pillOf()).toBeNull()
      })
      expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
    })

    it('its buttons once it stopped: the quiet stop keeps the line, and Start again listens again', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, user } = page({ times: { ...TALK, quiet: 5_000 } })
      const card = await taskCard(mic)
      await pillIn(card)
      await wait(5_000)
      const pill = await pillIn(card)
      await waitFor(() => {
        expect(pill.querySelector('[data-slot=pill-stopped]')).toHaveTextContent(QUIET_LINE)
      })
      expect(mic.live()).toBe(0)
      const again = within(pill).getByRole('button', { name: /^Start again/ })
      expect(again).toHaveAttribute('aria-keyshortcuts', 'V')
      await user.click(again)
      await waitFor(() => {
        expect(pillOf(card)?.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
      })
      expect(mic.live()).toBe(1)
      expect(within(card).getByRole('button', { name: 'Send' })).toHaveFocus()
    })
  })

  describe('the tone (choice 30)', () => {
    it('plays once as listening starts and once as it stops, not at each turn or card', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const change = 'make it send them the floor plan'
      const { mic, tones, user } = page({
        answers: {
          [TASK_WORDS]: taskCommand(),
          [change]: command({
            action: 'change',
            read_back: 'Change what to do.',
            change: { box: 'subject', value: 'Send Sample Logistics the floor plan', day: null },
          }),
        },
      })
      await listening()
      expect(tones).toEqual(['start'])
      await say(mic, TASK_WORDS)
      const card = await screen.findByRole('dialog', { name: TASK_CARD })
      await say(mic, change)
      await waitFor(() => {
        expect(within(card).getByRole('textbox', { name: 'What to do' })).toHaveValue(
          'Send Sample Logistics the floor plan',
        )
      })
      expect(tones).toEqual(['start'])
      await user.click(within(await pillIn(card)).getByRole('button', { name: /^Stop/ }))
      await waitFor(() => {
        expect(tones).toEqual(['start', 'stop'])
      })
    })

    it('stops once at the quiet stop, and once at Esc', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const quiet = page({ times: { ...TALK, quiet: 3_000 } })
      await listening()
      await wait(3_000)
      await waitFor(() => {
        expect(quiet.tones).toEqual(['start', 'stop'])
      })
      act(() => {
        closeVoiceBar()
      })
      quiet.unmount()

      const esc = page()
      await listening()
      await esc.user.keyboard('{Escape}')
      await waitFor(() => {
        expect(isVoiceBarOpen()).toBe(false)
      })
      expect(esc.tones).toEqual(['start', 'stop'])
    })

    it('with one command per V, plays once as it starts and once as the talk ends', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, tones, user } = page({ keep: false })
      await listening()
      act(() => {
        mic.say(TASK_WORDS)
      })
      await user.keyboard('v')
      await screen.findByRole('dialog', { name: TASK_CARD })
      expect(tones).toEqual(['start', 'stop'])
    })
  })

  describe('the lines (choice 31)', () => {
    it('“Reconnecting” shows in the pill, and is said once', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic } = page()
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      const said = heard()
      await settled(() => {
        mic.reconnecting(true)
      })
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent('Reconnecting')
      await settled(() => {
        mic.reconnecting(false)
      })
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
      expect(said.times('Reconnecting')).toBe(1)
      // Back to listening is said too, once.
      expect(said.lines).toEqual(['Reconnecting', 'Listening'])
    })

    it('“Now using {mic}.” is said once in all: in the bar, then shown in the pill and the bar again', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic } = page({ mic: { devices: [LAPTOP_MIC] } })
      const said = heard()
      const bar = await listening()
      await settled(() => {
        mic.plug(HEADSET)
      })
      expect(await within(bar).findByText(NOW_USING)).toHaveAttribute('role', 'status')
      await say(mic, TASK_WORDS)
      const card = await screen.findByRole('dialog', { name: TASK_CARD })
      const pill = await pillIn(card)
      // Shown in the pill, which doesn't say it again.
      expect(within(pill).getByText(NOW_USING)).not.toHaveAttribute('role')
      // The bar has gone from the page while the card is open.
      await waitFor(() => {
        expect(document.querySelector('[data-slot=voice-bar]')).toBeNull()
      })
      await say(mic, 'send it')
      const back = await screen.findByRole('dialog', { name: BAR })
      expect(within(back).getByText(NOW_USING)).not.toHaveAttribute('role')
      await wait(100)
      expect(said.times(NOW_USING)).toBe(1)
    })

    it('“Now using {mic}.” is said once when the mic moves while the pill shows', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic } = page({ mic: { devices: [LAPTOP_MIC] } })
      const card = await taskCard(mic)
      const pill = await pillIn(card)
      const said = heard()
      await waitFor(() => {
        expect(document.querySelector('[data-slot=voice-bar]')).toBeNull()
      })
      await settled(() => {
        mic.plug(HEADSET)
      })
      expect(await within(pill).findByText(NOW_USING)).toHaveAttribute('role', 'status')
      await say(mic, 'send it')
      const back = await screen.findByRole('dialog', { name: BAR })
      expect(within(back).getByText(NOW_USING)).not.toHaveAttribute('role')
      await wait(100)
      expect(said.times(NOW_USING)).toBe(1)
    })

    it('the quiet stop is said once in the pill, and not again as the bar comes back', async () => {
      width()
      vi.useFakeTimers(CLOCK)
      const { mic, user } = page({ times: { ...TALK, quiet: 5_000 } })
      const card = await taskCard(mic)
      await pillIn(card)
      const said = heard()
      await wait(5_000)
      await waitFor(() => {
        expect(said.times(QUIET_LINE)).toBe(1)
      })
      // The card is sent by hand: the bar comes back with the line, and says nothing of it.
      await user.click(within(card).getByRole('button', { name: 'Send' }))
      const bar = await screen.findByRole('dialog', { name: BAR })
      expect(within(bar).getByText(QUIET_LINE)).toBeInTheDocument()
      await wait(100)
      expect(said.times(QUIET_LINE)).toBe(1)
    })
  })
})

describe('the model on the device in the pill (PLAN-V24 T4-3)', () => {
  const BYTES = 83_000_000

  /** On an iPhone, a card opened from a button, and V on it starts a conversation. */
  async function onIPhone(micOptions: FakeMicOptions = {}) {
    asPhone()
    vi.useFakeTimers(CLOCK)
    const view = page({ mic: { browser: IPHONE, modelBytes: BYTES, ...micOptions } })
    act(() => {
      openCard({ kind: 'empty', action: 'task' })
    })
    const card = await screen.findByRole('dialog', { name: /task/i })
    within(card).getByRole('button', { name: 'Send' }).focus()
    await view.user.keyboard('v')
    return { ...view, card }
  }

  it('shows the download line and its progress, with Type instead and no Stop', async () => {
    const { mic, card, user } = await onIPhone()
    const pill = await pillIn(card)
    await waitFor(() => {
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent(
        'Getting voice ready on this phone',
      )
    })
    expect(within(pill).getByText('Only this once.')).toBeInTheDocument()
    expect(within(pill).getByText('0 of 83 MB')).toBeInTheDocument()
    act(() => {
      mic.model.progress(41_000_000)
    })
    expect(await within(pill).findByText('41 of 83 MB')).toBeInTheDocument()
    expect(within(pill).getByRole('progressbar', { name: 'Voice download' })).toHaveAttribute(
      'aria-valuenow',
      '49',
    )
    // No mic is open yet: no bars, and nothing to stop.
    expect(pill.querySelector('[data-slot=frequency-bars]')).toBeNull()
    expect(within(pill).queryByRole('button', { name: /^Stop/ })).toBeNull()
    expect(mic.asked).toEqual([])
    // Type instead: the pill goes, and the rep types into the card.
    await user.click(within(pill).getByRole('button', { name: 'Type instead' }))
    await waitFor(() => {
      expect(pillOf()).toBeNull()
    })
    // In the first box still to fill: this empty card's company.
    expect(within(card).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
    expect(mic.asked).toEqual([])
  })

  it('a download that failed: its line, Try again and Type instead; Try again gets it ready', async () => {
    const { mic, card, user } = await onIPhone()
    const pill = await pillIn(card)
    await within(pill).findByText('Only this once.')
    act(() => {
      mic.model.fail('download')
    })
    expect(await within(pill).findByRole('alert')).toHaveTextContent(PROBLEMS.download_failed.words)
    expect(within(pill).getByRole('button', { name: 'Type instead' })).toBeInTheDocument()
    await user.click(within(pill).getByRole('button', { name: 'Try again' }))
    expect(await within(card).findByText('Only this once.')).toBeInTheDocument()
    expect(mic.model.asked.prepare).toBe(2)
    act(() => {
      mic.model.done()
    })
    await waitFor(() => {
      expect(pillOf(card)?.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
    })
  })

  it('a device too slow for the model: its line, with Type instead', async () => {
    const { mic, card, user } = await onIPhone({ modelBytes: 0 })
    const pill = await pillIn(card)
    await waitFor(() => {
      expect(pill.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
    })
    act(() => {
      mic.say('send them the floor plan')
      mic.fail('too_slow')
    })
    expect(await within(pill).findByRole('alert')).toHaveTextContent(PROBLEMS.device_too_slow.words)
    await user.click(within(pill).getByRole('button', { name: 'Type instead' }))
    await waitFor(() => {
      expect(pillOf()).toBeNull()
    })
    expect(within(card).getByRole('textbox', { name: 'Find a company' })).toHaveFocus()
  })
})

describe.each([
  ['1440 px (a laptop)', asLaptop],
  ['390 px (a phone)', asPhone],
])('a connection lost after the quiet tries, at %s (the PLAN-V24 browser check)', (_, width) => {
  it('the pill says so in its own words, with Try again and Type instead', async () => {
    width()
    vi.useFakeTimers(CLOCK)
    const { mic, user } = page()
    const card = await taskCard(mic)
    const pill = await pillIn(card)
    act(() => {
      mic.fail('connection_lost')
    })
    const alert = await within(pill).findByRole('alert')
    expect(alert).toHaveTextContent(PROBLEMS.connection_lost.words)
    expect(alert).not.toHaveTextContent("didn't load")
    expect(within(pill).getByRole('button', { name: 'Type instead' })).toBeInTheDocument()
    // Try again listens again, from the pill.
    await user.click(within(pill).getByRole('button', { name: /^Try again/ }))
    await waitFor(() => {
      expect(pillOf(card)?.querySelector('[data-slot=pill-title]')).toHaveTextContent('Listening')
    })
    expect(mic.tools).toHaveLength(2)
  })
})
