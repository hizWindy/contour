/** "Waiting for Claude: 1 ahead of you." (PLAN-V26 T1-2). */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PrepOut } from '@/api/types'
import { ScriptHeader } from '@/apps/companies/script-header'
import { WaitingForClaude } from './waiting-for-claude'

const said = () =>
  [...document.querySelectorAll('[aria-live="polite"]')]
    .map((part) => part.textContent)
    .filter((text) => text.startsWith('Waiting for Claude'))

const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('p[aria-hidden="true"]')].map((part) => part.textContent)

describe('WaitingForClaude', () => {
  it('shows nothing for work that starts at once', () => {
    const { container, rerender } = render(<WaitingForClaude ahead={undefined} />)
    expect(container.textContent).toBe('')
    rerender(<WaitingForClaude ahead={null} />)
    expect(container.textContent).toBe('')
  })

  it('says the number, and the words go when it starts', () => {
    const { container, rerender } = render(<WaitingForClaude ahead={null} />)
    rerender(<WaitingForClaude ahead={1} />)
    expect(shown(container)).toEqual(['Waiting for Claude: 1 ahead of you.'])
    rerender(<WaitingForClaude ahead={null} />)
    expect(container.textContent).toBe('')
  })

  it('follows the count on screen, and is heard once', () => {
    const { container, rerender } = render(<WaitingForClaude ahead={null} />)
    rerender(<WaitingForClaude ahead={3} />)
    expect(said()).toEqual(['Waiting for Claude: 3 ahead of you.'])
    rerender(<WaitingForClaude ahead={2} />)
    expect(shown(container)).toEqual(['Waiting for Claude: 2 ahead of you.'])
    // The live part didn't change, so it isn't read out again.
    expect(said()).toEqual(['Waiting for Claude: 3 ahead of you.'])
  })

  it('reads a new wait out again', () => {
    const { rerender } = render(<WaitingForClaude ahead={3} />)
    rerender(<WaitingForClaude ahead={null} />)
    rerender(<WaitingForClaude ahead={1} />)
    expect(said()).toEqual(['Waiting for Claude: 1 ahead of you.'])
  })
})

describe('the prep header', () => {
  const header = (running: boolean, ahead: number | null) => (
    <ScriptHeader
      madeFrom="hubspot"
      prep={{ waiting_ahead: ahead } as PrepOut}
      enabled
      namesOk
      capUsd="0.25"
      running={running}
      stage={0}
      failed={false}
      onResearch={() => undefined}
    />
  )

  it('shows the wait while the prep runs', () => {
    const { container } = render(header(true, 1))
    expect(container.textContent).toContain('Waiting for Claude: 1 ahead of you.')
  })

  it('never shows it for a prep that is over, or one that began at once', () => {
    const { container, rerender } = render(header(false, 1))
    expect(container.textContent).not.toContain('Waiting for Claude')
    rerender(header(true, null))
    expect(container.textContent).not.toContain('Waiting for Claude')
  })
})
