/**
 * Previous and Next under a list the server pages, with "Showing 1 to 25 of 60". The results-style
 * table uses it (`data-table.tsx`), and so does a plain list that isn't a table, like Activity's
 * Logged calls (PLAN-V17 T3-6). A file of its own, so such a list doesn't load the table's code.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'

/** Which page is shown, and how many rows there are in all (from the server's `total`). */
export interface PagerPage {
  pageIndex: number
  pageSize: number
  total: number
}

export function Pager({
  page,
  onPageChange,
}: {
  page: PagerPage
  onPageChange: (index: number) => void
}) {
  const first = page.total === 0 ? 0 : page.pageIndex * page.pageSize + 1
  const last = Math.min(page.total, (page.pageIndex + 1) * page.pageSize)
  const lastPage = Math.max(0, Math.ceil(page.total / page.pageSize) - 1)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4 text-ui">
      <p className="text-muted-foreground" aria-live="polite">
        {page.total === 0
          ? 'No rows'
          : `Showing ${formatNumber(first)} to ${formatNumber(last)} of ${formatNumber(page.total)}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page.pageIndex <= 0}
          onClick={() => {
            onPageChange(page.pageIndex - 1)
          }}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page.pageIndex >= lastPage}
          onClick={() => {
            onPageChange(page.pageIndex + 1)
          }}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
