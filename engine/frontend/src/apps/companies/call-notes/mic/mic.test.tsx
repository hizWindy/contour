import { act, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { FakeMic, HEADSET, LAPTOP_MIC, type FakeMicOptions } from './fake-mic'
import MicCard, { type MicCardProps } from './mic-card'
import type { NameFix } from './name-fix'
import { MIC_KEY } from './devices'
import { SOUND } from './session'
import { busyWords, PROBLEMS, systemBlockedWords } from './words'

/*
  The mic card (PLAN-V18 T3-4 and T3-5) with a fake mic: each check line, each failure from the
  plan's table, silence, a mic change, Esc, the mic let go on close, check only, and that nothing
  of the sound is ever sent. Made-up names only: Vitera Pty Ltd, Jo Sample.
*/

const NAMES = ['Vitera Pty Ltd', 'Jo Sample']

interface Spies {
  onDone: Mock<(text: string, fixes: readonly NameFix[]) => void>
  onTypeInstead: Mock<(text: string) => void>
  onClose: Mock<() => void>
}

function spiesOf(): Spies {
  return {
    onDone: vi.fn<(text: string, fixes: readonly NameFix[]) => void>(),
    onTypeInstead: vi.fn<(text: string) => void>(),
    onClose: vi.fn<() => void>(),
  }
}

function Host({ mic, spies, ...props }: Partial<MicCardProps> & { mic: FakeMic; spies: Spies }) {
  const [open, setOpen] = useState(true)
  return (
    <MicCard
      open={open}
      mode="note"
      tool="browser_service"
      names={NAMES}
      opener={null}
      env={mic.env()}
      makeTool={mic.tool}
      onDone={spies.onDone}
      onTypeInstead={spies.onTypeInstead}
      onClose={() => {
        spies.onClose()
        setOpen(false)
      }}
      {...props}
    />
  )
}

function openCard(options: FakeMicOptions = {}, props: Partial<MicCardProps> = {}) {
  const mic = new FakeMic(options)
  const spies = spiesOf()
  const view = renderWithProviders(<Host mic={mic} spies={spies} {...props} />)
  return { mic, spies, ...view }
}

/** The check's lines, as they show: "Mic found pass", "Say a few words waiting". */
function lines(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot=mic-check-line]')).map(
    (line) => `${line.textContent} ${line.dataset.state ?? ''}`,
  )
}

async function speakNow() {
  return screen.findByRole('dialog', { name: 'Speak now' })
}

describe('the check', () => {
  it('ticks each line as its real result comes in, then says Speak now', async () => {
    openCard()
    expect(await screen.findByRole('dialog', { name: 'Checking your mic' })).toBeInTheDocument()
    await waitFor(() => {
      expect(lines()).toEqual([
        'Mic found pass',
        'Allowed pass',
        'We can hear you pass',
        'Voice to text ready pass',
      ])
    })
    await speakNow()
    // The mic's name, made readable.
    expect(screen.getByText('Headset Microphone (Jabra Evolve2 65)')).toBeInTheDocument()
    // A screen reader hears the change once.
    expect(screen.getByRole('status')).toHaveTextContent('Speak now')
  })

  it('shows the four lines waiting first, the next one in the foreground', async () => {
    const mic = new FakeMic()
    // The browser takes its time to allow the mic.
    let allow: (() => void) | null = null
    const media = mic.env().media
    const env = {
      ...mic.env(),
      media: () => {
        const real = media()
        if (!real) return real
        return {
          enumerateDevices: real.enumerateDevices.bind(real),
          getUserMedia: (constraints?: MediaStreamConstraints) =>
            new Promise<MediaStream>((resolve) => {
              allow = () => {
                resolve(real.getUserMedia(constraints))
              }
            }),
        } as unknown as MediaDevices
      },
    }
    const spies = spiesOf()
    renderWithProviders(<Host mic={mic} spies={spies} env={env} />)
    await waitFor(() => {
      expect(lines()).toEqual([
        'Mic found pass',
        'Asking to use the mic waiting',
        'Say a few words waiting',
        'Getting voice to text ready waiting',
      ])
    })
    act(() => {
      allow?.()
    })
    await speakNow()
  })
})

