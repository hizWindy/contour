/**
 * Home (the "bento" Home, 11 Nov, from Al-khair's draft in inspirations/): a greeting, then the
 * projects as a grid of cards, then the projects still to be developed.
 *
 * - **The greeting** says good morning to the person by first name, with the date over it, and one
 *   sentence from each project under it (the Lead Finder says what its last run did).
 * - **The cards** come from src/modules.ts. A project with its own Home cards (`homeCards`) shows
 *   them; its main card is two columns wide on a laptop, with the narrow cards stacked beside it. A
 *   project without its own cards gets the plain card: its name, what it does, where it stands and
 *   its pages as rows. "Runs and cost" is shared, like the Admin tab it opens, and comes last.
 * - **To be developed:** a card for each project with a place in the queue ("Next", "Third"), and
 *   one "Later" card listing the rest.
 *
 * The cards fade and rise once, one after another (Reveal). With reduced motion they are simply
 * there. The contour lines behind the greeting are decoration only, hidden on a phone.
 */
import { ChevronRight } from 'lucide-react'
import { m } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMe } from '@/api/hooks'
import { EmptyState } from '@/components/empty-state'
import { Reveal, springs, useStill } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { PLANNED } from '@/modules'
import { RunsCostCard } from './home-cost'
import { firstName, greetingWord, longDate } from './home-words'
import { useVisibleModules } from './visible-modules'
import type { AppModule, HomeCard, NavItem, PlannedModule } from './nav'
import { TONE_CLASSES } from './tone'

