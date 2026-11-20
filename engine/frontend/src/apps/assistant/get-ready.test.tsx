import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SignIn } from '@/api/hooks/auth'
import { queryKeys } from '@/api/query'
import type { CallNoteOptions } from '@/api/types'
import { CHROME_LAPTOP, IPHONE } from '@/apps/companies/call-notes/mic/fake-mic'
import type { BrowserFacts } from '@/apps/companies/call-notes/mic/voice-engine'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { mockApi } from '@/test/mock-api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { VoiceReadyMenuItem } from './links'

/*
  "Get voice ready" in the profile menu (PLAN-V24 T4-3, choice 25): it downloads the model on the
  device ahead of the first Speak, best on Wi-Fi, only where the model is or would be the engine.
  The model's code is made up: a download the test moves on, and a browser that keeps what it
  downloads. The browser is made up too: an iPhone, or Chrome on a laptop. Made-up names only.
*/

const BYTES = 83_000_000

const device = vi.hoisted(() => ({
  /** This browser keeps the model's files. */
  kept: false,
  downloads: 0,
  progress: null as ((progress: { loaded: number; total: number }) => void) | null,
  finish: null as (() => void) | null,
  fail: null as (() => void) | null,
}))

vi.mock('@/apps/companies/call-notes/mic/on-device/tool', () => ({
  voiceMissing: () => Promise.resolve(device.kept ? 0 : BYTES),
  downloadVoice: (onProgress?: (progress: { loaded: number; total: number }) => void) => {
    if (device.kept) return Promise.resolve()
    device.downloads += 1
    return new Promise<void>((resolve, reject) => {
      device.progress = onProgress ?? null
      device.finish = () => {
        device.kept = true
        resolve()
      }
      device.fail = () => {
        reject(Object.assign(new Error('offline'), { why: 'download' }))
      }
    })
  },
  prepareVoice: () => Promise.resolve('wasm'),
  onDeviceModel: () => ({
    start: () => undefined,
    stop: () => undefined,
    abort: () => undefined,
    nameCase: 'any',
  }),
}))

function options(voiceTool: CallNoteOptions['voice_tool']): CallNoteOptions {
  return {
    enabled: true,
    ai_enabled: true,
    sending_ready: true,
    waiting_for: null,
    outcomes: ['Connected', 'No answer'],
    fields: [],
    soft_seconds: 180,
    max_chars: 6000,
    voice_tool: voiceTool,
  }
}

const VIEWER: SignIn = {
  state: 'signed_in',
  user: {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'jo@example.test',
    username: 'jo',
    name: 'Jo Sample',
    position: null,
    role: 'viewer',
    apps: ['companies'],
    features: ['companies.call_logs'],
  },
}

/**
 * This browser: its user agent and touch points, its speech service (Chrome and Safari both have
 * one), and the parts the model needs to run.
 */
function asBrowser(facts: BrowserFacts): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(facts.userAgent)
  // jsdom has no touch points at all.
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => facts.touchPoints,
  })
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
  })
  vi.stubGlobal('webkitSpeechRecognition', class {})
  vi.stubGlobal('Worker', class {})
  vi.stubGlobal('AudioWorkletNode', class {})
}

/** The account menu, open, with the row in it. */
function openMenu(voiceTool: CallNoteOptions['voice_tool'], signIn: SignIn = { state: 'off' }) {
  mockApi({ '/api/v1/companies/call-notes/options': options(voiceTool) })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(queryKeys.auth.me(), signIn)
  queryClient.setQueryData(queryKeys.companies.callNoteOptions(), options(voiceTool))
  return renderWithProviders(
    <DropdownMenu open>
      <DropdownMenuTrigger>Account menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <VoiceReadyMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>,
    { queryClient },
  )
}

function row(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot=voice-ready]')
}

beforeEach(() => {
  Object.assign(device, { kept: false, downloads: 0, progress: null, finish: null, fail: null })
})

describe('"Get voice ready" in the profile menu (PLAN-V24 T4-3)', () => {
  it.each<[string, BrowserFacts, CallNoteOptions['voice_tool'], SignIn]>([
    [
      'Chrome on a laptop, where the browser’s service is the engine',
      CHROME_LAPTOP,
      'browser_service',
      { state: 'off' },
    ],
    ['typing', IPHONE, 'typing', { state: 'off' }],
    ['a Viewer, who has no mic', IPHONE, 'browser_service', VIEWER],
  ])('isn’t offered for %s', async (_, browser, voiceTool, signIn) => {
    asBrowser(browser)
    openMenu(voiceTool, signIn)
    await screen.findByRole('menu')
    expect(row()).toBeNull()
    expect(device.downloads).toBe(0)
  })

  it('on an iPhone: offers it with its size, downloads it with the menu still open, then says it is ready', async () => {
    asBrowser(IPHONE)
    const { user } = openMenu('browser_service')
    const item = await screen.findByRole('menuitem', { name: /Get voice ready/ })
    await waitFor(() => {
      expect(item).toHaveTextContent('About 83 MB, best on Wi-Fi')
    })
    expect(device.downloads).toBe(0)

    await user.click(item)
    // The menu stays open, so the download is seen to start.
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(device.downloads).toBe(1)
    act(() => {
      device.progress?.({ loaded: 41_000_000, total: BYTES })
    })
    await waitFor(() => {
      expect(row()).toHaveTextContent('Getting voice ready41 of 83 MB')
    })
    // A second press while it downloads starts nothing more.
    await user.click(screen.getByRole('menuitem', { name: /Getting voice ready/ }))
    expect(device.downloads).toBe(1)

    act(() => {
      device.finish?.()
    })
    await waitFor(() => {
      expect(row()).toHaveTextContent('Voice is ready on this phone')
    })
    expect(row()).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('"Get voice ready" after a download failed', () => {
  it('says so under the row, and a press tries again', async () => {
    vi.resetModules()
    const { VoiceReadyMenuItem: Row } = await import('./links')
    asBrowser(IPHONE)
    mockApi({ '/api/v1/companies/call-notes/options': options('browser_model') })
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(queryKeys.auth.me(), { state: 'off' })
    queryClient.setQueryData(queryKeys.companies.callNoteOptions(), options('browser_model'))
    const { user } = renderWithProviders(
      <DropdownMenu open>
        <DropdownMenuTrigger>Account menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <Row />
        </DropdownMenuContent>
      </DropdownMenu>,
      { queryClient },
    )
    await user.click(await screen.findByRole('menuitem', { name: /Get voice ready/ }))
    act(() => {
      device.fail?.()
    })
    await waitFor(() => {
      expect(row()).toHaveTextContent(
        "Get voice readyThat didn't finish. Check your connection, then try again.",
      )
    })
    await user.click(screen.getByRole('menuitem', { name: /Get voice ready/ }))
    expect(device.downloads).toBe(2)
  })
})
