/**
 * Home: one card per project, then the projects still to be developed. The cards come from
 * src/modules.ts, so a new project shows here by itself.
 *
 * A project's card works like a small table of contents, not a poster: its name and what it does,
 * where things stand now (the project's own summary, like the last run and the leads), then its
 * pages as rows, each with one line on what you do there. The whole row is the link.
 */
import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { PLANNED } from '@/modules'
import { useVisibleModules } from './visible-modules'
import type { AppModule, NavItem } from './nav'
import { TONE_CLASSES } from './tone'

/**
 * One page of a project. The link's name is the page's name; the line under it is read as its
 * description, so a screen reader hears "Runs, link, every run, newest first".
 */
function PageRow({ item }: { item: NavItem }) {
  const Icon = item.icon
  const purposeId = useId()
  return (
    <li>
      <Link
        to={item.to}
        aria-describedby={item.purpose ? purposeId : undefined}
        className="flex min-h-12 items-center gap-3 px-6 py-2.5 transition-colors duration-150 hover:bg-muted focus-visible:-outline-offset-2 touch:min-h-14"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold text-foreground">{item.label}</span>
          {item.purpose ? (
            <span id={purposeId} aria-hidden="true" className="text-caption text-muted-foreground">
              {item.purpose}
            </span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

function ProjectCard({ app }: { app: AppModule }) {
  const Icon = app.icon
  const Summary = app.summary
  const titleId = `home-${app.id}`
  return (
    <Card role="region" aria-labelledby={titleId} className="gap-0 py-0">
      <div className="flex flex-col gap-1 px-6 pt-6 pb-5">
        <h2 id={titleId} className="flex items-center gap-2 text-section font-semibold">
          <Icon
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0',
              app.tone ? TONE_CLASSES[app.tone].icon : 'text-muted-foreground',
            )}
          />
          {app.name}
        </h2>
        <p className="max-w-prose text-ui text-muted-foreground">{app.description}</p>
      </div>
      {Summary ? (
        <div className="border-t px-6 py-4">
          <Summary />
        </div>
      ) : null}
      <ul className="divide-y border-t">
        {app.pages.map((item) => (
          <PageRow key={item.to} item={item} />
        ))}
      </ul>
    </Card>
  )
}

export default function HomePage() {
  const modules = useVisibleModules()
  return (
    <>
      <PageHeader
        title="Home"
        description="Contour's AI projects in one place. Each card opens a project's pages."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {modules.map((app) => (
          <ProjectCard key={app.id} app={app} />
        ))}
      </div>
      {PLANNED.length > 0 ? (
        <section aria-labelledby="home-planned" className="flex flex-col gap-4">
          <h2 id="home-planned" className="text-section font-semibold text-foreground">
            To be developed
          </h2>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PLANNED.map(({ id, name, icon: Icon, to, description, status }) => (
              <li key={id}>
                <Card size="sm" className="h-full">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                      <h3>
                        <Link
                          to={to}
                          className="flex items-center gap-2 rounded-sm underline-offset-4 hover:underline"
                        >
                          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                          {name}
                        </Link>
                      </h3>
                      <Badge variant="outline">To be developed</Badge>
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-caption text-muted-foreground">{status}</CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
