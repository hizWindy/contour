/**
 * The card's own listening follows the engine (PLAN-V24 T4-3, T3-2's files): after a spoken
 * command, the card listens 5 seconds for "send it" wherever a voice engine runs, the browser's
 * service or the model on the device, as the voice bar's session picks it, and not with typing.
 * V's own change on the card says the model's download line while the model gets ready. A fake
 * mic, a fake clock and a fake server; nothing real is sent. Made-up names only: Sample Logistics
 * Pty Ltd.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions } from '@/api/types'
import { FakeMic, IPHONE, type FakeMicOptions } from '@/apps/companies/call-notes/mic/fake-mic'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { asLaptop, asPhone } from '@/test/screen'
import VoiceBar from '../voice/bar'
import { setKeepListening } from '../voice/keep-listening'
import { closeVoiceBar } from '../voice/store'
import { API, CLOCK, options, SAM, taskCommand, teamEmail, write } from './fixtures'
import { closeCard, openCard } from './store'

const TASK_WORDS = 'Add a task to send Sample Logistics the quote on Friday'
const TASK_CARD = 'Add a task for you: send Sample Logistics the quote, due Fri 27 Nov.'
const HOLD = 5000

/** One command per V ("Keep listening" off): the card listens with its own mic. */
function page(voiceTool: CallNoteOptions['voice_tool'], micOptions: FakeMicOptions = {}) {
  setKeepListening(false)
  const mic = new FakeMic(micOptions)
  const calls = mockApi({
    [API.options]: options({ voice_tool: voiceTool }),
    [API.summary]: { to_confirm: 0, needs_look: 0, logged_today: 0, needs_company: 0 },
    [API.taskPreview]: write(),
    [API.tasks]: write({ status: 'done' }),
    [API.emailPreview]: teamEmail(),
    [API.team]: [SAM],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
  const view = renderWithProviders(<VoiceBar env={mic.env()} makeTool={mic.tool} />, {
    queryClient,
    route: '/assistant',
  })
  const posts = (path: string) =>
    calls.filter((call) => call.path === path && call.method === 'POST')
  return { mic, posts, ...view }
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

describe('the card’s own listening follows the engine (T4-3)', () => {
  it.each<[string, CallNoteOptions['voice_tool'], FakeMicOptions, boolean]>([
    ['the browser’s service on a Chrome laptop', 'browser_service', {}, true],
    ['the model on the device, with it chosen', 'browser_model', {}, true],
    ['the model on an iPhone', 'browser_service', { browser: IPHONE }, true],
    ['no mic with typing', 'typing', {}, false],
  ])(
    'after a spoken command, it listens 5 seconds for “send it”: %s',
    async (_, tool, micOptions, listens) => {
      asLaptop()
      vi.useFakeTimers(CLOCK)
      const { mic, posts } = page(tool, micOptions)
      act(() => {
        openCard({ kind: 'command', command: taskCommand(), words: TASK_WORDS, source: 'mic' })
      })
      const card = await screen.findByRole('dialog', { name: TASK_CARD })
      if (!listens) {
        // Its keys are drawn once the setting is known; nothing listens.
        await within(card).findByRole('button', { name: 'Send' })
        expect(card.querySelector('[data-slot=card-listen]')).toBeNull()
        expect(mic.tools).toHaveLength(0)
        return
      }
      await waitFor(() => {
        expect(card.querySelector('[data-slot=card-listen]')).not.toBeNull()
      })
      await waitFor(() => {
        expect(mic.tools).toHaveLength(1)
      })
      act(() => {
        mic.say('send it')
      })
      expect(await screen.findByText('Adding the task in HubSpot')).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD)
      })
      await waitFor(() => {
        expect(posts(API.tasks)).toHaveLength(1)
      })
    },
  )

  it('V’s own change says the download line while the model on the device gets ready', async () => {
    asPhone()
    vi.useFakeTimers(CLOCK)
    const { mic, user } = page('browser_service', { browser: IPHONE, modelBytes: 83_000_000 })
    act(() => {
      openCard({ kind: 'empty', action: 'task' })
    })
    const card = await screen.findByRole('dialog', { name: /task/i })
    within(card).getByRole('button', { name: 'Send' }).focus()
    await user.keyboard('v')
    const strip = await waitFor(() => {
      const found = card.querySelector<HTMLElement>('[data-slot=card-voice]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    await waitFor(() => {
      expect(strip).toHaveTextContent('Getting voice ready on this phone')
    })
    // No mic is open yet: no bars.
    expect(strip.querySelector('[data-slot=frequency-bars]')).toBeNull()
    expect(mic.asked).toEqual([])
    act(() => {
      mic.model.done()
    })
    await waitFor(() => {
      expect(strip).toHaveTextContent('Listening')
    })
    expect(strip.querySelector('[data-slot=frequency-bars]')).not.toBeNull()
  })
})
