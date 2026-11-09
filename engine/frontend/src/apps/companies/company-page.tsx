/**
 * One company on its own page (PLAN-V10 B5), at /companies/:key, so it can be shared. The same view
 * as the panel, with room to read, and the same "Prep a call". On a phone (PLAN-V10 G1) "Prep a
 * call" is a full-width button that stays at the bottom of the screen.
 */
import { Building2, PhoneCall } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useCompany } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson } from '@/api/types'
import { BackButton } from '@/components/back-button'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { CompanyActions } from './company-panel'
import { CompanyView, CompanyViewPending } from './company-view'
import { companyPlace } from './words'
import type { PrepTarget } from './prep-box'
import { PrepModal } from './prep-modal'

export default function CompanyPage() {
  const { key = '' } = useParams()
  const company = useCompany(key)
  const [prep, setPrep] = useState<PrepTarget | null>(null)
  const phone = useMediaQuery(PHONE)
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
              // On a phone "Prep a call" is the button at the bottom of the screen instead.
              onPrep={
                phone
                  ? undefined
                  : () => {
                      prepCall(company.data, null)
                    }
              }
            />
          ) : null
        }
      />
      {phone && company.data ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => {
              prepCall(company.data, null)
            }}
          >
            <PhoneCall aria-hidden="true" />
            Prep a call
          </Button>
        </div>
      ) : null}
      {/* On a phone the page ends above the button at the bottom. */}
      <div className="max-w-4xl max-sm:pb-20">
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
        // This page is the company already: "Company info" brings it back into view.
        onOpenCompany={() => {
          setPrep(null)
        }}
      />
    </>
  )
}
