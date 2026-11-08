/**
 * One company on its own page (PLAN-V10 B5), at /companies/:key, so it can be shared. The same view
 * as the panel, with room to read, and the same "Prep a call".
 */
import { Building2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useCompany } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson } from '@/api/types'
import { BackButton } from '@/components/back-button'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { CompanyActions } from './company-panel'
import { CompanyView, CompanyViewPending } from './company-view'
import { companyPlace } from './words'
import type { PrepTarget } from './prep-box'
import { PrepModal } from './prep-modal'

export default function CompanyPage() {
  const { key = '' } = useParams()
  const company = useCompany(key)
  const [prep, setPrep] = useState<PrepTarget | null>(null)
  const prepCall = (detail: CompanyDetail, person: CompanyPerson | null): void => {
    setPrep({
      companyKey: detail.key,
      companyName: detail.name,
      person: person ? { id: person.id, name: person.name, title: person.title } : null,
    })
  }
  return (
    <>
      <BackButton fallbackTo="/companies" fallbackLabel="Companies" />
      <PageHeader
        icon={Building2}
        tone="companies"
        title={company.data?.name ?? 'Company'}
        description={
          company.data
            ? companyPlace(company.data) || 'What we know about this company.'
            : 'What we know about this company.'
        }
        actions={
          company.data ? (
            <CompanyActions
              company={company.data}
              onPrep={() => {
                prepCall(company.data, null)
              }}
            />
          ) : null
        }
      />
      <div className="max-w-4xl">
        {company.error ? (
          <ErrorState
            error={company.error}
            context="This company couldn't be loaded."
            onRetry={() => void company.refetch()}
          />
        ) : company.data ? (
          <div className="animate-in duration-150 fade-in-0">
            <CompanyView
              company={company.data}
              onPrep={(person) => {
                prepCall(company.data, person)
              }}
            />
          </div>
        ) : (
          <CompanyViewPending />
        )}
      </div>
      <PrepModal
        target={prep}
        onClose={() => {
          setPrep(null)
        }}
        onChangeTarget={setPrep}
      />
    </>
  )
}
