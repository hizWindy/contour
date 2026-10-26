import { Hammer } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

export interface PageStubProps {
  /** The page title, the same as in the menu. */
  title: string
  /** One sentence on what the page will do. */
  purpose: string
  /** Render the title as the page's `h1` (default). Admin tabs already have one, so they pass false. */
  withHeader?: boolean
}

/**
 * An honest placeholder for a page that is not built yet. Each page's own folder replaces it.
 */
export function PageStub({ title, purpose, withHeader = true }: PageStubProps) {
  return (
    <>
      {withHeader ? <PageHeader title={title} description={purpose} /> : null}
      <EmptyState
        icon={Hammer}
        title="This page is being built."
        description={withHeader ? 'It comes in a later step of this build.' : purpose}
        headingLevel={withHeader ? 2 : 3}
      />
    </>
  )
}
