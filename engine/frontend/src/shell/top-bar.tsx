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
import { UserMenu } from './user-menu'

const APP_NAME = 'Contour'

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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Show or hide the menu"
        aria-expanded={expanded}
        onClick={toggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </Button>
      {/* One line, however narrow: the earlier crumbs keep their words, and the page you are on
          shortens with "..." when it must. */}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-2">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.to}>
              {index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}
              <BreadcrumbItem className={index === crumbs.length - 1 ? 'min-w-0' : 'shrink-0'}>
                {index === crumbs.length - 1 ? (
                  <BreadcrumbPage className="block truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to} className="touch:py-2.5">
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <CommandMenu />
      {/* From a tablet up, the account is at the foot of the left menu. */}
      <UserMenu className="md:hidden" />
    </header>
  )
}
