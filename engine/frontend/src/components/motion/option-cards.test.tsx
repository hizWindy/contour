import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MotionRoot } from './motion-root'
import { OptionCards } from './option-cards'

/*
  Option cards (PLAN-V21 T3-1): the Start page's "What to do" as a radio group of cards. jsdom has
  no layout, so these check what a screen reader and the keyboard get: the names and lines, Tab on
  the picked card, arrows that move the focus without picking, and Space or Enter to pick.
*/

const KINDS = [
  { value: 'discovery', title: 'Find new leads', description: 'Search the news.' },
  { value: 'tenure', title: 'Old offices', description: 'Research how long they have been there.' },
  { value: 'watchlist', title: 'HubSpot watchlist', description: 'The most likely to move.' },
  { value: 'company', title: 'Companies by name', description: 'The ones you type in.' },
] as const

function Harness({ disabled = [] as string[] }) {
  const [value, setValue] = useState<string>('discovery')
  return (
    <MotionRoot>
      <OptionCards
        aria-label="Kind of run"
        options={KINDS.map((kind) => ({ ...kind, disabled: disabled.includes(kind.value) }))}
        value={value}
        onChange={setValue}
      />
      <p data-testid="picked">{value}</p>
    </MotionRoot>
  )
}

function picked(): string {
  return screen.getByTestId('picked').textContent ?? ''
}

describe('OptionCards', () => {
  it('is a radio group of cards, each named by its title and described by its line', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Kind of run' })
    const cards = within(group).getAllByRole('radio')
    expect(cards).toHaveLength(4)
    expect(cards[1]).toHaveAccessibleName('Old offices')
    expect(cards[1]).toHaveAccessibleDescription('Research how long they have been there.')
    expect(cards.map((card) => card.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    // Only the picked card is in the Tab order.
    expect(cards.map((card) => card.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('picks a card on a click, and the tint and the tick go with it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'HubSpot watchlist' }))
    const card = screen.getByRole('radio', { name: 'HubSpot watchlist' })
    expect(card).toHaveAttribute('aria-checked', 'true')
    expect(card).toHaveClass('bg-accent-soft', 'border-accent-strong')
    expect(card.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Find new leads' })).not.toHaveClass('bg-accent-soft')
    expect(card.tabIndex).toBe(0)
    expect(picked()).toBe('watchlist')
  })

  it('moves the focus with the arrows, Home and End, and picks only on Space or Enter', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const cards = screen.getAllByRole('radio')
    await user.tab()
    expect(cards[0]).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(cards[1]).toHaveFocus()
    expect(picked()).toBe('discovery') // an arrow never picks
    await user.keyboard('{ArrowDown}')
    expect(cards[2]).toHaveFocus()
    await user.keyboard(' ')
    expect(picked()).toBe('watchlist')
    expect(cards[2]).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(cards[3]).toHaveFocus() // it wraps round
    await user.keyboard('{Home}')
    expect(cards[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(cards[3]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(picked()).toBe('company')
  })

  it('brings Tab back to the picked card, not to the one the arrows left the focus on', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <button type="button">After</button>
      </>,
    )
    const cards = screen.getAllByRole('radio')
    await user.tab()
    await user.keyboard('{ArrowRight}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(cards[0]).toHaveFocus()
  })

  it('skips a card that is switched off', async () => {
    const user = userEvent.setup()
    render(<Harness disabled={['tenure']} />)
    const cards = screen.getAllByRole('radio')
    expect(cards[1]).toBeDisabled()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(cards[2]).toHaveFocus()
  })
})
