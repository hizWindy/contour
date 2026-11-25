/**
 * Live voice in the voice bar and the pill (PLAN-V28 T2-4), at 1440 and 390 px: the states in one
 * word (Connecting, Listening, Working it out, Speaking, Reconnecting, Muted), each said once to a
 * screen reader, politely, and never the words; the captions, the rep's words then the
 * Assistant's; Mute keeps the talk; Stop (V) and Esc end it; a card that opens hears the talk
 * through its ear, with the pill beside it, and opens no mic of its own; and the free mic as before
 * without live voice, or when the start fails.
 *
 * A fake talk, the fake mic, a fake clock and a fake server: nothing reaches Google. Made-up names
 * only: Sample Logistics, Jo Sample, Jo Northwind.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import { CHROME_LAPTOP, FakeMic } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders, startManualClock } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import { API, options, SAM, taskCommand, teamEmail, write } from '../card/fixtures'
import { closeCard, openCard } from '../card/store'
import VoiceBar from './bar'
import { setKeepListening } from './keep-listening'
import { FakeTalks } from './live/fake-talk'
import { closeVoiceBar, isVoiceBarOpen, openVoiceBar } from './store'

const BAR = 'Speak to the Assistant'
const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'

/** A page with the voice bar on it, for a person live voice is on for, or not. */
function page({ liveVoice = true }: { liveVoice?: boolean } = {}) {
  // "Keep listening" off: a live talk is a conversation all the same.
  setKeepListening(false)
  const mic = new FakeMic({ browser: { ...CHROME_LAPTOP, live: true } })
  const talks = new FakeTalks()
  mockApi({
    '/api/v1/auth/me': {
      auth_required: false,
      user: null,
      session: null,
      platform_admin_name: null,
      first_sign_in: false,
      live_voice: liveVoice,
    },
    [API.options]: options({ voice_tool: 'browser_service' }),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.taskPreview]: write(),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    queryKeys.auth.me(),
    liveVoice ? { state: 'off', liveVoice } : { state: 'off' },
  )
  const view = renderWithProviders(
    <VoiceBar env={mic.env()} makeTool={mic.tool} talk={talks.make} tone={() => undefined} />,
    { queryClient, route: '/assistant' },
  )
  return { mic, talks, ...view }
}

/** Every line a screen reader hears, in order: each live region's text as it changes. */
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
  return lines
}

async function moved(change: () => void) {
  await act(async () => {
    change()
    await Promise.resolve()
  })
}

/**
 * Opens the bar, and waits until it says where it stands and has started: the talk is made (live
 * voice), or the free mic listens.
 */
async function opened(talks: FakeTalks, title = 'Connecting') {
  act(() => {
    openVoiceBar()
  })
  const bar = await screen.findByRole('dialog', { name: BAR })
  await waitFor(() => {
    expect(titleOf(bar)).toBe(title)
    if (title === 'Connecting') expect(talks.made.length).toBeGreaterThan(0)
  })
  return bar
}

