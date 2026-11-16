/**
 * Call prep's quick look (PLAN-V18 T3-7): what we know about the company, from our HubSpot copy and
 * with no AI, the moment the panel opens. Its facts come from `GET /companies/{key}/facts`, which
 * the Prep button fetched while the pointer rested on it, so they are usually there already. The
 * company's record adds the deal's stage and the next meeting once it comes.
 *
 * - **The facts:** the owner, the deal and its stage, staff, the next lease end and the next
 *   meeting, each with its label above it, in two columns (one on a phone). The last talk follows
 *   in its own section (`LastTalk`), and the number stays in the panel's footer, so each shows once
 *   (DESIGN.md "Say it once").
 * - **"Calling":** who the call is with. It opens on the last person we talked to, else the first
 *   person on record, else a cold call to the switchboard (`callee.ts`). Press it to change: the
 *   people, then the cold call. The script follows the person, as picking did before.
 * - **When every read failed:** one quiet line, and Try again, which asks for them again, as the
 *   error box's Try again does (`runFailedReadsAgain`).
 */
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, PhoneOutgoing } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { runFailedReadsAgain } from '@/api/connection'
import type { CompanyDetail, CompanyPerson, PrepFacts } from '@/api/types'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNumber } from '@/lib/format'
import { ChoiceItem } from './choice-item'
import { DealMark, LeaseEnd } from './marks'
import type { PrepPerson } from './prep-box'
import {
  CALLING,
  COLD_CALL,
  COMPANY_INFO,
  FACTS_FAILED,
  NEXT_MEETING_NONE,
  NO_LEASE,
  NO_OWNER,
  NO_PEOPLE,
  NO_STAFF,
  QUICK_LOOK,
  QUICK_LOOK_LOADING,
  TRY_AGAIN,
  WAITING_FOR_PEOPLE,
  WHO_TO_CALL,
} from './words'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui text-foreground">{children}</dd>
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

export interface QuickLookProps {
  facts: PrepFacts | undefined
  company: CompanyDetail | undefined
  /** Both reads failed: the quick look says so in one quiet line. */
  failed: boolean
  today: string
  /** "Company info": the company's full record. */
  onOpenCompany?: () => void
}

export function QuickLook({ facts, company, failed, today, onOpenCompany }: QuickLookProps) {
  const title = useId()
  const client = useQueryClient()
  const deal = company?.deals.find((item) => item.state === 'open') ?? null
  const staff = facts?.staff ?? company?.staff ?? null
  const owner = facts?.owner ?? company?.owner ?? null
  const leaseEnd = facts?.next_lease_end ?? company?.next_lease_end ?? null
  const dealState = facts?.deal ?? company?.deal ?? 'none'
  const now = new Date().toISOString()
  const meeting =
    company?.meetings
      ?.filter((item) => item.meeting.starts_at >= now)
      .sort((a, b) => a.meeting.starts_at.localeCompare(b.meeting.starts_at))[0] ?? null
  const known = Boolean(facts ?? company)

  return (
    <section aria-labelledby={title} data-slot="quick-look" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={title} className="text-ui font-semibold text-foreground">
          {QUICK_LOOK}
        </h3>
        {onOpenCompany ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 touch:h-11"
            onClick={onOpenCompany}
          >
            <Building2 aria-hidden="true" />
            {COMPANY_INFO}
          </Button>
        ) : null}
      </div>
      {known ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 max-sm:grid-cols-1">
          <Fact label="Owner">{owner ?? <Quiet>{NO_OWNER}</Quiet>}</Fact>
          <Fact label="Deal">
            {deal ? (
              <span>
                {deal.stage ?? deal.name}
                {deal.stage ? <Quiet> · {deal.name}</Quiet> : null}
              </span>
            ) : (
              <DealMark deal={dealState} />
            )}
          </Fact>
          <Fact label="Staff">
            {staff === null ? <Quiet>{NO_STAFF}</Quiet> : `${formatNumber(staff)} staff`}
          </Fact>
          <Fact label="Next lease end">
            {leaseEnd ? (
              <LeaseEnd date={leaseEnd} today={today} stacked={false} />
            ) : (
              <Quiet>{NO_LEASE}</Quiet>
            )}
          </Fact>
          <Fact label="Next meeting">
            {meeting ? (
              <span>
                {formatDateTime(meeting.meeting.starts_at)}
                <Quiet> · {meeting.meeting.title}</Quiet>
              </span>
            ) : (
              <Quiet>{NEXT_MEETING_NONE}</Quiet>
            )}
          </Fact>
        </dl>
      ) : failed ? (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-ui text-muted-foreground">
            {FACTS_FAILED}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            onClick={() => {
              runFailedReadsAgain(client)
            }}
          >
            {TRY_AGAIN}
          </Button>
        </div>
      ) : (
        <Pending label={QUICK_LOOK_LOADING}>
          {/* The real size: five facts in two columns, so nothing jumps when they come. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-sm:grid-cols-1">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="flex flex-col gap-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
        </Pending>
      )}
    </section>
  )
}

export interface CallingRowProps {
  /** The company's people, to choose from. */
  people: readonly CompanyPerson[]
  /** HubSpot's contacts can't be read yet (a permission): only the cold call is offered. */
  waiting: boolean
  /** Who the call is with now, or null for a cold call. Undefined while it is being chosen. */
  person: PrepPerson | null | undefined
  /** Another person, or null for the cold call. */
  onPick: (person: CompanyPerson | null) => void
}

/** "Calling": who the call is with, and a short list to change it. */
export function CallingRow({ people, waiting, person, onPick }: CallingRowProps) {
  if (person === undefined) {
    return (
      <Pending label={WHO_TO_CALL}>
        <Skeleton className="h-11 w-full" />
      </Pending>
    )
  }
  const who = person ? `${person.name}${person.title ? `, ${person.title}` : ''}` : COLD_CALL
  return (
    <div className="flex flex-col gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-slot="calling-row"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-muted"
          >
            <span className="text-caption text-muted-foreground">{CALLING}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-foreground">
              {person ? null : (
                <PhoneOutgoing
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              )}
              <span className="truncate">{who}</span>
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          <DropdownMenuLabel>{WHO_TO_CALL}</DropdownMenuLabel>
          {people.map((item) => (
            <ChoiceItem
              key={item.id}
              checked={person?.id === item.id}
              onPick={() => {
                onPick(item)
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.name}</span>
                {item.title ? (
                  <span className="truncate text-caption text-muted-foreground">{item.title}</span>
                ) : null}
              </span>
            </ChoiceItem>
          ))}
          {people.length > 0 ? <DropdownMenuSeparator /> : null}
          <ChoiceItem
            checked={person === null}
            onPick={() => {
              onPick(null)
            }}
          >
            {COLD_CALL}
          </ChoiceItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {waiting || people.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {waiting ? WAITING_FOR_PEOPLE : NO_PEOPLE}
        </p>
      ) : null}
    </div>
  )
}
