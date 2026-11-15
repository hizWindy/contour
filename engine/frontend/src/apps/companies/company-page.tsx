/**
 * One company on its own page (PLAN-V10 B5), at /companies/:key, so it can be shared. The same view
 * as the dialog on the Companies page, with room to read, and the same "Prep a call", which opens
 * the prep panel on the right. On a phone (PLAN-V10 G1) "Prep a call" is a full-width button that
 * stays at the bottom of the screen. With call notes on (PLAN-V17 T3-5), "Log call" sits beside
 * it, and opens Log call's note view in the panel, which asks who the call was with.
 */
import { Building2, NotebookPen, PhoneCall } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useCompany } from '@/api/hooks'
import { useCallNoteOptions } from '@/api/hooks/call-notes'
import type { CompanyDetail, CompanyPerson } from '@/api/types'
import { BackButton } from '@/components/back-button'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { useBarRoom } from '@/lib/use-bar-room'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { LOG_CALL } from './call-notes/words'
import { CompanyActions } from './company-dialog'
import { CompanyView, CompanyViewPending } from './company-view'
import { companyPlace } from './words'
import type { PrepTarget } from './prep-box'
import { PrepSheet } from './prep-sheet'

export default function CompanyPage() {
  const { key = '' } = useParams()
  const company = useCompany(key)
  const [prep, setPrep] = useState<PrepTarget | null>(null)
  const phone = useMediaQuery(PHONE)
  // The bar at the bottom of a phone: what the keyboard lands on scrolls above it.
  const barRoom = useBarRoom()
  const prepCall =(detail: CompanyDetail, person: CompanyPerson | null): void => {
    setPrep({
      companyKey: detail.key,
      companyName: detail.name,
      person: person ? { id: person.id, name: person.name, title: person.title } : null,
    })
  }
  const notesOn = useCallNoteOptions().data?.enabled === true
  const logCall =
    notesOn && company.data
      ? () => {
          setPrep({
            companyKey: company.data.key,
            companyName: company.data.name,
            person: null,
            note: true,
          })
        }
      : undefined
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
              // On a phone "Prep a call" and "Log call" are the buttons at the bottom instead.
              onPrep={
                phone
                  ? undefined
                  : () => {
                      prepCall(company.data, null)
                    }
              }
              onLogCall={phone ? undefined : logCall}
            />
          ) : null
        }
      />
      {phone && company.data ? (
        <div
          ref={barRoom}
          data-slot="prep-bar"
          className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {logCall ? (
            <Button type="button" variant="outline" size="lg" onClick={logCall}>
              <NotebookPen aria-hidden="true" />
              {LOG_CALL}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="min-w-0 flex-1"
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
      <PrepSheet
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
