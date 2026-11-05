import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { asLaptop, asPhone } from '@/test/screen'
import { renderWithProviders } from '@/test/render'

const css = readFileSync(resolve(import.meta.dirname, '../styles/index.css'), 'utf8')
const button = readFileSync(resolve(import.meta.dirname, '../components/ui/button.tsx'), 'utf8')
const input = readFileSync(resolve(import.meta.dirname, '../components/ui/input.tsx'), 'utf8')

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ title: 'Not found', status: 404 }, { status: 404 })),
    ),
  )
})

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return renderWithProviders(<RouterProvider router={router} />, { withRouter: false })
}

const LAZY = 5000

describe('the menu on different screens', () => {
  it('opens wide on a laptop screen', async () => {
    asLaptop()
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })
    expect(document.querySelector('[data-slot=sidebar]')).toHaveAttribute('data-state', 'expanded')
  })

  it('starts folded to its icons on a tablet, so the page keeps the room', async () => {
    // A tablet: wider than a phone, narrower than a laptop. No min-width query matches.
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })
    expect(document.querySelector('[data-slot=sidebar]')).toHaveAttribute('data-state', 'collapsed')
  })
})

describe('the menu on a phone', () => {
  it('slides shut once a page is picked, and stays open when a project row is opened or closed', async () => {
    asPhone()
    const { user } = renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })
    const panel = () => document.querySelector('[data-mobile=true]')

    await user.click(screen.getByRole('button', { name: 'Show or hide the menu' }))
    expect(panel()).not.toBeNull()
    const menu = within(panel() as HTMLElement)

    // The project's own row only folds its list, so the menu stays open.
    await user.click(menu.getByRole('button', { name: 'Lead Finder' }))
    await user.click(menu.getByRole('button', { name: 'Lead Finder' }))
    expect(panel()).not.toBeNull()

    await user.click(menu.getByRole('link', { name: 'Start a run' }))
    await screen.findByRole('heading', { level: 1, name: 'Start a run' }, { timeout: LAZY })
    await vi.waitFor(() => {
      expect(panel()).toBeNull()
    })
  })
})

describe('the top bar on a phone', () => {
  it('keeps the search as a button with a name, though only its icon shows', async () => {
    asPhone()
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })
    // The top bar is the first header on the page (a page's own title is a header too).
    const bar = document.querySelector('header') as HTMLElement
    // The words are there for a screen reader (`sr-only`), and the Ctrl and K keys are not.
    const search = within(bar).getByRole('button', { name: /Go to a page/ })
    expect(within(search).getByText('Go to a page')).toHaveClass('max-sm:sr-only')
    expect(bar.querySelector('[data-slot=kbd-group]')).toHaveClass('touch:hidden')
  })

  it('keeps the breadcrumbs on one line', async () => {
    renderAt('/runs')
    await screen.findByRole('heading', { level: 1, name: 'Runs' }, { timeout: LAZY })
    expect(document.querySelector('[data-slot=breadcrumb-list]')).toHaveClass('flex-nowrap')
  })
})

describe('touch sizes', () => {
  it('count a phone and any touch screen: a coarse pointer, or under 640px', () => {
    expect(css).toMatch(
      /@custom-variant touch \{\s*@media \(pointer: coarse\), \(max-width: 639px\) \{\s*@slot;/,
    )
  })

  it('make buttons and fields 44px on touch, and field text 16px so iPhones do not zoom', () => {
    expect(button).toContain('default: "h-9 px-4 touch:h-11"')
    expect(button).toContain('icon: "size-9 touch:size-11"')
    expect(input).toContain('touch:h-11')
    expect(css).toMatch(
      /@media \(pointer: coarse\), \(max-width: 639px\) \{\s*input,\s*select,\s*textarea \{\s*font-size: 16px;/,
    )
  })
})
