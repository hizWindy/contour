import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Collapsible, CollapsibleContent } from './collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

/*
  The quiet fades of the shared parts (Improvements 1, #8): a tab's content comes up when the tab
  is picked, and a list opened by a collapsible fades in and settles 4px from above. Closing is at
  once: a height can't animate (DESIGN.md "Motion"), so a fade-out would only delay the jump.
*/

describe('the shared parts that fade', () => {
  it('brings up the content of a tab in 150ms when it is picked', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First tab</TabsContent>
      </Tabs>,
    )
    const content = screen.getByText('First tab')
    expect(content).toHaveClass('animate-in', 'fade-in-0', 'duration-150')
    // A tab's content is only on the page while its tab is shown, so it fades each time.
    expect(content).toHaveAttribute('data-slot', 'tabs-content')
  })

  it('opens a collapsible with a fade and a settle in 250ms, and closes it at once', () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleContent>The list</CollapsibleContent>
      </Collapsible>,
    )
    const content = screen.getByText('The list')
    expect(content).toHaveClass(
      'data-open:animate-in',
      'data-open:fade-in-0',
      'data-open:slide-in-from-top-1',
      'data-open:duration-250',
    )
    // No exit animation: Radix would keep the list on the page until it ended.
    expect(content.className).not.toContain('animate-out')
    expect(content.className).not.toContain('data-closed')
  })
})
