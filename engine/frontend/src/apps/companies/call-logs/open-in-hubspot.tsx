/**
 * "Open in HubSpot" for one call: a link to another site, so it has the arrow out of the box, opens
 * in a new tab, says so to a screen reader, and names the call (a list holds many such links), or
 * a logged meeting's notes (T3-11). Only an http or https address becomes a link (`safeHref`).
 */
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { safeHref } from '@/lib/safe-href'
import { NEW_TAB, OPEN_IN_HUBSPOT } from './words'

export function OpenInHubSpot({
  href,
  company,
  meeting = false,
}: {
  href: string | null
  company: string
  /** A logged meeting's notes, not a call. */
  meeting?: boolean
}) {
  const safe = safeHref(href)
  if (!safe) return null
  return (
    <Button asChild variant="outline" size="sm" className="touch:h-11">
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        <ExternalLink aria-hidden="true" />
        {OPEN_IN_HUBSPOT}
        <span className="sr-only">
          {meeting ? `: the meeting notes for ${company}` : `: the call with ${company}`} {NEW_TAB}
        </span>
      </a>
    </Button>
  )
}
