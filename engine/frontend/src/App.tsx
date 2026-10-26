import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from '@/api/query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createAppRouter } from '@/router'

type AppRouter = ReturnType<typeof createBrowserRouter>

export interface AppProps {
  /** For tests: a memory router over the same routes, or a prepared query client. */
  router?: AppRouter
  queryClient?: QueryClient
}

/**
 * The whole website: the server data cache, the tooltips and toasts every page shares, and the
 * router with its pages. Both are made once, on the first render.
 */
export function App({ router, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? createQueryClient())
  const [appRouter] = useState(() => router ?? createAppRouter())
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={appRouter} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
