/**
 * The prep card (PLAN-V10 D4 and F1): what to know and say on one call, in a modal over the page.
 * The company panel is everything we know about a client; this card is quick info and a script.
 *
 * - **At once:** the sales script and the guided questions are written here from what we already
 *   know (`playbook.ts`). Free, and ready as the card opens.
 * - **In the header,** under the person's name: Still there?, Last talk and News (PLAN-V14 T2-3,
 *   `before-you-dial.tsx`). The header doesn't scroll, so they stay in view.
 * - **Then complete:** with call prep switched on, Claude checks the web for news and "still
 *   there?" and writes its own script. It cross-fades in when it is ready. Its lines show their
 *   sources (F for a fact we had, W for a web page found).
 * - **A company with no person** asks "Who are you calling?", with "Prep a cold call" for the
 *   switchboard. The modal then grows into the card (250 ms) instead of jumping.
 * - **Motion:** it fades in and rises 8 px (250 ms), and leaves in 150 ms. Another person in the
 *   same modal cross-fades in 150 ms, and the modal keeps its size.
 * - **Phone:** it fills the screen, and the number with a Call button stays at the bottom.
 */
import {
  Building2,
  CircleAlert,
  Copy,
  Hourglass,
  PhoneCall,
  PhoneOutgoing,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { useCompany, useMe, usePrep, usePrepFacts, useStartPrep } from '@/api/hooks'
import type { CompanyDetail, CompanyPerson, PrepFacts } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BeforeYouDial } from './before-you-dial'
import { SourcesContext } from './guide-sources'
import { CallSide } from './prep-card'
import type { PrepTarget } from './prep-box'
import { guideText } from './playbook'
import { SalesScript, SalesScriptPending } from './sales-script'
import { SCRIPT_TITLE_ID, ScriptHeader } from './script-header'
import { useGuide } from './use-guide'
import { WAITING_FOR_PEOPLE } from './words'

const COPIED_MS = 2000

/**
 * The most one prep may cost: the facts' `prep_cap_usd` (PLAN-V14 contract). Read with a check
 * until the `v14-api` tag brings it into the generated types.
 */
function capOf(facts: PrepFacts | undefined): string | number | null {
  if (!facts || !('prep_cap_usd' in facts)) return null
  const cap = facts.prep_cap_usd
  return typeof cap === 'string' || typeof cap === 'number' ? cap : null
}

function targetKey(target: PrepTarget): string {
  return target.prepId ?? `${target.companyKey}|${target.cold ? 'cold' : (target.person?.id ?? '')}`
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** A square with a person's initials, or an icon. Never round (DESIGN.md: no pills). */
function Avatar({
  name,
  icon: Icon,
  small,
}: {
  name?: string
  icon?: LucideIcon
  small?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-secondary font-semibold text-foreground',
        small ? 'size-8 text-caption' : 'size-10 text-ui',
      )}
    >
      {Icon ? <Icon className="size-5 text-muted-foreground" /> : initials(name ?? '')}
    </span>
  )
}

/** A button that copies text and says "Copied" for 2 seconds. */
function CopyButton({
  text,
  label,
  disabled,
  variant = 'outline',
}: {
  text: string
  label: string
  disabled?: boolean
  variant?: 'outline' | 'default'
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, COPIED_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
          },
          () => {
            toast.error("It couldn't be copied", { description: 'Select the text and copy it.' })
          },
        )
      }}
    >
      <Copy aria-hidden="true" />
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  )
}

