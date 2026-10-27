/** One lead on its own page, so it can be shared. Results also shows it in a side panel. */
import { useParams } from 'react-router'
import { useLead } from '@/api/hooks'
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
    return <EmptyState title="Loading the lead." />
  }
  return (
    <>
      <PageHeader
        title={lead.data.company}
        description={lead.data.facts.industry.value ?? undefined}
      />
      <LeadCardView lead={lead.data} />
    </>
  )
}
