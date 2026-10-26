import { Link, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { isWithin, NAV_ITEMS } from './nav'

/**
 * The left menu. It folds to icons (the icon keeps a tooltip with the page name), and each page
 * shows as selected while you are on it or inside it. Results also stays selected on a lead card.
 */
export function AppSidebar() {
  const { pathname } = useLocation()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex min-w-0 flex-col px-2 py-1 group-data-[collapsible=icon]:hidden">
          <span className="text-section font-semibold text-foreground">Lead Finder</span>
          <span className="text-caption text-muted-foreground">Contour Commercial Interiors</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Main menu">
              <SidebarMenu>
                {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                  const active =
                    isWithin(pathname, to) || (to === '/results' && isWithin(pathname, '/leads'))
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label}>
                        {/* A plain Link: this menu decides what counts as "here" (a lead card is in Results). */}
                        <Link to={to} aria-current={active ? 'page' : undefined}>
                          <Icon aria-hidden="true" className="size-5" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
