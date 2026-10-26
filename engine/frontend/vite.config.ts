import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * The dev server and the preview server both listen on 5173, because the backend only allows
 * web origins on that port (`cors_origins`). They are never run at the same time.
 * Always open http://localhost:5173. The backend also lists http://127.0.0.1:5173, but on this
 * machine the dev server listens only on ::1 (what "localhost" resolves to here), so that
 * address does not connect.
 */
const PORT = 5173

/**
 * Where the backend runs. Read here only, never sent to the browser (no VITE_ prefix).
 * Set API_PROXY_TARGET to point the site at another backend, such as the end-to-end one.
 */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

/**
 * Proxy for `/api`. Server-sent events (the run feed) must pass through without buffering:
 *  - Vite does not compress proxied responses (in `vite preview` the proxy runs before the
 *    compression middleware), and the request for a stream asks the backend for no compression
 *    either, because a gzip stream is held back until a block fills;
 *  - the stream response is marked `no-cache, no-transform` and `x-accel-buffering: no`, so no
 *    proxy in between (for example nginx later) holds it back;
 *  - there is no proxy timeout, so a quiet stream is never cut.
 * `changeOrigin` sends `Host: 127.0.0.1:8000`, which the backend's host check accepts. The
 * browser's own `Origin` header (http://localhost:5173, the address to open) is passed on
 * unchanged.
 */
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (String(req.headers.accept ?? '').includes('text/event-stream')) {
          proxyReq.setHeader('accept-encoding', 'identity')
        }
      })
      proxy.on('proxyRes', (proxyRes) => {
        if (String(proxyRes.headers['content-type'] ?? '').startsWith('text/event-stream')) {
          proxyRes.headers['cache-control'] = 'no-cache, no-transform'
          proxyRes.headers['x-accel-buffering'] = 'no'
        }
      })
    },
  },
}

/**
 * The Content-Security-Policy is a meta tag in index.html, and the dev server serves the same
 * policy as the built site, with nothing relaxed. React Fast Refresh adds one inline script, but
 * the plugin puts it before the meta tag, and a meta policy only governs what comes after it.
 *
 * One dev-only wrinkle: when the dev server stops, Vite's own client reconnects with a small worker
 * made from a blob: URL, and the policy blocks it (one console error). The page then does not
 * reload by itself when the server comes back, so reload it by hand. Nothing else is affected, and
 * the policy stays the same as in production on purpose, so a violation in our code shows in dev.
 *
 * `frame-ancestors` cannot be set in a meta tag (browsers ignore it and log an error), so the
 * dev and preview servers send it as a real header, with the other headers a meta tag cannot
 * carry. A static host in production must send the same headers.
 */
const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(process.env.VITEST ? [] : [tailwindcss()])],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    // No `host` and no `allowedHosts`: the dev server listens on localhost only. On this machine
    // "localhost" is the IPv6 address ::1, so http://127.0.0.1:5173 does not connect, even though
    // the backend lists it. Always open the site as http://localhost:5173 (see PORT above).
    // Leave `host` alone: `host: true` would open it to the network.
    port: PORT,
    strictPort: true,
    headers: securityHeaders,
    proxy: apiProxy,
  },
  preview: {
    port: PORT,
    strictPort: true,
    headers: securityHeaders,
    proxy: apiProxy,
  },
  build: {
    target: 'es2023',
    // Keep every file a file. A font inlined as a data: URL would be blocked by the CSP.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    css: false,
    // Nothing a test replaces may leak into the next test: spies are restored, calls are cleared,
    // and vi.stubGlobal and vi.stubEnv are undone. (Fake timers are reset in src/test/setup.ts.)
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
