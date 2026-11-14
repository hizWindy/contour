---
name: speed-check
description: Measure and improve how fast Contour's Lead Finder website (engine/frontend) loads and responds. Use when a page feels slow, before a release, after adding a library, or when asked about bundle size, Core Web Vitals, Lighthouse or principles item 07.
---

# Speed check

## Targets

Google's Core Web Vitals. A page is "good" when 75% of visits meet all three:

| Metric | Measures | Good |
|---|---|---|
| LCP (Largest Contentful Paint) | When the main content shows | 2.5 seconds or less |
| INP (Interaction to Next Paint) | How fast the page reacts to a click or key | 200ms or less |
| CLS (Cumulative Layout Shift) | How much the layout jumps | 0.1 or less |

DESIGN.md adds a motion budget: no animation in a table of more than 50 rows, and no dropped frames at 4x CPU slowdown on the Schedules control, a tab switch and the Companies table.

Use INP, not FID. Item 07 still lists FID, which Google replaced in March 2024.

## Steps

1. **Measure before changing,** and write the numbers down.
   - **Bundle:** from `engine/frontend/`, run `node scripts/bundle-report.js`. It shows the first visit and each page, in gzip.
   - **Lighthouse:** build for production (`npm run build`, then `npm run preview`). Then run Lighthouse in Chrome DevTools. `npx lighthouse <url>` also works, but it downloads a package, so ask first. How to measure pages behind sign-in is TBC.
   - **Big data:** the 10,001-lead fake database and the fake backend on port 8010 (AGENTS.md, Commands). Never the real database.
2. **Find the cause in the code,** tied to a metric. "Feels heavy" is a hunch, not a finding.
3. **Fix the biggest first.** The usual levers in this app:
   - Page code loads per page. Keep heavy libraries, like Leaflet (the map) and Recharts (charts), out of the first visit.
   - Motion loads late through `LazyMotion` (`MotionRoot`). Pages use the small `m.*` components.
   - React Query shows cached data at once and refreshes it quietly.
   - Typed searches wait about 250ms after the last key. Long tables page or render only the visible rows.
   - Skeletons keep the real size, so nothing jumps (CLS).
   - Fonts: Fontsource, only weights 400 and 600, text in a system font until they load.
4. **Measure again,** and report before and after.

## Server settings

Compression, HTTP/2, cache headers and a CDN (item 07, tips 2, 8, 14, 15, 16 and 18) belong to the hosting, App Platform ("App Platform" in AGENTS.md). Check what it already does before changing anything. Not confirmed yet.
