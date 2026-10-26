import { NavLink, Outlet } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { ADMIN_TABS } from '@/shell/nav'

/**
 * The Admin page: its tabs are links (each tab has its own address, so a tab can be shared and
 * the back button works), and the open tab shows below them.
 */
export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Admin"
        description="Runs and cost, the search log, memory, HubSpot, the rules, the test set and the settings."
      />
      <nav aria-label="Admin sections" className="-mt-2 flex flex-wrap gap-1 border-b">
        {ADMIN_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                '-mb-px flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-ui transition-colors duration-(--duration-fast) ease-(--ease)',
                isActive
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )
            }
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
