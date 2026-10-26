import { PanelLeft } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { Link, useMatches } from 'react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { CommandMenu } from './command-menu'
import { crumbsOf } from './crumbs'

const APP_NAME = 'Lead Finder'

/**
 * The bar above every page: the menu button, where you are (breadcrumbs), and the command menu.
 * It also keeps the browser tab's title in step with the page.
 */
export function TopBar() {
  const { toggleSidebar, open, isMobile, openMobile } = useSidebar()
  const crumbs = crumbsOf(useMatches())
  const here = crumbs.at(-1)?.label

  useEffect(() => {
    document.title = here ? `${here} - ${APP_NAME}` : APP_NAME
  }, [here])

  const expanded = isMobile ? openMobile : open
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Show or hide the menu"
        aria-expanded={expanded}
        onClick={toggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </Button>
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.to}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {index === crumbs.length - 1 ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <CommandMenu />
    </header>
  )
}
