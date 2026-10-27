/**
 * One lead on its own page, so it can be shared. Results also shows it in a side panel. A back
 * button above the title returns to where the person came from (the list, a run, a search).
 */
import { useParams } from 'react-router'
import { useLead } from '@/api/hooks'
import { BackButton } from '@/components/back-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { LeadCardView } from './lead-card-view'

export default function LeadPage() {
  const { leadId = '' } = useParams()
  const lead = useLead(leadId)
  if (lead.error) {
    return (
      <>
        <BackButton fallbackTo="/results" fallbackLabel="Results" />
        <PageHeader title="Lead" />
        <ErrorState
          error={lead.error}
          context="This lead couldn't be loaded."
          onRetry={() => void lead.refetch()}
        />
      </>
    )
  }
  if (!lead.data) {
    return (
      <>
        <BackButton fallbackTo="/results" fallbackLabel="Results" />
        <EmptyState title="Loading the lead." />
      </>
    )
  }
  return (
    <>
      <BackButton fallbackTo="/results" fallbackLabel="Results" />
      <PageHeader
        title={lead.data.company}
        description={lead.data.facts.industry.value ?? undefined}
      />
      <LeadCardView lead={lead.data} />
    </>
  )
}
