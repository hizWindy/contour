import { Skeleton } from '@/components/ui/skeleton'
import { SKELETON_DELAY_MS, useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'

/**
 * The shape of the app while its first page loads and the backend says who is signed in (PLAN-V7
 * B3): the menu, the top bar, and a page with a header and a block. It is still and grey, and it
 * has the real frame's sizes (the menu is 16rem wide on a laptop screen and a rail of icons on a
 * tablet, the top bar is 3.5rem tall, the page has the same padding), so the page does not jump
 * when the real frame takes its place.
 *
 * It shows only if loading takes more than 200 ms, like the other loading shapes, so a fast
 * start never flashes grey blocks. A screen reader hears one line.
 */
export function ShellSkeleton() {
  const shown = useAfter(SKELETON_DELAY_MS)
  return (
    <div role="status" data-slot="shell-pending" className="min-h-svh bg-background">
      <span className="sr-only">Loading the page.</span>
      <div
        aria-hidden="true"
        className={cn('flex min-h-svh', shown ? 'animate-in duration-150 fade-in-0' : 'invisible')}
      >
        <div className="hidden w-[3.25rem] shrink-0 flex-col items-center gap-3 border-r bg-sidebar py-4 md:flex lg:hidden">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="size-7 bg-sidebar-accent" />
          ))}
        </div>
        <div className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
          <Skeleton className="h-10 w-36 bg-sidebar-accent" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full bg-sidebar-accent" />
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
            <Skeleton className="size-8" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="mx-auto flex w-full max-w-(--content-max) min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
