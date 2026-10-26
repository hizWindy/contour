import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fonts come from Fontsource, so the app serves them itself (the CSP allows only our own files).
// Titillium Web: Regular 400 and SemiBold 600. IBM Plex Serif: empty states, welcome, quotes.
import '@fontsource/titillium-web/400.css'
import '@fontsource/titillium-web/600.css'
import '@fontsource/ibm-plex-serif/latin-400.css'
import '@fontsource/ibm-plex-serif/latin-ext-400.css'

import './styles/index.css'
import { App } from './App'

const root = document.getElementById('root')
if (!root) {
  throw new Error('index.html has no #root element')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
