/** Every run, newest first. A row opens the run. */
import { ListChecks } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { RunsTable } from './runs-table'

export default function RunsPage() {
  return (
    <>
      <PageHeader
        icon={ListChecks}
        tone="lead"
        title="Runs"
        description="Every run, newest first. Open one to watch it or see what it found."
        actions={
          <Button asChild>
            <Link to="/start">Start a run</Link>
          </Button>
        }
      />
      <RunsTable />
    </>
  )
}
