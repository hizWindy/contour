/**
 * One numbered section of the pre-read's form (PLAN-V18 T2-5), in HubSpot's form pattern with
 * Contour's own look: the number and the heading, a thin line under them, a quiet note when the
 * section needs one, then its fields. The number is for the eye: a screen reader hears the
 * heading's words, and the four headings make the page's outline.
 */
import { useId, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'

export interface FormSectionProps {
  number: number
  title: string
  /** One quiet line under the heading, like where the section's words come from. */
  note?: ReactNode
  /** A heading the page can move the focus to, when a button in the section is about to go. */
  headingRef?: Ref<HTMLHeadingElement>
  children: ReactNode
  className?: string
}

export function FormSection({
  number,
  title,
  note,
  headingRef,
  children,
  className,
}: FormSectionProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      data-slot="form-section"
      className={cn('flex flex-col gap-4 px-6 py-6 max-sm:px-4', className)}
    >
      <div className="flex flex-col gap-1 border-b pb-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="flex items-baseline gap-2 rounded-sm text-section font-semibold text-balance text-foreground"
        >
          <span aria-hidden="true" className="text-muted-foreground tabular-nums">
            {number}
          </span>
          {title}
        </h2>
        {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}
