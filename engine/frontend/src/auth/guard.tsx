/**
 * Route and screen guards for roles and ticks (PLAN-V19 T3-2, T3-4).
 *
 * The backend enforces every rule on its routes too. Guarding a screen prevents showing
 * controls and making calls that would answer 403, and replaces disallowed direct URLs with a
 * plain message pointing to the Platform admin.
 */
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router'
import { useMe } from '@/api/hooks/auth'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { canUse, isPlatformAdmin, noAccessWords, type Feature } from './can'

function BackHomeAction() {
  if (!useInRouterContext()) return null
  return (
    <Button asChild variant="outline">
      <Link to="/">Back to Home</Link>
    </Button>
  )
}

export function PlatformAdminGuard({
  children,
  message = 'Only the Platform admin can open Admin settings.',
}: {
  children: ReactNode
  message?: string
}) {
  const me = useMe().data
  if (me?.state === 'signed_out') return null
  if (me?.state === 'signed_in' && !isPlatformAdmin(me)) {
    return (
      <EmptyState
        icon={Lock}
        headingLevel={1}
        title="Platform admin only"
        description={message}
        action={<BackHomeAction />}
      />
    )
  }
  return <>{children}</>
}

export function FeatureGuard({
  feature,
  page,
  children,
}: {
  feature: Feature | readonly Feature[]
  page: string
  children: ReactNode
}) {
  const me = useMe().data
  if (me?.state === 'signed_out') return null
  const required = typeof feature === 'string' ? [feature] : feature
  if (me?.state === 'signed_in' && !canUse(me, ...required)) {
    return (
      <EmptyState
        icon={Lock}
        headingLevel={1}
        title="Not open to you"
        description={noAccessWords(page, me.platformAdminName)}
        action={<BackHomeAction />}
      />
    )
  }
  return <>{children}</>
}
