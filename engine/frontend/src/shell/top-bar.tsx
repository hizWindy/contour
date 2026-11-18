import { PanelLeft } from 'lucide-react'
import { Fragment, Suspense, useEffect, useState } from 'react'
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
import { useVisibleModules } from './visible-modules'

const APP_NAME = 'Contour'

/**
 * The buttons the projects bring (`AppModule.topBar`), like the Assistant's "Speak (V)" (PLAN-V22
 * T3-1), each in its own `Suspense`: they may load late, and show nothing till then. They sit
 * before Ctrl+K, so their coming moves nothing on the right of the bar.
 */
function ProjectButtons() {
  const modules = useVisibleModules()
  return modules.map((app) => {
    const Part = app.topBar
    return Part ? (
      <Suspense key={app.id} fallback={null}>
        <Part />
      </Suspense>
    ) : null
  })
}

/**
 * The bar above every page: the menu button, where you are (breadcrumbs), the projects' own
 * buttons, and the command menu. It also keeps the browser tab's title in step with the page.
 *
 * On a phone it also holds the account menu, and it stays at the top while the page scrolls, so
 * the account is always one tap away (PLAN-V15 T2-5).
 */
export function TopBar() {
  const { toggleSidebar, open, isMobile, openMobile } = useSidebar()
  const crumbs = crumbsOf(useMatches())
  const here = crumbs.at(-1)?.label

  const [scrolled, setScrolled] = useState(
    () => typeof window !== 'undefined' && window.scrollY > 0,
  )

  useEffect(() => {
    document.title = here ? `${here} - ${APP_NAME}` : APP_NAME
  }, [here])

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const expanded = isMobile ? openMobile : open
  return (
    <header
      data-scrolled={scrolled ? 'true' : undefined}
      className={`sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4 ${scrolled ? 'glass-bar' : 'bg-background'}`}
    >
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
      <ProjectButtons />
      <CommandMenu />
      {/* From a tablet up, the account is at the foot of the left menu. */}
      <UserMenu className="md:hidden" />
    </header>
  )
}
