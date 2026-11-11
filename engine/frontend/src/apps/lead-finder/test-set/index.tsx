/**
 * Test set: run the 10 public test companies and compare the scores over time. A Lead Finder page
 * of its own (it was an Admin tab). The view is view.tsx, next to this file.
 */
import { FlaskConical } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import TestSetView from './view'

export default function TestSetPage() {
  return (
    <>
      <PageHeader
        icon={FlaskConical}
        tone="lead"
        title="Test set"
        description="Ten public companies to check that a change to a prompt or a rule has not made results worse. Running it costs money."
      />
      <TestSetView />
    </>
  )
}
