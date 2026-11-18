/**
 * The order of the projects in Ctrl+K (`command-menu.tsx`) while something is typed.
 *
 * The menu (cmdk) sorts the entries inside a project by how well they match, but never the
 * projects themselves: cmdk 1.1's group sort looks each group up by a value it never writes, so it
 * finds none. And Enter takes the first entry that matches at all. So a page that only brushes past
 * the letters in an earlier project would win over the page asked for: "csv" opened Call logs
 * ("activity" has a "v") instead of Results, once the Assistant came before the Lead Finder in the
 * menu (PLAN-V22 T2-1). Here the projects go in the order of their best page instead.
 */
import { defaultFilter } from 'cmdk'
import type { SignIn } from '@/api/hooks/auth'
import type { AppModule, NavItem } from './nav'
import { visiblePages } from './visible-modules'

/** What Ctrl+K matches a page by: its name and address, then its other words (`keywords`). */
export function pageValue(item: NavItem): string {
  return `${item.label} ${item.to}`
}

/**
 * The projects in the order their best page matches `search`, scored as the menu scores it. While
 * nothing is typed, and for a tie, they keep the menu's order.
 */
export function byBestMatch(
  modules: readonly AppModule[],
  signIn: SignIn | undefined,
  search: string,
): readonly AppModule[] {
  const typed = search.trim()
  if (typed === '') return modules
  const best = (app: AppModule): number =>
    Math.max(
      0,
      ...visiblePages(signIn, app.pages).map((item) =>
        defaultFilter(pageValue(item), typed, item.keywords),
      ),
    )
  return modules
    .map((app, index) => ({ app, index, score: best(app) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ app }) => app)
}
