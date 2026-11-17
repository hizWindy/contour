/** Every run, newest first. A row opens the run. */
import { ListChecks } from 'lucide-react'
import { Link } from 'react-router'
import { useCanWrite } from '@/auth/can'
import { FeatureGuard } from '@/auth/guard'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { RunsTable } from './runs-table'

function RunsContent() {
  const canStart = useCanWrite('lead_finder.start_run')
  return (
    <>
      <PageHeader
        icon={ListChecks}
        tone="lead"
        title="Runs"
        description="Every run, newest first. Open one to watch it or see what it found."
        actions={
          canStart ? (
            <Button asChild>
              <Link to="/start">Start a run</Link>
            </Button>
          ) : undefined
        }
      />
      <RunsTable />
    </>
  )
}

export default function RunsPage() {
  return (
    <FeatureGuard feature={['lead_finder.start_run', 'lead_finder.results']} page="Runs">
      <RunsContent />
    </FeatureGuard>
  )
}