/** "Who are you calling?": the company's people, and a cold call to the switchboard. */
function WhoPicker({
  company,
  onPick,
}: {
  company: CompanyDetail | undefined
  onPick: (person: CompanyPerson | null) => void
}) {
  if (!company) {
    return (
      <Pending label="Loading the people.">
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </Pending>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="who-people" className="flex flex-col gap-2">
        <h3 id="who-people" className="text-ui font-semibold text-foreground">
          People at {company.name}
        </h3>
        {company.people_status === 'waiting' ? (
          <p className="flex items-start gap-2 text-ui text-muted-foreground">
            <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {WAITING_FOR_PEOPLE}
          </p>
        ) : company.people.length === 0 ? (
          <p className="font-serif text-body text-muted-foreground">
            No people on record in HubSpot.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {company.people.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-2.5 pl-3 transition-colors hover:bg-muted"
              >
                <Avatar name={person.name} small />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{person.name}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {person.title ?? 'No title on record'}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  aria-label={`Prep a call with ${person.name}`}
                  onClick={() => {
                    onPick(person)
                  }}
                >
                  Prep
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        aria-labelledby="who-cold"
        className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
      >
        <div className="flex flex-col gap-0.5">
          <h3 id="who-cold" className="text-ui font-semibold text-foreground">
            No name yet?
          </h3>
          <p className="text-caption text-muted-foreground">
            A cold call script asks the switchboard for whoever looks after the office.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onPick(null)
          }}
        >
          <PhoneOutgoing aria-hidden="true" />
          Prep a cold call
        </Button>
      </section>
    </div>
  )
}

export interface PrepModalProps {
  target: PrepTarget | null
  onClose: () => void
  /** Another person (or a cold call) in the same modal. */
  onChangeTarget: (target: PrepTarget) => void
  /** "Company info": close the card and open the company's panel. */
  onOpenCompany?: (companyKey: string) => void
}

export function PrepModal({ target, onClose, onChangeTarget, onOpenCompany }: PrepModalProps) {
  // While the modal fades out, it keeps showing what it had.
  const [shown, setShown] = useState(target)
  if (target !== null && target !== shown) {
    setShown(target)
  }
  const [prepIds, setPrepIds] = useState<Record<string, string>>({})
  // Which target was refused because call prep is switched off (so it never carries over).
  const [offFor, setOffFor] = useState<string | null>(null)
  const started = useRef(new Set<string>())
  const start = useStartPrep()
  const me = useMe()
  const today = melbourneDate()
  const onPhone = useMediaQuery(PHONE)

  const key = shown ? targetKey(shown) : ''
  const off = offFor !== null && offFor === key
  const picking = shown !== null && !shown.prepId && !shown.person && !shown.cold
  // A Refresh replaces what a chip opened, so the newest prep for this key wins.
  const prepId = prepIds[key] ?? shown?.prepId
  const prep = usePrep(prepId)
  const companyKey = shown?.companyKey || prep.data?.company_key || undefined
  const company = useCompany(companyKey)
  const person = picking
    ? null
    : (shown?.person ?? (prep.data?.kind === 'person' ? (prep.data.person ?? null) : null))
  const contactId = person?.id ?? null
  const facts = usePrepFacts(companyKey, contactId)

  const ask = (refresh: boolean): void => {
    if (!shown) return
    const askKey = key
    // A chip carries only the prep: its person (or the cold call) comes from the prep itself.
    const saved = shown.prepId ? prep.data : undefined
    const cold = Boolean(shown.cold) || saved?.kind === 'cold'
    start.mutate(
      {
        company_key: shown.companyKey || (saved?.company_key ?? ''),
        contact_id: cold ? null : (shown.person?.id ?? saved?.person?.id ?? null),
        cold,
        refresh,
      },
      {
        onSuccess: (made) => {
          setOffFor(null)
          setPrepIds((ids) => ({ ...ids, [askKey]: made.id }))
        },
        onError: (error) => {
          if (isApiProblem(error) && error.code === 'prep_off') {
            setOffFor(askKey)
          }
        },
      },
    )
  }

  // A person or a cold call: start (or reuse) call prep once. Switched off, it answers at once.
  useEffect(() => {
    if (!target || target.prepId || (!target.person && !target.cold)) return
    const wanted = targetKey(target)
    if (started.current.has(wanted)) return
    started.current.add(wanted)
    ask(false)
    // `ask` reads the target it is given; it starts once per target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const caller = me.data?.state === 'signed_in' ? me.data.user.name : null
  const claude = prep.data?.status === 'ready' ? prep.data.script : null
  const sources = useMemo(
    () => new Map((prep.data?.sources ?? []).map((source) => [source.id, source])),
    [prep.data?.sources],
  )
  const labels = useMemo(
    () => new Map([...sources.values()].map((source) => [source.id, source.label])),
    [sources],
  )
  const guide = useGuide({
    script: claude,
    labels,
    company: company.data,
    picking,
    person,
    caller,
    today,
    companyKey,
    contactId,
  })

  const checking = !off && prep.data?.status === 'searching'
  const companyName =
    shown?.companyName || prep.data?.company_name || company.data?.name || 'Company'
  const personTitle = person?.title ?? null
  const title = picking ? 'Who are you calling?' : person ? person.name : companyName
  const phone = facts.data?.phone ?? null
  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null
  const problem = start.error && !(isApiProblem(start.error) && start.error.code === 'prep_off')
  const who = person
    ? `${person.name}${personTitle ? `, ${personTitle}` : ''}, ${companyName}`
    : `${companyName} (cold call)`
  const openCompany = (): void => {
    if (companyKey && onOpenCompany) onOpenCompany(companyKey)
  }

  const enabled = off ? false : (facts.data?.prep_enabled ?? null)
  const capUsd = capOf(facts.data)

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 data-open:slide-in-from-bottom-2 sm:transition-[max-width] sm:duration-250',
          picking ? 'sm:max-w-lg' : 'sm:max-w-5xl',
          'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
      >
        <DialogHeader className="gap-3 border-b p-5 pr-14 text-left max-sm:p-4 max-sm:pr-14">
          <div className="flex min-w-0 items-start gap-3">
            {picking ? (
              <Avatar icon={Building2} />
            ) : person ? (
              <Avatar name={person.name} />
            ) : (
              <Avatar icon={PhoneOutgoing} />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="text-section">{title}</DialogTitle>
              <DialogDescription asChild>
                <p className="text-ui text-foreground">
                  {picking ? null : person ? (
                    <span>{personTitle ?? 'No title on record'} · </span>
                  ) : (
                    <span>Cold call, no name yet · </span>
                  )}
                  {onOpenCompany && companyKey ? (
                    <button
                      type="button"
                      onClick={openCompany}
                      className="rounded-sm underline decoration-input underline-offset-4 transition-colors hover:decoration-current"
                    >
                      {companyName}
                    </button>
                  ) : (
                    companyName
                  )}
                </p>
              </DialogDescription>
            </div>
          </div>
          {picking ? null : (
            // Under the person's name, and out of the scroll, so it stays in view.
            <SourcesContext.Provider value={sources}>
              <div className="-mr-9 max-sm:-mr-10 sm:pl-13">
                <BeforeYouDial
                  company={company.data}
                  facts={facts.data}
                  script={claude}
                  checking={checking}
                  person={person}
                  today={today}
                />
              </div>
            </SourcesContext.Provider>
          )}
        </DialogHeader>
        <SourcesContext.Provider value={sources}>
          <div
            key={key}
            className="min-h-0 flex-1 animate-in overflow-y-auto overscroll-contain p-5 duration-150 fade-in-0 max-sm:p-4"
          >
            {picking ? (
              <WhoPicker
                company={company.data}
                onPick={(picked) => {
                  if (!shown) return
                  onChangeTarget(
                    picked
                      ? {
                          ...shown,
                          person: { id: picked.id, name: picked.name, title: picked.title },
                        }
                      : { ...shown, cold: true },
                  )
                }}
              />
            ) : (
              <div className="flex flex-col gap-6">
                {problem ? (
                  <ErrorState
                    error={start.error}
                    context="Call prep couldn't start. The script below is from our HubSpot copy."
                    onRetry={() => {
                      ask(false)
                    }}
                  />
                ) : prep.data?.status === 'failed' ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-soft p-3 text-ui text-destructive-ink"
                  >
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {prep.data.error ?? 'The web check failed.'} The script below is from our
                      HubSpot copy. Press Try again.
                    </span>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
                  {guide ? (
                    <section
                      key={guide.madeFrom}
                      aria-labelledby={SCRIPT_TITLE_ID}
                      className="flex min-w-0 animate-in flex-col gap-4 duration-150 fade-in-0"
                    >
                      <ScriptHeader
                        madeFrom={guide.madeFrom}
                        prep={prep.data}
                        enabled={enabled}
                        namesOk={facts.data?.names_ok !== false}
                        capUsd={capUsd}
                        running={checking || start.isPending}
                        stage={prep.data?.stage ?? 0}
                        failed={Boolean(problem) || prep.data?.status === 'failed'}
                        onResearch={() => {
                          ask(true)
                        }}
                      />
                      <SalesScript guide={guide} />
                    </section>
                  ) : company.error ? (
                    <ErrorState
                      error={company.error}
                      context="The company couldn't be loaded, so there is no script."
                    />
                  ) : (
                    <SalesScriptPending />
                  )}
                  <CallSide
                    company={company.data}
                    facts={facts.data}
                    today={today}
                    onOpenCompany={openCompany}
                  />
                </div>
              </div>
            )}
          </div>
        </SourcesContext.Provider>
        {!picking && onPhone ? (
          // On a phone: one big Call button, where a thumb reaches it, and the rest under it.
          <div className="flex flex-col gap-2 border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {phone && tel ? (
              <Button asChild size="lg" className="w-full">
                <a href={tel}>
                  <PhoneCall aria-hidden="true" />
                  Call {phone}
                </a>
              </Button>
            ) : (
              <p className="py-1 text-center text-ui text-muted-foreground">No number on record</p>
            )}
            <div className="flex gap-2 *:flex-1">
              {phone ? <CopyButton text={phone} label="Copy number" /> : null}
              <CopyButton
                text={guide ? guideText(guide, who) : ''}
                label="Copy script"
                disabled={!guide}
              />
            </div>
          </div>
        ) : !picking ? (
          <div className="flex flex-wrap items-center gap-2 border-t bg-popover p-4">
            {phone && tel ? (
              <>
                <span className="text-body font-semibold tabular-nums select-all">{phone}</span>
                <CopyButton text={phone} label="Copy number" variant="default" />
              </>
            ) : (
              <span className="text-ui text-muted-foreground">No number on record</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <CopyButton
                text={guide ? guideText(guide, who) : ''}
                label="Copy script"
                disabled={!guide}
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
