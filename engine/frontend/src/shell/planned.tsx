/**
 * The page of a project still to be developed: what it will do and where it stands. It sits at the
 * address the project will use, so the menu link keeps working once the project is built.
 */
import { useLocation } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { PLANNED } from '@/modules'
import { isWithin } from './nav'
import { NotFound } from './route-error'

export default function PlannedPage() {
  const { pathname } = useLocation()
  const project = PLANNED.find((planned) => isWithin(pathname, planned.to))
  if (!project) {
    return <NotFound />
  }
  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description}
        actions={<Badge variant="outline">To be developed</Badge>}
      />
      <EmptyState
        icon={project.icon}
        title="This project is still to be developed."
        description={project.status}
      />
    </>
  )
}
