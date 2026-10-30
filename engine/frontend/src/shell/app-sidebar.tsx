import { Link, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { MODULES, PLANNED } from '@/modules'
import { ADMIN, HOME, isHere, type NavItem } from './nav'

const PLANNED_LABEL_ID = 'menu-planned'

function MenuLink({
  item,
  pathname,
  planned = false,
}: {
  item: NavItem
  pathname: string
  /** A project still to be developed: quieter text, and the tooltip says so. */
  planned?: boolean
}) {
  const Icon = item.icon
  const here = isHere(pathname, item)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={here}
        tooltip={planned ? `${item.label} (to be developed)` : item.label}
        className={planned && !here ? 'text-muted-foreground' : undefined}
      >
        {/* A plain Link: this menu decides what counts as "here" (a lead card is in Results). */}
        <Link to={item.to} aria-current={here ? 'page' : undefined}>
          <Icon aria-hidden="true" className="size-5" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * The left menu: Home, then one group per project with its own pages (from src/modules.ts), the
 * projects still to be developed, and the shared Admin at the bottom. It folds to icons: the group names hide, and each icon keeps a
 * tooltip with the page name. A page shows as selected while you are on it or inside it.
 */
export function AppSidebar() {
  const { pathname } = useLocation()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex min-w-0 flex-col px-2 py-1 group-data-[collapsible=icon]:hidden">
          <span className="text-section font-semibold text-foreground">Contour</span>
          <span className="text-caption text-muted-foreground">Commercial Interiors</span>
        </div>
      </SidebarHeader>
      <nav aria-label="Main menu" className="flex min-h-0 flex-1 flex-col">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <MenuLink item={HOME} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {MODULES.map((app) => {
            const Icon = app.icon
            const labelId = `menu-${app.id}`
            return (
              <SidebarGroup key={app.id} role="group" aria-labelledby={labelId}>
                <SidebarGroupLabel id={labelId} className="gap-2">
                  <Icon aria-hidden="true" />
                  <span>{app.name}</span>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {app.pages.map((item) => (
                      <MenuLink key={item.to} item={item} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })}
          {PLANNED.length > 0 ? (
            <SidebarGroup role="group" aria-labelledby={PLANNED_LABEL_ID}>
              <SidebarGroupLabel id={PLANNED_LABEL_ID}>To be developed</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {PLANNED.map(({ to, name, icon }) => (
                    <MenuLink
                      key={to}
                      item={{ to, label: name, icon }}
                      pathname={pathname}
                      planned
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <MenuLink item={ADMIN} pathname={pathname} />
          </SidebarMenu>
        </SidebarFooter>
      </nav>
      <SidebarRail />
    </Sidebar>
  )
}