function titleOf(layer: HTMLElement): string {
  return layer.querySelector('[data-slot=voice-title], [data-slot=pill-title]')?.textContent ?? ''
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
])('live voice at %s', (_, width) => {
  it('says where the talk stands in one word, each said once, politely, and never the words', async () => {
    width()
    startManualClock()
    const { talks, mic } = page()
    const lines = heard()
    const bar = await opened(talks, 'Connecting')
    const talk = talks.last()
    expect(talk.started).toBe(true)
    // One mic, the talk's: no mic session, no voice tool.
    expect(mic.asked).toEqual([])

    await moved(() => {
      talk.ready()
    })
    expect(titleOf(bar)).toBe('Listening')
    await moved(() => {
      talk.set({ working: 1 })
    })
    expect(titleOf(bar)).toBe('Working it out')
    // Speaking is what is heard, so it comes first.
    await moved(() => {
      talk.set({ speaking: true })
    })
    expect(titleOf(bar)).toBe('Speaking')
    await moved(() => {
      talk.set({ speaking: false, working: 0 })
    })
    expect(titleOf(bar)).toBe('Listening')
    await moved(() => {
      talk.set({ phase: 'reconnecting' })
    })
    expect(titleOf(bar)).toBe('Reconnecting')
    await moved(() => {
      talk.set({ phase: 'live' })
    })
    // The words are never said: only where it stands.
    await moved(() => {
      talk.hear('Log a call with Jo at Sample Logistics.')
    })

    const said = lines.filter((line) => line !== '')
    expect(said).toEqual([
      'Connecting',
      'Listening',
      'Working it out',
      'Speaking',
      'Listening',
      'Reconnecting',
      'Listening',
    ])
    // Politely: a status, not an alert.
    expect(bar.querySelector('[role=status]')).toHaveTextContent('Listening')
  })

  it("shows the captions: the rep's words as Google hears them, then the Assistant's", async () => {
    width()
    startManualClock()
    const { talks } = page()
    const bar = await opened(talks)
    const talk = talks.last()
    await moved(() => {
      talk.ready()
    })
    // Before any words: what to say.
    expect(within(bar).getByText('Try saying')).toBeInTheDocument()

    await moved(() => {
      talk.hear('Log a call with Jo at', 'Sample Logist')
    })
    const captions = bar.querySelector('[data-slot=live-captions]') as HTMLElement
    expect(within(captions).getByText('You')).toBeInTheDocument()
    expect(captions.querySelector('[data-slot=caption-rep]')).toHaveTextContent(
      'Log a call with Jo at Sample Logist',
    )

    await moved(() => {
      talk.hear('Log a call with Jo at Sample Logistics.')
      talk.say('Jo Sample or Jo Northwind?')
    })
    expect(within(captions).getByText('Assistant')).toBeInTheDocument()
    expect(captions.querySelector('[data-slot=caption-assistant]')).toHaveTextContent(
      'Jo Sample or Jo Northwind?',
    )
    // The rep's words come first.
    const order = [...captions.querySelectorAll('dt')].map((term) => term.textContent)
    expect(order).toEqual(['You', 'Assistant'])
  })

  it('Mute keeps the talk going, says "Muted", and shows that it is on', async () => {
    width()
    startManualClock()
    const { talks, user } = page()
    const bar = await opened(talks)
    const talk = talks.last()
    await moved(() => {
      talk.ready()
    })
    const mute = within(bar).getByRole('button', { name: 'Mute' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')

    await user.click(mute)
    expect(talk.mutes).toEqual([true])
    expect(titleOf(bar)).toBe('Muted')
    expect(within(bar).getByRole('button', { name: 'Mute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(talk.stopped).toBe(false)
    // While the Assistant speaks, the title says so; Mute still shows it is on.
    await moved(() => {
      talk.set({ speaking: true })
    })
    expect(titleOf(bar)).toBe('Speaking')

    await user.click(within(bar).getByRole('button', { name: 'Mute' }))
    expect(talk.mutes).toEqual([true, false])
  })

  it('Stop (V) ends the talk, and the bar closes', async () => {
    width()
    startManualClock()
    const { talks, user } = page()
    const bar = await opened(talks)
    const talk = talks.last()
    await moved(() => {
      talk.ready()
      talk.hear('Log a call with Jo.')
    })
    const stop = within(bar).getByRole('button', { name: /^Stop/ })
    expect(stop).toHaveAttribute('aria-keyshortcuts', 'V')

    await user.keyboard('v')
    expect(talk.stopped).toBe(true)
    await waitFor(() => {
      expect(isVoiceBarOpen()).toBe(false)
    })
  })

  it('Esc ends the talk and closes the bar', async () => {
    width()
    startManualClock()
    const { talks, user } = page()
    await opened(talks)
    await moved(() => {
      talks.last().ready()
    })

    await user.keyboard('{Escape}')
    expect(talks.last().stopped).toBe(true)
    expect(isVoiceBarOpen()).toBe(false)
  })

  it('a card that opens hears the talk, with the pill beside it, and opens no mic of its own', async () => {
    width()
    startManualClock()
    const { talks, mic } = page()
    await opened(talks)
    const talk = talks.last()
    await moved(() => {
      talk.ready()
      talk.hear(TASK_WORDS)
    })
    act(() => {
      openCard({ kind: 'command', command: taskCommand(), words: TASK_WORDS, source: 'mic' })
    })
    const card = await screen.findByRole('dialog', { name: TASK_CARD })
    const pill = await waitFor(() => {
      const found = card.querySelector<HTMLElement>('[data-slot=listening-pill]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    expect(titleOf(pill)).toBe('Listening')
    expect(pill.querySelector('[data-slot=caption-rep]')).toHaveTextContent(TASK_WORDS)
    expect(within(pill).getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    expect(within(pill).getByRole('button', { name: /^Stop/ })).toBeInTheDocument()
    await moved(() => {
      talk.set({ speaking: true })
    })
    expect(titleOf(pill)).toBe('Speaking')
    // One mic: the card listens for nothing itself, as in any conversation.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(mic.asked).toEqual([])
    expect(mic.tools).toEqual([])
  })
})

describe('the free mic, as before', () => {
  it('listens with the free mic for a person without live voice', async () => {
    startManualClock()
    const { talks, mic } = page({ liveVoice: false })
    const bar = await opened(talks, 'Listening')

    expect(talks.made).toEqual([])
    expect(mic.tools).toHaveLength(1)
    expect(within(bar).queryByRole('button', { name: 'Mute' })).toBeNull()
  })

  it('takes over at once when a start fails, before a word', async () => {
    startManualClock()
    const { talks, mic } = page()
    const bar = await opened(talks)
    await moved(() => {
      talks.last().finish({ kind: 'failed' })
    })

    await waitFor(() => {
      expect(titleOf(bar)).toBe('Listening')
    })
    expect(mic.tools).toHaveLength(1)
    expect(within(bar).queryByRole('button', { name: 'Mute' })).toBeNull()
  })
})

describe('on an iPhone, the sound starts inside the tap that opened the bar (T2-2)', () => {
  /** Counts the audio contexts made, as a browser makes them. */
  function countContexts() {
    const made: AudioContextOptions[] = []
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended'
        constructor(options: AudioContextOptions = {}) {
          made.push(options)
        }
        resume() {
          this.state = 'running'
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
      },
    )
    return made
  }

  it('makes both audio contexts in the same tap or key press, for a person with live voice', async () => {
    startManualClock()
    const made = countContexts()
    page()
    // The bar's code is in, and knows this person has live voice.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(made).toEqual([])

    // The tap: both are made inside it, before anything renders.
    openVoiceBar()
    expect(made).toEqual([
      { latencyHint: 'interactive' },
      { sampleRate: 24_000, latencyHint: 'interactive' },
    ])
    act(() => {
      closeVoiceBar()
    })
  })

  it('makes none for a person without live voice', async () => {
    startManualClock()
    const made = countContexts()
    page({ liveVoice: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    openVoiceBar()

    expect(made).toEqual([])
    act(() => {
      closeVoiceBar()
    })
  })
})
