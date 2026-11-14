# 22 Front-End Performance Optimization Tips

Last updated: 14 Nov 2026

| | |
|---|---|
| Source | Strapi blog, Paul Bratslavsky (Developer Advocate): [22 Front-End Performance Optimization Tips to Speed Up Your Website](https://strapi.io/blog/front-end-performance-optimization-tips) |
| Dates | Published 28 May 2025, updated 14 June 2026 |
| Type | Web article, one list of 22 tips |
| File | No local copy; the link above is the source. |
| What it is for | Making pages load and respond fast. Speed is part of the design: a slow screen feels broken however good it looks. |

Strapi sells a content system and hosting, so the article mentions Strapi v5 and Strapi Cloud in a few places. Those parts are skipped here.

## Extracted

Tip headings copied exactly from the article. The meaning is a short summary with the article's own numbers. **TBC** (to be confirmed) means not checked against Contour yet.

| # | Tip | What it means | In Contour |
|---|---|---|---|
| 1 | Minimize HTTP Requests to Speed Up Initial Page Load | Fewer files to fetch. Bundle CSS and JavaScript (Webpack, Rollup), use CSS sprites, inline snippets under 1KB. | **TBC** |
| 2 | Use Browser Caching to Reduce Load Time on Return Visits | Let the browser keep files with Cache-Control, Expires and ETag headers. The example keeps images 1 year, CSS and JavaScript 1 month. | **TBC** |
| 3 | Compress Images to Maintain Quality and Reduce Bandwidth | Shrink images. PNG for flat-colour graphics, WebP for most others, with a `<picture>` fallback. | **TBC** |
| 4 | Implement Lazy Loading to Prioritize Visible Content First | Load images and video only when they scroll into view, with `loading="lazy"` or the Intersection Observer API. | **TBC** |
| 5 | Minimize JavaScript and CSS Files to Optimize Performance | Strip spaces, comments and unused code, and shorten names (minifying). | **TBC** |
| 6 | Use Asynchronous Loading for JavaScript to Boost Rendering | Scripts don't block the page: `async` for scripts that stand alone, `defer` for scripts that must run in order. | **TBC** |
| 7 | Implement Critical CSS to Improve Initial Rendering | Put the CSS for the first screen inline, load the rest later. Tools: Critical, Penthouse. | **TBC** |
| 8 | Use Content Delivery Networks to Improve Website Speed | Serve files from servers near the user (a CDN). | **TBC** |
| 9 | Optimize Web Fonts to Minimize Load Time | Fewer font weights, WOFF2 files, `font-display: swap`, preload the main font, or use system fonts. | **TBC** |
| 10 | Use SVGs for Lightweight and Scalable Graphics for Faster Media | Vector icons and drawings stay sharp at any size. Inline SVG gives more control; an SVG file keeps the HTML cleaner but costs a request. | **TBC** |
| 11 | Implement Server-Side Rendering to Boost Content Delivery | Build the HTML on the server so the page shows sooner. The example uses Next.js `getServerSideProps`. | **TBC** |
| 12 | Optimize JavaScript Execution to Shape a Better User Experience | Split code so each page loads only what it needs (React `lazy` and `Suspense`). Debounce scroll handlers (200ms in the example). Move heavy work to Web Workers. | **TBC** |
| 13 | Avoid Inline JavaScript and CSS to Optimize Caching | Keep code in separate files so the browser can cache it and fetch it in parallel. | **TBC** |
| 14 | Use HTTP/2 to Improve Resource Delivery Speed | HTTP/2 sends many files over one connection and compresses headers. A server setting. | **TBC** |
| 15 | Avoid Redirects to Minimize Latency | Each redirect adds a round trip. Watch www to non-www, HTTP to HTTPS and trailing slashes. | **TBC** |
| 16 | Use GZIP or Brotli Compression to Speed Up Data Transfer | Compress text files before sending. Brotli shrinks more in modern browsers. | **TBC** |
| 17 | Defer Non-Essential CSS to Enhance Rendering | Load CSS that isn't needed yet without blocking, with media queries (example `min-width: 1024px`) or `rel="preload"`. | **TBC** |
| 18 | Use Cache-Control Headers to Get Optimal Resource Caching | Set how long files are kept: `max-age` (example 31536000, one year), `no-cache`, `immutable`. | **TBC** |
| 19 | Optimize Your Critical Rendering Path to Experience Faster Loads | Get the first screen up fast: inline critical CSS, preload and preconnect hints, defer other JavaScript. Improves FCP and TTI. | **TBC** |
| 20 | Use Service Workers to Get Offline Support and Performance Gains | A background script caches files on install and serves them from the cache. | **TBC** |
| 21 | Monitor Front-End Performance with Analytics Tools to Improve User Experience | Measure with Lighthouse, WebPageTest and Google Search Console's Core Web Vitals report. | **TBC** |
| 22 | Reduce CSS Complexity to Improve Front-End Efficiency | Flat class selectors instead of deep nesting. Find unused CSS with Chrome DevTools Coverage and remove it with PurgeCSS. | **TBC** |

Terms used above: **FCP** (First Contentful Paint) is when the first content shows. **TTI** (Time to Interactive) is when the page responds to input.

## Read with care

- **One metric is out of date.** Tip 21 lists FID (First Input Delay). Google replaced FID with INP (Interaction to Next Paint) as a Core Web Vital in March 2024.
- **The article gives no targets.** Google's are below, added here; they are not in the article.
- **Some tips pull against each other.** Tip 7 inlines CSS; tip 13 says avoid inline CSS. Tip 1 says bundle files; tip 14 (HTTP/2) makes many small files cheap. Inline only the CSS for the first screen.
- **Many tips are server or framework settings** (2, 8, 14, 15, 16, 18). Most frameworks and hosts handle them already. Check what Contour's set-up does before changing anything.

## Core Web Vitals targets (added, from Google)

A page is "good" when 75% of visits meet all three:

| Metric | Measures | Good |
|---|---|---|
| LCP (Largest Contentful Paint) | When the main content shows | 2.5 seconds or less |
| INP (Interaction to Next Paint) | How fast the page reacts to a click or key | 200ms or less |
| CLS (Cumulative Layout Shift) | How much the layout jumps | 0.1 or less |

## Takeaway

The article says to start with image compression, lazy loading and browser caching, then measure as you add more. Contour's screens are mostly data, not images, so measuring first (21) and the JavaScript tips (6, 12) may matter more. TBC until a Lighthouse run on Contour's pages.
