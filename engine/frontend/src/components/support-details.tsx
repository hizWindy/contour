import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ApiProblem } from '@/api/client'
import { Button } from '@/components/ui/button'
import { supportLines, supportText } from '@/lib/support'
import { cn } from '@/lib/utils'

/**
 * "Details for support" (PLAN-V15 T2-3), folded away: the status, the code, the request id, the
 * time and the page, with a Copy button for all of it. The error box and the full error pages
 * both use it.
 */
export function SupportDetails({
  problem,
  className,
}: {
  problem: ApiProblem
  className?: string
}) {
  const lines = supportLines(problem)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => {
      setCopied(false)
    }, 2000)
    return () => {
      clearTimeout(timer)
    }
  }, [copied])
  return (
    <details data-slot="support-details" className={cn('text-caption', className)}>
      <summary className="w-fit cursor-pointer rounded-sm font-semibold underline-offset-4 hover:underline touch:py-2.5">
        Details for support
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {lines.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold">{label}</dt>
            <dd className="break-all tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => {
          void navigator.clipboard.writeText(supportText(lines)).then(
            () => {
              setCopied(true)
            },
            () => undefined,
          )
        }}
      >
        <Copy aria-hidden="true" />
        <span aria-live="polite">{copied ? 'Copied' : 'Copy the details'}</span>
      </Button>
    </details>
  )
}