describe('while developing', () => {
  it('still checks and listens when React runs the card twice (StrictMode)', async () => {
    const mic = new FakeMic()
    const spies = spiesOf()
    renderWithProviders(
      <StrictMode>
        <Host mic={mic} spies={spies} />
      </StrictMode>,
    )
    await speakNow()
    // The first run's mic was let go: only one is open.
    expect(mic.live()).toBe(1)
  })
})

describe('speaking', () => {
  it('shows the words as they come, fixes a name once, and Done puts them in the box', async () => {
    const { mic, spies, user } = openCard()
    await speakNow()
    act(() => {
      mic.say('Spoke to Jo at Vitara')
      mic.hear('about the lease')
    })
    // The four ticks stay in view a moment, then the words take their place.
    await waitFor(() => {
      expect(document.querySelector('[data-slot=mic-words]')).toHaveTextContent(
        'Spoke to Jo at Vitera about the lease',
      )
    })
    expect(screen.getByText('Changed Vitara to Vitera.')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(spies.onDone).toHaveBeenCalledWith('Spoke to Jo at Vitera about the lease', [
        { from: 'Vitara', to: 'Vitera' },
      ])
    })
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    // The mic is let go the moment the card closes: the browser's red dot goes.
    expect(mic.live()).toBe(0)
    expect(mic.audioClosed).toBe(1)
  })

  it('Esc is Cancel: nothing goes in the box, and the mic is let go', async () => {
    const { mic, spies, user } = openCard()
    await speakNow()
    act(() => {
      mic.say('Not this one')
    })
    await user.keyboard('{Escape}')
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    expect(spies.onDone).not.toHaveBeenCalled()
    expect(spies.onTypeInstead).not.toHaveBeenCalled()
    expect(mic.live()).toBe(0)
    expect(mic.tools.at(-1)?.aborted).toBe(true)
  })

  it('Type instead closes the card with nothing said, ready to type', async () => {
    const { spies, user } = openCard()
    await speakNow()
    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(spies.onTypeInstead).toHaveBeenCalledWith('')
    expect(spies.onClose).toHaveBeenCalled()
  })

  it('a network blip: the title says Reconnecting, and the words stay (PLAN-V24 T1-3)', async () => {
    const { mic, spies, user } = openCard()
    await speakNow()
    act(() => {
      mic.say('Jo wants a floor plan')
      mic.reconnecting(true)
    })
    expect(await screen.findByRole('dialog', { name: 'Reconnecting' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting')
    act(() => {
      mic.reconnecting(false)
      mic.say('by Friday')
    })
    await speakNow()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(spies.onDone).toHaveBeenCalledWith('Jo wants a floor plan by Friday', [])
    })
  })

  it('never sends the sound anywhere: no request at all while the mic is open', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({})))
    vi.stubGlobal('fetch', fetchSpy)
    const { mic, spies, user } = openCard()
    await speakNow()
    act(() => {
      mic.say('Spoke to Jo')
    })
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(spies.onDone).toHaveBeenCalled()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('what can go wrong (the plan’s table, the mic)', () => {
  it.each<[string, FakeMicOptions, string, string, string[]]>([
    [
      'no mic',
      { devices: [] },
      'No mic found',
      PROBLEMS.no_mic.words,
      ['Try again', 'Type instead'],
    ],
    [
      'blocked by the browser',
      { refuse: { name: 'NotAllowedError' } },
      'Not allowed',
      PROBLEMS.blocked_browser.words,
      ['Try again'],
    ],
    [
      'another app has it',
      { refuse: { name: 'NotReadableError', message: 'Could not start audio source' } },
      'Not allowed',
      PROBLEMS.busy.words,
      ['Try again', 'Type instead'],
    ],
    [
      'an old browser',
      { noMedia: true },
      'No mic found',
      PROBLEMS.old_browser.words,
      ['Type instead'],
    ],
    ['not the secure site', { secure: false }, 'No mic found', PROBLEMS.insecure.words, []],
    [
      // With no speech service, the model on the device takes over (PLAN-V24 T4-3): this browser
      // can run neither.
      'a browser that can run neither voice to text',
      { speech: false, browser: { model: false } },
      "Voice to text isn't ready",
      PROBLEMS.no_speech_tool.words,
      ['Type instead'],
    ],
  ])(
    '%s: the line turns Terracotta with its fix and buttons',
    async (_, options, line, words, buttons) => {
      openCard(options)
      const problem = await screen.findByText(words)
      const failed = problem.closest('[data-slot=mic-check-line]') as HTMLElement
      expect(failed).toHaveAttribute('data-state', 'fail')
      expect(within(failed).getByText(line)).toHaveClass('text-destructive-ink')
      for (const name of buttons) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
      // Cancel always works, and nothing else offers Type instead twice.
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.queryAllByRole('button', { name: 'Type instead' }).length).toBeLessThanOrEqual(
        1,
      )
    },
  )

  it('blocked by Windows: says where in Windows Settings to turn it on', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    openCard({ refuse: { name: 'NotAllowedError', message: 'Permission denied by system' } })
    expect(await screen.findByText(systemBlockedWords(true, false))).toBeInTheDocument()
    expect(systemBlockedWords(true, false)).toBe(
      'Windows has turned the mic off for your browser. In Windows Settings, open Privacy and security, then Microphone, and turn on access for apps. Then try again.',
    )
  })

  it('another app has it, on Windows: the line about exclusive control too (PLAN-V24 T1-4)', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const { spies, user } = openCard({ refuse: { name: 'NotReadableError' } })
    expect(await screen.findByText(busyWords(true))).toBeInTheDocument()
    expect(busyWords(true)).toContain(
      "turn off 'Allow applications to take exclusive control' for your mic",
    )
    // Type instead closes the card, ready to type the note.
    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(spies.onTypeInstead).toHaveBeenCalledWith('')
  })

  it('another app has it, on a Mac: no Windows line', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    openCard({ refuse: { name: 'NotReadableError' } })
    expect(await screen.findByText(PROBLEMS.busy.words)).toBeInTheDocument()
    expect(screen.queryByText(/exclusive control/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('another app has it, while checking the mic only: Try again, with no note to type', async () => {
    openCard({ refuse: { name: 'NotReadableError' } }, { mode: 'check' })
    expect(await screen.findByText(PROBLEMS.busy.words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Type instead' })).toBeNull()
  })

  it('reads a refusal while the site is allowed as the computer blocking it', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    openCard({ refuse: { name: 'NotAllowedError' }, permission: 'granted' })
    expect(await screen.findByText(systemBlockedWords(true, false))).toBeInTheDocument()
  })

  it('Try again runs the check again, and passes once the mic is allowed', async () => {
    const { mic, user } = openCard({ refuse: { name: 'NotAllowedError' } })
    await screen.findByText(PROBLEMS.blocked_browser.words)
    mic.refuse = null
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await speakNow()
  })

  it('silent: says it hears nothing after 2 seconds, and carries on when a voice comes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { mic } = openCard({ level: 0 })
    await screen.findByText('Say a few words')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(await screen.findByText(PROBLEMS.silent.words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick a mic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // The mic stays open, so the bars show when the rep unmutes.
    expect(mic.live()).toBe(1)
    mic.level = 0.2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await speakNow()
    expect(screen.queryByText(PROBLEMS.silent.words)).toBeNull()
  })

  it('the voice tool didn’t load: says so, with Try again and Type instead', async () => {
    const { mic } = openCard({ toolNeverReady: true })
    await screen.findByText('Getting voice to text ready')
    // That line shows from the start. The tool fails once the mic is heard: the hear check
    // passing clears a problem before it, which a busy run could let happen.
    await screen.findByText('We can hear you')
    expect(mic.tools.at(-1)?.started).toBe(true)
    act(() => {
      mic.fail('tool_failed')
    })
    expect(await screen.findByText(PROBLEMS.tool_failed.words)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Type instead' })).toBeInTheDocument()
  })

  it('too slow: writing out takes over 3 times the talk, so it offers Type instead', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { mic, spies, user } = openCard({ toolNeverFinishes: true })
    await speakNow()
    act(() => {
      mic.say('The lease ends in June')
    })
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Writing it out' })).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100)
    })
    expect(await screen.findByText(PROBLEMS.too_slow.words)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    // What was written out so far is kept.
    expect(spies.onTypeInstead).toHaveBeenCalledWith('The lease ends in June')
  })

  it('cut off: the mic stopped mid note, and what was said so far is kept', async () => {
    const { mic, spies, user } = openCard()
    await speakNow()
    act(() => {
      mic.say('Jo wants a floor plan')
      mic.unplug()
    })
    expect(await screen.findByRole('dialog', { name: 'The mic stopped' })).toBeInTheDocument()
    expect(screen.getByText(PROBLEMS.cut_off.words)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Carry on' }))
    expect(spies.onTypeInstead).toHaveBeenCalledWith('Jo wants a floor plan')
  })
})

describe('which mic', () => {
  it('names the mic, changes it, and remembers the pick on this computer', async () => {
    const { mic, user } = openCard({ devices: [HEADSET, LAPTOP_MIC] })
    await speakNow()
    expect(screen.getByText('Headset Microphone (Jabra Evolve2 65)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change the mic' }))
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Microphone Array (Realtek)' }),
    )
    await speakNow()
    // The picked mic by its exact id, with the clean sound (PLAN-V24 T1-1).
    expect(mic.asked.at(-1)).toEqual({ audio: { deviceId: { exact: 'mic-laptop' }, ...SOUND } })
    expect(mic.storage.get(MIC_KEY)).toBe('mic-laptop')
    expect(screen.getByText('Microphone Array (Realtek)')).toBeInTheDocument()
    // The first mic was let go.
    expect(mic.live()).toBe(1)
  })

  it('follows the mic when the one in use is unplugged, and says which (PLAN-V24 T1-2)', async () => {
    const { mic, spies, user } = openCard({ devices: [HEADSET, LAPTOP_MIC] })
    await speakNow()
    act(() => {
      mic.say('Jo wants a floor plan')
      mic.unplug()
    })
    // A screen reader hears it once; the mic's row shows the new name.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Speak now. Now using Microphone Array (Realtek).',
      )
    })
    expect(screen.getByRole('dialog', { name: 'Speak now' })).toBeInTheDocument()
    expect(screen.getByText('Microphone Array (Realtek)')).toBeInTheDocument()
    expect(mic.live()).toBe(1)
    act(() => {
      mic.say('by Friday')
    })
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(spies.onDone).toHaveBeenCalledWith('Jo wants a floor plan by Friday', [])
    })
  })

  it('uses the remembered mic, and the default one when it is gone', async () => {
    const mic = new FakeMic({ devices: [HEADSET] })
    mic.storage.set(MIC_KEY, 'mic-unplugged')
    const spies = spiesOf()
    renderWithProviders(<Host mic={mic} spies={spies} />)
    await speakNow()
    expect(mic.asked[0]).toEqual({ audio: { deviceId: { exact: 'mic-unplugged' }, ...SOUND } })
    expect(mic.asked[1]).toEqual({ audio: SOUND })
    expect(mic.storage.has(MIC_KEY)).toBe(false)
  })
})

