/**
 * The projects on the website, in menu order. Each one is a module from its own folder under
 * src/apps/. The router, the sidebar, the command menu and Home all read this list, so adding a
 * project is its folder plus one line here.
 */
import { LEAD_FINDER } from '@/apps/lead-finder/module'
import type { AppModule } from '@/shell/nav'

export const MODULES: readonly AppModule[] = [LEAD_FINDER]
