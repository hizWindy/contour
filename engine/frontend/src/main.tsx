import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fonts come from Fontsource, so the app serves them itself (the CSP allows only our own files).
// Titillium Web: Regular 400 and SemiBold 600. IBM Plex Serif: empty states, welcome, quotes.
import '@fontsource/titillium-web/400.css'
import '@fontsource/titillium-web/600.css'
import '@fontsource/ibm-plex-serif/latin-400.css'
import '@fontsource/ibm-plex-serif/latin-ext-400.css'

import './styles/index.css'
import { createQueryClient } from './api/query'
import { App } from './App'
import { createAppRouter, routes } from './router'
import { prefetchOnNavigation } from './shell/prefetch'
import { preloadNextPages } from './shell/preload'
import { applyTheme, readThemeChoice } from './shell/theme'

// A light or dark choice made in the command menu, kept from the last visit.
applyTheme(readThemeChoice())

const root = document.getElementById('root')
if (!root) {
  throw new Error('index.html has no #root element')
}

// The page's data starts downloading with the page's code, not after it (PLAN-V7 C1). That needs
// the router and the cache before the first draw, so they are made here and handed to the app.
const queryClient = createQueryClient()
const router = createAppRouter()
prefetchOnNavigation(router, queryClient)

createRoot(root).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
)

// Once the first screen is up and the browser is idle: the code of the pages people open next.
preloadNextPages(routes)
