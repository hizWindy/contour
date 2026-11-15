/**
 * "Who was the call with?", for a call that wasn't prepped (PLAN-V17 "The screens", part 1): the
 * company's people as chips, and "No one in particular" for the switchboard, which is picked until
 * the rep picks someone. Exactly one is picked, so the chips work like radio buttons.
 */
import { Hourglass } from 'lucide-react'
import { useId } from 'react'
import type { CompanyDetail } from '@/api/types'
import { ChipGroup, type ChipOption } from '@/components/motion'
import { Pending } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { WAITING_FOR_PEOPLE } from '../words'
import { NO_ONE, PEOPLE_NOT_LOADED, WHO_WITH } from './words'

/** HubSpot's contact ids are digits, so this never stands for a person. */
const NO_ONE_VALUE = 'no-one'

export interface WhoPerson {
  id: string
  name: string
}

export interface WhoWithProps {
  /** The company's record. Undefined while it loads. */
  company: CompanyDetail | undefined
  /** The record couldn't be loaded. */
  failed: boolean
  /** The person picked, or null for no one in particular. */
  value: string | null
  /** The person a kept draft names, shown even if they aren't on the company's list. */
  kept: WhoPerson | null
  onChange: (person: WhoPerson | null) => void
}

export function WhoWith({ company, failed, value, kept, onChange }: WhoWithProps) {
  const titleId = useId()
  const people: WhoPerson[] = [...(company?.people ?? [])]
  if (kept && !people.some((person) => person.id === kept.id)) people.unshift(kept)
  const titles = new Map((company?.people ?? []).map((person) => [person.id, person.title]))
  const options: ChipOption[] = [
    {
      value: NO_ONE_VALUE,
      label: NO_ONE,
      description: 'The switchboard, or someone not in HubSpot',
    },
    ...people.map((person) => ({
      value: person.id,
      label: person.name,
      description: titles.get(person.id) ?? undefined,
    })),
  ]
  const picked = people.some((person) => person.id === value) ? value : null
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui font-semibold text-foreground">
        {WHO_WITH}
      </h3>
      {company === undefined && !failed && kept === null ? (
        <Pending label="Loading the people.">
          <div className="flex flex-wrap gap-2">
            {['w-40', 'w-28', 'w-32'].map((width) => (
              <Skeleton key={width} className={`h-8 touch:h-11 ${width}`} />
            ))}
          </div>
        </Pending>
      ) : (
        <>
          <ChipGroup
            mode="one"
            aria-labelledby={titleId}
            options={options}
            value={[picked ?? NO_ONE_VALUE]}
            onChange={([next]) => {
              onChange(people.find((person) => person.id === next) ?? null)
            }}
          />
          {failed ? (
            <p className="text-caption text-muted-foreground">{PEOPLE_NOT_LOADED}</p>
          ) : company?.people_status === 'waiting' ? (
            <p className="flex items-start gap-2 text-caption text-muted-foreground">
              <Hourglass aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {WAITING_FOR_PEOPLE}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
