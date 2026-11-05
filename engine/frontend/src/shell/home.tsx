/**
 * Home: one card per project, with what it does and a link to each of its pages, then the projects
 * still to be developed. The cards come from src/modules.ts, so a new project shows here by itself.
 */
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { MODULES, PLANNED } from '@/modules'
import { TONE_CLASSES } from './tone'

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Home"
        description="Contour's AI projects in one place. Each card opens a project's pages."
      />
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((app) => {
          const Icon = app.icon
          return (
            <Card
              key={app.id}
              aria-labelledby={`home-${app.id}`}
              role="region"
              className={app.tone ? TONE_CLASSES[app.tone].line : undefined}
            >
              <CardHeader>
                <CardTitle>
                  <h2 id={`home-${app.id}`} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                        app.tone
                          ? TONE_CLASSES[app.tone].tile
                          : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    {app.name}
                  </h2>
                </CardTitle>
                <CardDescription>{app.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-2">
                  {app.pages.map(({ to, label, icon: PageIcon }) => (
                    <li key={to}>
                      <Button asChild variant="outline" size="sm">
                        <Link to={to}>
                          <PageIcon aria-hidden="true" />
                          {label}
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
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
