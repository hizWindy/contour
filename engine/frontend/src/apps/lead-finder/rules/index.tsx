/**
 * Rules: the rules each company is checked against, read only. A Lead Finder page of its own (it
 * was an Admin tab). The view is view.tsx, next to this file.
 */
import { ScrollText } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import RulesView from './view'

export default function RulesPage() {
  return (
    <>
      <PageHeader
        icon={ScrollText}
        tone="lead"
        title="Rules"
        description="The rules that decide each lead's result: cities, company size and signs of an office change. Read only. Points marked TBC still wait for Levi."
      />
      <RulesView />
    </>
  )
}
