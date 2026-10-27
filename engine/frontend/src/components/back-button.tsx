import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'

export interface BackButtonProps {
  /** Where to go when there is nothing to go back to (the page was opened from a link). */
  fallbackTo: string
  /** What the fallback is called: "Results" gives "Back to Results". */
  fallbackLabel: string
}

/**
 * Takes the person back to the page they came from, with the list, the filters and the place they
 * had. When they came from outside the site (a shared link, a new tab) there is no page to go back
 * to, so it links to `fallbackTo` instead, and says where that is.
 *
 * Put it above the page title, at the left, where people look for it.
 */
export function BackButton({ fallbackTo, fallbackLabel }: BackButtonProps) {
  const navigate = useNavigate()
  // A page the site opened itself has a key. The first page of a visit has "default".
  const cameFromHere = useLocation().key !== 'default'
  if (!cameFromHere) {
    return (
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to={fallbackTo}>
          <ArrowLeft aria-hidden="true" />
          Back to {fallbackLabel}
        </Link>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit"
      onClick={() => {
        void navigate(-1)
      }}
    >
      <ArrowLeft aria-hidden="true" />
      Back
    </Button>
  )
}
