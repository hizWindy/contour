/**
 * The names the mic learned (PLAN-V23 T1-2 and T1-5), on Admin's Settings: each is a name the mic
 * misheard and the company a rep picked for it, kept for the whole team. The mic tries these
 * first. Newest first: the words heard, the company, who taught it and when.
 *
 * Remove forgets one at once, with Undo in the toast. Undo teaches the same pair again, so it then
 * shows as taught by the Admin who undid it (TBC). A pair someone removed already counts as gone.
 */
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toApiProblem } from '@/api/client'
import {
  learnedNamesKey,
  removeLearnedName,
  teachName,
  useLearnedNames,
} from '@/api/hooks/assistant-names'
import type { LearnedName, LearnedNamePage } from '@/api/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Pending, SkeletonLines } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

const LEARNED_TITLE = 'Names the mic learned'
const LEARNED_PURPOSE =
  'Each is a name the mic misheard, and the company a rep picked for it. The mic tries these first, for the whole team. Remove one that is wrong.'
const NONE_YET = 'No learned names yet.'
const NONE_YET_NEXT =
  'When a rep picks the right company for a name the mic misheard, it shows here.'
const NOT_KNOWN = 'Not known'
const UNDO = 'Undo'

function removedWords(heard: string): string {
  return `The mic no longer learns '${heard}'.`
}

function moreWords(shown: number, total: number): string {
  return `Showing the newest ${String(shown)} of ${String(total)}.`
}

/** The list without one pair, as the server will have it. */
function without(page: LearnedNamePage | undefined, id: string): LearnedNamePage | undefined {
  if (!page) return page
  const items = page.items.filter((item) => item.id !== id)
  return { items, total: Math.max(0, page.total - (page.items.length - items.length)) }
}

function LearnedTable({
  items,
  onRemove,
}: {
  items: readonly LearnedName[]
  onRemove: (item: LearnedName) => void
}) {
  return (
    <Table compact aria-label={LEARNED_TITLE}>
      <TableHeader>
        <TableRow>
          <TableHead>Heard</TableHead>
          <TableHead>Company</TableHead>
          <TableHead className="max-md:hidden">Taught by</TableHead>
          <TableHead className="max-sm:hidden">When</TableHead>
          <TableHead>
            <span className="sr-only">Remove</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="max-w-48 font-semibold break-words whitespace-normal">
              {item.heard}
            </TableCell>
            <TableCell className="max-w-64 break-words whitespace-normal">
              {item.company_name}
            </TableCell>
            <TableCell className="text-muted-foreground max-md:hidden">
              {item.taught_by ?? NOT_KNOWN}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums max-sm:hidden">
              {formatDate(item.created_at)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="touch:h-11"
                aria-label={`Remove ${item.heard}`}
                onClick={() => {
                  onRemove(item)
                }}
              >
                Remove
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function LearnedNames() {
  const learned = useLearnedNames()
  const client = useQueryClient()
  const key = learnedNamesKey()

  const remove = (item: LearnedName): void => {
    // Gone from the list at once; the server is told, and Undo teaches it again.
    client.setQueryData<LearnedNamePage>(key, (page) => without(page, item.id))
    removeLearnedName(item.id).then(
      () => {
        toast(removedWords(item.heard), {
          action: {
            label: UNDO,
            onClick: () => {
              teachName({ heard: item.heard, company_key: item.company_key }).then(
                () => void client.invalidateQueries({ queryKey: key }),
                toastProblem,
              )
            },
          },
        })
      },
      (error: unknown) => {
        // Removed already by someone else: it stays gone. Anything else puts it back.
        if (toApiProblem(error).status !== 404) toastProblem(error)
        void client.invalidateQueries({ queryKey: key })
      },
    )
  }

  let body
  if (learned.error) {
    body = (
      <ErrorState
        error={learned.error}
        context="The learned names couldn't be loaded."
        onRetry={() => void learned.refetch()}
      />
    )
  } else if (!learned.data) {
    body = (
      <Pending label="Loading the learned names.">
        <SkeletonLines count={4} />
      </Pending>
    )
  } else if (learned.data.items.length === 0) {
    body = (
      <EmptyState
        title={NONE_YET}
        description={NONE_YET_NEXT}
        headingLevel={3}
        className="border-0 bg-transparent p-0"
      />
    )
  } else {
    const { items, total } = learned.data
    body = (
      <div className="flex flex-col gap-3">
        <LearnedTable items={items} onRemove={remove} />
        {total > items.length ? (
          <p className="text-caption text-muted-foreground">{moreWords(items.length, total)}</p>
        ) : null}
      </div>
    )
  }

  return (
    <Card data-slot="learned-names">
      <CardHeader>
        <CardTitle className="text-section font-semibold">{LEARNED_TITLE}</CardTitle>
        <CardDescription>{LEARNED_PURPOSE}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
