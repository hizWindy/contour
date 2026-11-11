import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { PLANNED } from '@/modules'
import { useVisibleModules } from './visible-modules'
import { ADMIN, HOME, isHere, isWithin, type AppModule, type NavItem } from './nav'
import { TONE_CLASSES } from './tone'
import { SidebarAccount } from './user-menu'
import { cn } from '@/lib/utils'

const PLANNED_LABEL_ID = 'menu-planned'

/**
 * On a phone the menu is a panel over the page, so picking a page slides it shut and shows the
 * page. A project's own row only opens or closes its list, so it leaves the panel open. On a
 * laptop or tablet the menu stays where it is.
 */
function useCloseOnPhone(): () => void {
  const { isMobile, setOpenMobile } = useSidebar()
  return () => {
    if (isMobile) setOpenMobile(false)
  }
}

function MenuLink({
  item,
  pathname,
  planned = false,
  iconClassName,
}: {
  item: NavItem
  pathname: string
  /** A project still to be developed: quieter text, and the tooltip says so. */
  planned?: boolean
  /** A project's own colour on its icon (a one-page project's link). */
  iconClassName?: string
}) {
  const Icon = item.icon
  const here = isHere(pathname, item)
  const closeOnPhone = useCloseOnPhone()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={here}
        tooltip={planned ? `${item.label} (to be developed)` : item.label}
        className={planned && !here ? 'text-muted-foreground' : undefined}
      >
        {/* A plain Link: this menu decides what counts as "here" (a lead card is in Results). */}
        <Link to={item.to} aria-current={here ? 'page' : undefined} onClick={closeOnPhone}>
          <Icon aria-hidden="true" className={cn('size-5', iconClassName)} />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** A page inside a project's dropdown, indented under the project's name. */
function SubLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon
  const here = isHere(pathname, item)
  const closeOnPhone = useCloseOnPhone()
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={here}
        className="h-9 touch:h-11 data-active:font-semibold [&>svg]:size-5"
      >
        <Link to={item.to} aria-current={here ? 'page' : undefined} onClick={closeOnPhone}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

/**
 * One project in the menu: a row with its name that opens and closes like a dropdown, with its
 * pages indented under it. It starts open. Closed, the row is marked when you are on one of its
 * pages, so you still see where you are.
 *
 * When the whole menu is folded to icons there is no room for the row, so the pages show as plain
 * icons (each with its name as a tooltip), and they can always be reached.
 */
function ModuleGroup({ app, pathname }: { app: AppModule; pathname: string }) {
  const { state, isMobile } = useSidebar()
  const [open, setOpen] = useState(true)
  const Icon = app.icon
  const labelId = `menu-${app.id}`

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarGroup role="group" aria-labelledby={labelId}>
        <SidebarGroupLabel id={labelId}>{app.name}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {app.pages.map((item) => (
              <MenuLink key={item.to} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const inside = app.pages.some((item) => isHere(pathname, item))
  return (
    <SidebarGroup role="group" aria-labelledby={labelId}>
      <SidebarMenu>
        <Collapsible asChild open={open} onOpenChange={setOpen}>
          <SidebarMenuItem className="group/collapsible">
            <CollapsibleTrigger asChild>
              <SidebarMenuButton id={labelId} isActive={!open && inside}>
                <Icon
                  aria-hidden="true"
                  className={app.tone ? TONE_CLASSES[app.tone].icon : undefined}
                />
                <span className="truncate">{app.name}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="ml-auto size-4! transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]/collapsible:rotate-90"
                />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {app.pages.map((item) => (
                  <SubLink key={item.to} item={item} pathname={pathname} />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * The projects still to be developed. Home shows them as cards, so here they fold into one quiet
 * row that starts closed, and opens by itself on one of their pages. Folded to icons, the menu
 * shows each one's icon (with its name as a tooltip), so they can always be reached.
 */
function PlannedGroup({ pathname }: { pathname: string }) {
  const { state, isMobile } = useSidebar()
  const inside = PLANNED.some((project) => isWithin(pathname, project.to))
  const [open, setOpen] = useState(inside)
  // Opening one of their pages opens the row (set while rendering, not in an effect).
  const [wasInside, setWasInside] = useState(inside)
  if (inside !== wasInside) {
    setWasInside(inside)
    if (inside) setOpen(true)
  }
  const links = (
    <SidebarMenu>
      {PLANNED.map(({ to, name, icon }) => (
        <MenuLink key={to} item={{ to, label: name, icon }} pathname={pathname} planned />
      ))}
    </SidebarMenu>
  )

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarGroup role="group" aria-labelledby={PLANNED_LABEL_ID}>
        <SidebarGroupLabel id={PLANNED_LABEL_ID}>To be developed</SidebarGroupLabel>
        <SidebarGroupContent>{links}</SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarGroup role="group" aria-labelledby={PLANNED_LABEL_ID} className="group/planned">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            id={PLANNED_LABEL_ID}
            className="w-full justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span>To be developed</span>
            <span className="flex items-center gap-1.5">
              {open ? null : (
                <span aria-hidden="true" className="text-caption tabular-nums">
                  {PLANNED.length}
                </span>
              )}
              <ChevronRight
                aria-hidden="true"
                className="size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]/planned:rotate-90"
              />
            </span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{links}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/**
 * The left menu: Home, then one dropdown per project with its own pages (from src/modules.ts), the
 * projects still to be developed (one row that starts closed), and the shared Admin at the bottom, with the signed-in person's
 * name and role under it (PLAN-V13 T1-6). It folds to icons, and each icon keeps a tooltip with
 * the page name. A page shows as selected while you are on it or inside
 * it.
 */
export function AppSidebar() {
  const { pathname } = useLocation()
  const modules = useVisibleModules()
  // A project with one page is a plain link under Home, not a dropdown (PLAN-V10 B1).
  const single = modules.filter((app) => app.pages.length === 1)
  const grouped = modules.filter((app) => app.pages.length !== 1)
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
                {single.map((app) =>
                  app.pages[0] ? (
                    <MenuLink
                      key={app.id}
                      item={app.pages[0]}
                      pathname={pathname}
                      iconClassName={app.tone ? TONE_CLASSES[app.tone].icon : undefined}
                    />
                  ) : null,
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {grouped.map((app) => (
            <ModuleGroup key={app.id} app={app} pathname={pathname} />
          ))}
          {PLANNED.length > 0 ? <PlannedGroup pathname={pathname} /> : null}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <MenuLink item={ADMIN} pathname={pathname} />
            <SidebarAccount />
          </SidebarMenu>
        </SidebarFooter>
      </nav>
      <SidebarRail />
    </Sidebar>
  )
}
