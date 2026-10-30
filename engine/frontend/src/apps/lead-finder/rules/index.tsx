/**
 * Rules: the rules each company is checked against, read only. A Lead Finder page of its own (it
 * was an Admin tab); the view itself is still in admin/rules.tsx.
 */
import { PageHeader } from '@/components/page-header'
import RulesView from '../admin/rules'

export default function RulesPage() {
  return (
    <>
      <PageHeader
        title="Rules"
        description="The rules that decide each lead's result: cities, company size and signs of an office change. Read only. Points marked TBC still wait for Levi."
      />
      <RulesView />
    </>
  )
}