describe('a free model on the device (PLAN-V24 T4-3)', () => {
  const BYTES = 83_000_000

  it('with browser_model, gets the model ready, listens with it, and its names are fixed', async () => {
    const { mic, user, spies } = openCard({}, { tool: 'browser_model' })
    await speakNow()
    expect(mic.model.asked.prepare).toBe(1)
    // The model's own tool, which writes names in any case (choice 28).
    expect(mic.tools.map((tool) => tool.nameCase)).toEqual(['any'])
    act(() => {
      mic.say('log a call with jo sample')
    })
    expect(await screen.findByText('log a call with Jo Sample')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(spies.onDone).toHaveBeenCalledWith('log a call with Jo Sample', [])
    })
  })

  it('downloads it first where this browser doesn’t keep it: the line, its progress, no mic', async () => {
    const { mic } = openCard({ modelBytes: BYTES }, { tool: 'browser_model' })
    expect(
      await screen.findByRole('dialog', { name: 'Getting voice ready on this computer' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Only this once.')).toBeInTheDocument()
    expect(screen.getByText('0 of 83 MB')).toBeInTheDocument()
    act(() => {
      mic.model.progress(41_000_000)
    })
    expect(await screen.findByText('41 of 83 MB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Voice download' })).toHaveAttribute(
      'aria-valuenow',
      '49',
    )
    // Said once to a screen reader, not at each megabyte.
    expect(screen.getByRole('status')).toHaveTextContent('Getting voice ready on this computer')
    // No mic opens while it downloads.
    expect(mic.asked).toEqual([])
    act(() => {
      mic.model.done()
    })
    await speakNow()
    expect(mic.live()).toBe(1)
  })

  it('Type instead skips the download: the mic never opens', async () => {
    const { mic, user, spies } = openCard({ modelBytes: BYTES }, { tool: 'browser_model' })
    await screen.findByText('Only this once.')
    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(spies.onTypeInstead).toHaveBeenCalledWith('')
    act(() => {
      mic.model.done()
    })
    expect(mic.asked).toEqual([])
    expect(mic.tools).toHaveLength(0)
  })

  it.each<[string, 'download' | 'load', string, string[]]>([
    [
      'the download failed',
      'download',
      PROBLEMS.download_failed.words,
      ['Try again', 'Type instead'],
    ],
    ['the model won’t start here', 'load', PROBLEMS.model_failed.words, ['Type instead']],
  ])('%s: says so, with its buttons, and no mic opened', async (_, why, words, buttons) => {
    const { mic } = openCard({ modelBytes: BYTES }, { tool: 'browser_model' })
    await screen.findByText('Only this once.')
    act(() => {
      mic.model.fail(why)
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(words)
    expect(screen.getByRole('dialog', { name: "Voice to text isn't ready" })).toBeInTheDocument()
    for (const name of buttons) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(mic.asked).toEqual([])
  })

  it('Try again after a failed download downloads again, then listens', async () => {
    const { mic, user } = openCard({ modelBytes: BYTES }, { tool: 'browser_model' })
    await screen.findByText('Only this once.')
    act(() => {
      mic.model.fail('download')
    })
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Only this once.')).toBeInTheDocument()
    expect(mic.model.asked.prepare).toBe(2)
    act(() => {
      mic.model.done()
    })
    await speakNow()
  })

  it('a device too slow for the model says so, with Type instead, and the words stay', async () => {
    const { mic, user, spies } = openCard({}, { tool: 'browser_model' })
    await speakNow()
    act(() => {
      mic.say('log a call with jo sample')
      mic.fail('too_slow')
    })
    expect(await screen.findByText(PROBLEMS.device_too_slow.words)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'The mic stopped' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(spies.onTypeInstead).toHaveBeenCalledWith('log a call with Jo Sample')
  })
})

describe('check only ("Check my mic")', () => {
  it('runs the same check, says the mic works, and Done closes it', async () => {
    const { mic, spies, user } = openCard({}, { mode: 'check' })
    expect(await screen.findByRole('dialog', { name: 'Your mic works' })).toBeInTheDocument()
    await waitFor(() => {
      expect(lines()).toEqual([
        'Mic found pass',
        'Allowed pass',
        'We can hear you pass',
        'Voice to text ready pass',
      ])
    })
    // A check never starts the speech service: it would send the voice for nothing.
    expect(mic.tools).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Type instead' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(spies.onClose).toHaveBeenCalled()
    expect(mic.live()).toBe(0)
  })

  it('with the model on the device, gets it ready first, then says the mic works', async () => {
    const { mic } = openCard({}, { mode: 'check', tool: 'browser_model' })
    expect(await screen.findByRole('dialog', { name: 'Your mic works' })).toBeInTheDocument()
    await waitFor(() => {
      expect(lines()).toEqual([
        'Mic found pass',
        'Allowed pass',
        'We can hear you pass',
        'Voice to text ready pass',
      ])
    })
    expect(mic.model.asked.prepare).toBe(1)
    // A check starts no tool.
    expect(mic.tools).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Type instead' })).toBeNull()
  })
})