/**
 * One page of a project, on its plain card. The link's name is the page's name; the line under it
 * is read as its description, so a screen reader hears "Runs, link, every run, newest first".
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

/** The plain card, for a project that brings no Home cards of its own. */
function PlainCard({ app }: { app: AppModule }) {
  const Icon = app.icon
  const Summary = app.summary
  const titleId = `home-${app.id}`
  return (
    <Card role="region" aria-labelledby={titleId} className="h-full gap-0 py-0">
      <div className="flex items-start gap-3 px-6 pt-6 pb-5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            app.tone ? TONE_CLASSES[app.tone].tile : 'bg-secondary text-muted-foreground',
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="text-section font-semibold text-foreground">
            {app.name}
          </h2>
          <p className="max-w-prose text-ui text-muted-foreground">{app.description}</p>
        </div>
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

/** Contour lines, like a map's: decoration behind the greeting, drawn once and then still. */
function ContourLines() {
  const still = useStill()
  const rings = [0, 1, 2, 3, 4, 5, 6, 7]
  return (
    <m.svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 480 220"
      className="pointer-events-none absolute -top-10 right-0 hidden h-56 w-auto text-border md:block"
      initial={still ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...springs.smooth, delay: 0.1 }}
      style={{ transformOrigin: '75% 60%' }}
    >
      {rings.map((ring) => (
        <ellipse
          key={ring}
          cx={340 - ring * 6}
          cy={150 - ring * 3}
          rx={26 + ring * 30}
          ry={14 + ring * 19}
          transform={`rotate(${String(-8 + ring * 1.5)} ${String(340 - ring * 6)} ${String(150 - ring * 3)})`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
        />
      ))}
    </m.svg>
  )
}

/** The date, the greeting and one sentence from each project. */
function Greeting({ modules }: { modules: readonly AppModule[] }) {
  const me = useMe().data
  const now = new Date()
  const name = me?.state === 'signed_in' ? firstName(me.user.name) : ''
  const lines = modules.flatMap((app) => (app.homeLine ? [{ id: app.id, Line: app.homeLine }] : []))
  return (
    <header data-slot="page-header" className="relative flex flex-col gap-2 overflow-hidden pt-2">
      <ContourLines />
      <p className="relative text-ui text-muted-foreground">{longDate(now)}</p>
      <h1 className="relative text-display font-semibold text-foreground">
        {greetingWord(now.getHours())}
        {name ? `, ${name}` : ''}
      </h1>
      {lines.length > 0 ? (
        <p className="relative max-w-2xl text-body text-muted-foreground">
          {lines.map(({ id, Line }, index) => (
            <span key={id}>
              {index > 0 ? ' ' : null}
              <Line />
            </span>
          ))}
        </p>
      ) : null}
    </header>
  )
}

interface Placed {
  key: string
  wide: boolean
  node: ReactNode
}

/** Every card in order: each project's own cards (or its plain card), then Runs and cost. */
function placeCards(modules: readonly AppModule[]): Placed[] {
  const placed: Placed[] = modules.flatMap((app) =>
    app.homeCards && app.homeCards.length > 0
      ? app.homeCards.map(({ id, component: Component, wide }: HomeCard) => ({
          key: id,
          wide: wide === true,
          node: <Component />,
        }))
      : [{ key: app.id, wide: false, node: <PlainCard app={app} /> }],
  )
  return modules.length > 0
    ? [...placed, { key: 'runs-cost', wide: false, node: <RunsCostCard /> }]
    : placed
}

function Cards({ modules }: { modules: readonly AppModule[] }) {
  const placed = placeCards(modules)
  // A wide card is two rows tall only when two narrow cards can stand beside it.
  const tall = placed.filter((card) => !card.wide).length >= 2
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-flow-dense lg:grid-cols-3">
      {placed.map((card, index) => (
        <Reveal
          key={card.key}
          index={index}
          className={cn(
            'min-w-0',
            card.wide && 'lg:col-span-2',
            card.wide && tall && 'lg:row-span-2',
          )}
        >
          {card.node}
        </Reveal>
      ))}
    </div>
  )
}

/** A project in the queue, with its own card. */
function QueuedCard({ project }: { project: PlannedModule }) {
  const Icon = project.icon
  return (
    <div className="flex h-full flex-col gap-3 rounded-lg bg-secondary p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0">
          <Link
            to={project.to}
            className="flex items-center gap-2 rounded-sm text-section font-semibold text-foreground underline-offset-4 hover:underline"
          >
            <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <span className="truncate">{project.name}</span>
          </Link>
        </h3>
        {project.when ? (
          <span className="shrink-0 text-caption text-muted-foreground">{project.when}</span>
        ) : null}
      </div>
      <p className="flex-1 text-ui text-foreground">{project.short ?? project.description}</p>
      <p className="text-caption text-muted-foreground">{project.needs ?? project.status}</p>
    </div>
  )
}

/** The projects with no place in the queue yet, as rows. */
function LaterCard({ projects }: { projects: readonly PlannedModule[] }) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-lg bg-secondary p-5">
      <h3 className="text-caption text-muted-foreground">Later</h3>
      <ul className="-mx-2 flex flex-col">
        {projects.map(({ id, name, icon: Icon, to }) => (
          <li key={id}>
            <Link
              to={to}
              className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-ui font-semibold text-foreground transition-colors duration-150 hover:bg-muted touch:min-h-12"
            >
              <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{name}</span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Planned() {
  if (PLANNED.length === 0) return null
  const queued = PLANNED.filter((project) => project.when)
  const later = PLANNED.filter((project) => !project.when)
  return (
    <section aria-labelledby="home-planned" className="flex flex-col gap-4">
      <h2 id="home-planned" className="text-ui font-semibold text-muted-foreground">
        To be developed
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {queued.map((project) => (
          <li key={project.id}>
            <QueuedCard project={project} />
          </li>
        ))}
        {later.length > 0 ? (
          <li>
            <LaterCard projects={later} />
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export default function HomePage() {
  const modules = useVisibleModules()
  return (
    <>
      <Greeting modules={modules} />
      {modules.length > 0 ? (
        <Cards modules={modules} />
      ) : (
        <EmptyState
          title="No projects are open to you yet."
          description="Ask an Admin to tick a project for you on the People tab."
        />
      )}
      <Planned />
    </>
  )
}
