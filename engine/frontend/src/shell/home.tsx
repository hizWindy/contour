/**
 * Home: one card per project, with what it does and a link to each of its pages. The cards come
 * from src/modules.ts, so a new project shows here by itself.
 */
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MODULES } from '@/modules'

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
            <Card key={app.id} aria-labelledby={`home-${app.id}`} role="region">
              <CardHeader>
                <CardTitle>
                  <h2 id={`home-${app.id}`} className="flex items-center gap-2">
                    <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
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
    </>
  )
}
