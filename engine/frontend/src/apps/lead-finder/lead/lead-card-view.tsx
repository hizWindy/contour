/**
 * One lead's card: the result and why, the facts with their sources, HubSpot, look-alikes, what
 * each source said, and the actions. The lead page shows it, and the Results page shows it in its
 * side panel (`compact`).
 *
 * Every text came from a web page or from Claude, so all of it is rendered as plain text, and every
 * link goes through `SourceLink` (http and https only, opens in a new tab, shows the host).
 *
 * The actions: Watch, Reject (with a reason) and Useful change the lead, and each shows a toast with
 * Undo, which sends back the exact values from before. Re-check costs money, so it asks first and
 * has no Undo. Send to HubSpot comes in Phase 5.
 */
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  CircleX,
  Flag,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { usePatchLead, useRecheckLead, useLeadSimilar, useRules } from '@/api/hooks'
import type { LeadDetail, LeadPatch, Schemas } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { HubSpotBadge } from '@/components/hubspot-badge'
import { Money } from '@/components/money'
import { ResultBadge } from '@/components/result-badge'
import { SourceLink } from '@/components/source-link'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import {
  formatDate,
  formatM2,
  formatNumber,
  formatPercent,
  formatScore,
  formatStaff,
} from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { cn } from '@/lib/utils'

type RuleCheck = Schemas['RuleCheck']
type Fact = Schemas['Fact_str_'] | Schemas['Fact_int_'] | Schemas['Fact_bool_']
type ScorePartOut = Schemas['ScorePart']
type DecisionMaker = Schemas['DecisionMaker']

const BAND_WORDS: Record<string, string> = {
  research_first: 'Research first',
  investigate: 'Investigate',
  nurture: 'Nurture',
}

const OUTCOME: Record<RuleCheck['outcome'], { icon: LucideIcon; word: string; tone: string }> = {
  ok: { icon: CircleCheck, word: 'Met', tone: 'text-pass' },
  fail: { icon: CircleX, word: 'Not met', tone: 'text-destructive' },
  director: { icon: UserCheck, word: 'Director review', tone: 'text-review' },
  unknown: { icon: CircleHelp, word: 'Not known', tone: 'text-muted-foreground' },
  flag: { icon: Flag, word: 'Check', tone: 'text-review' },
}

const LABEL_WORDS: Record<string, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimated',
  guessed: 'Guessed',
}

const REASON_WORDS: Record<string, string> = {
  close_name: 'close name',
  name_in_deal: 'name in a deal',
  similar_profile: 'similar profile',
}

function yesNo(value: unknown): string {
  return value === true ? 'Yes' : value === false ? 'No' : 'Not known'
}

function websiteHref(domain: unknown): string | null {
  return typeof domain === 'string' && domain !== '' ? `https://${domain}` : null
}

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-ui">{children}</CardContent>
    </Card>
  )
}

/**
 * Leaders a public page names (the company's site, annual report, ASX or news), each with that
 * page and its date. People change jobs, so the card says to check before calling.
 */
function DecisionMakers({ people }: { people: DecisionMaker[] }) {
  if (people.length === 0) {
    return <p className="text-muted-foreground">No decision makers named on a public page.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">Decision makers</p>
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li key={`${person.name} ${person.source_url}`} className="flex flex-col gap-0.5">
            <span>
              {person.name}, {person.role}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
              <SourceLink href={person.source_url} />
              {person.source_date ? <span>{person.source_date}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        From public pages. People change jobs, so check before you call.
      </p>
    </div>
  )
}

function FactRow({ label, value, fact }: { label: string; value: string; fact: Fact }) {
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-2 pr-4 text-left font-semibold sm:whitespace-nowrap">
        {label}
      </th>
      <td className="py-2 pr-4">{value}</td>
      <td className="py-2 pr-4">
        {fact.value !== null && fact.label ? (
          <Badge variant="outline">{LABEL_WORDS[fact.label] ?? fact.label}</Badge>
        ) : null}
      </td>
      <td className="py-2">{fact.source_url ? <SourceLink href={fact.source_url} /> : null}</td>
    </tr>
  )
}

/** The numbers another source filled in where the web research found none: one plain note each. */
function FromSource({ title, notes }: { title: string; notes: string[] }) {
  if (notes.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="list-disc pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

function Facts({ lead }: { lead: LeadDetail }) {
  const facts = lead.facts
  const staff = typeof facts.staff_in_city.value === 'number' ? facts.staff_in_city.value : null
  const m2 = typeof facts.office_m2.value === 'number' ? facts.office_m2.value : null
  const needed = typeof facts.size_needed_m2.value === 'number' ? facts.size_needed_m2.value : null
  const text = (fact: Fact): string =>
    typeof fact.value === 'string' && fact.value !== '' ? fact.value : 'Not known'
  return (
    <Section title="Facts">
      {/* On a narrow screen the table scrolls inside the card instead of widening the page. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-ui">
          <caption className="sr-only">Facts about {lead.company}, with their sources</caption>
          <tbody>
            <tr className="border-b">
              <th scope="row" className="py-2 pr-4 text-left font-semibold">
                Website
              </th>
              <td className="py-2 pr-4" colSpan={3}>
                {websiteHref(facts.website.value) ? (
                  <SourceLink
                    href={websiteHref(facts.website.value)}
                    label={String(facts.website.value)}
                  />
                ) : (
                  'Not known'
                )}
              </td>
            </tr>
            <FactRow label="City" value={text(facts.city)} fact={facts.city} />
            <FactRow label="Industry" value={text(facts.industry)} fact={facts.industry} />
            <FactRow label="Owner" value={text(facts.owner)} fact={facts.owner} />
            <FactRow
              label="Staff in the city"
              value={
                staff === null
                  ? 'Not known'
                  : `${formatStaff(staff)}${facts.staff_from_linkedin ? ' on LinkedIn' : ''}`
              }
              fact={facts.staff_in_city}
            />
            <FactRow
              label="Office size"
              value={m2 === null ? 'Not known' : formatM2(m2, lead.office_m2_estimated)}
              fact={facts.office_m2}
            />
            <FactRow
              label="Local team runs the project"
              value={yesNo(facts.local_team_runs_project.value)}
              fact={facts.local_team_runs_project}
            />
            <FactRow
              label="Healthy business"
              value={yesNo(facts.healthy.value)}
              fact={facts.healthy}
            />
            <FactRow
              label="The office matters"
              value={yesNo(facts.office_matters.value)}
              fact={facts.office_matters}
            />
            <FactRow
              label="Expected move"
              value={text(facts.expected_move)}
              fact={facts.expected_move}
            />
            <FactRow
              label="At this address since"
              value={text(facts.office_since)}
              fact={facts.office_since}
            />
            <FactRow
              label="Last move or fitout"
              value={text(facts.last_fitout)}
              fact={facts.last_fitout}
            />
            {facts.growth_plan.value === true ? (
              <FactRow
                label="Growing"
                value={
                  needed === null
                    ? 'Yes'
                    : `Will need about ${formatM2(needed)}${facts.growth_by.value ? ` by ${String(facts.growth_by.value)}` : ''}`
                }
                fact={facts.growth_plan}
              />
            ) : null}
          </tbody>
        </table>
      </div>
      <FromSource title="From HubSpot" notes={lead.from_hubspot} />
      <FromSource title="From Signal Hire" notes={lead.from_signalhire} />
      {lead.fitout_aud ? (
        <p className="text-muted-foreground">
          Fitout worth about <Money value={lead.fitout_aud} currency="AUD" decimals={0} />, at the
          minimum rate per m².
        </p>
      ) : null}
    </Section>
  )
}

function Rules({ lead }: { lead: LeadDetail }) {
  return (
    <Section title="Why this result">
      <p>{lead.why_it_fits}</p>
      <ul className="flex flex-col gap-1" aria-label="Each rule">
        {lead.checks.map((check, index) => {
          const meta = OUTCOME[check.outcome]
          const Icon = meta.icon
          return (
            <li key={`${check.rule}-${index}`}>
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted touch:min-h-11">
                  <Icon aria-hidden="true" className={cn('size-4 shrink-0', meta.tone)} />
                  <span className="font-semibold">{check.rule}</span>
                  <span className="text-muted-foreground">{meta.word}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="ml-auto size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-8 pb-2 text-muted-foreground">
                  {check.detail}
                </CollapsibleContent>
              </Collapsible>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function ScoreSection({ lead }: { lead: LeadDetail }) {
  if (lead.score_parts.length === 0) {
    return (
      <Section title="Score">
        <p className="text-muted-foreground">
          {lead.result === 'drop'
            ? 'A dropped company is not scored.'
            : 'This lead was scored under version 1 of the rules, so it has no parts.'}
        </p>
      </Section>
    )
  }
  return (
    <Section title="Score">
      <p>
        The tool could check {formatNumber(lead.score_checked ?? 0)} of the 100 points. Sales fills
        in the rest after the first call.
      </p>
      <ul className="flex flex-col gap-1" aria-label="Each part of the score">
        {lead.score_parts.map((part: ScorePartOut) => (
          <li key={part.id}>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted touch:min-h-11">
                <span className="font-semibold">{part.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {part.earned} of {part.checked} checked
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="ml-auto size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-2">
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {part.checks.map((check) => (
                    <li key={check.id} className="flex flex-wrap gap-x-2">
                      <span className="text-foreground">{check.label}</span>
                      <span className="tabular-nums">
                        {check.known ? `${check.earned} of ${check.max}` : 'Not known yet'}
                      </span>
                      {check.known && check.detail ? <span>{check.detail}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-caption text-muted-foreground">
                  The part is worth {part.max} points.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** The Profile's timing advice. The tool can't see when a consultant is appointed. */
function ConsultantNote() {
  const rules = useRules()
  const months = rules.data?.criteria.triggers.consultant_window_months
  if (!months) {
    return null
  }
  return (
    <p className="text-caption text-muted-foreground">
      Best timing is before a consultant is appointed. That is usually within {months} months of the
      project, and the tool can&apos;t see it.
    </p>
  )
}

function Triggers({ lead }: { lead: LeadDetail }) {
  if (lead.triggers.length === 0) {
    return (
      <Section title="Signs of an office change">
        <p className="text-muted-foreground">No sign that counts was found.</p>
        <ConsultantNote />
      </Section>
    )
  }
  return (
    <Section title="Signs of an office change">
      <ul className="flex flex-col gap-3">
        {lead.triggers.map(({ trigger, points }, index) => (
          <li key={`${trigger.id}-${index}`} className="flex flex-col gap-1">
            <p>{trigger.what_happened}</p>
            <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              {trigger.date ? <span>{trigger.date}</span> : <span>Date not known</span>}
              <Badge variant="outline">{LABEL_WORDS[trigger.label] ?? trigger.label}</Badge>
              <span>{points} points</span>
              <SourceLink href={trigger.source_url} />
            </p>
          </li>
        ))}
      </ul>
      <ConsultantNote />
    </Section>
  )
}

function HubSpot({ lead }: { lead: LeadDetail }) {
  const hubspot = lead.hubspot
  return (
    <Section title="HubSpot">
      <div className="flex flex-wrap items-center gap-2">
        <HubSpotBadge status={hubspot.status} />
        {hubspot.name ? <span>{hubspot.name}</span> : null}
        {hubspot.owner ? (
          <span className="text-muted-foreground">Owner: {hubspot.owner}</span>
        ) : null}
      </div>
      {hubspot.open_deals.length > 0 ? <p>Open deals: {hubspot.open_deals.join('; ')}</p> : null}
      {hubspot.last_dissolved ? (
        <p className="text-muted-foreground">
          Last deal dissolved {formatDate(hubspot.last_dissolved)}
        </p>
      ) : null}
      {hubspot.candidates.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Might be the same company. A person confirms.</p>
          <ul className="flex flex-col gap-1">
            {hubspot.candidates.map((candidate) => (
              <li key={candidate.hubspot_id}>
                {candidate.name}{' '}
                <span className="text-muted-foreground">
                  ({REASON_WORDS[candidate.reason] ?? candidate.reason},{' '}
                  {formatPercent(candidate.score * 100)} alike
                  {candidate.open_deals.length > 0 ? ', has an open deal' : ''})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}

function LookAlikes({ leadId }: { leadId: string }) {
  const similar = useLeadSimilar(leadId)
  if (similar.error) {
    return (
      <Section title="Look-alikes">
        <ErrorState error={similar.error} context="The look-alikes couldn't be loaded." />
      </Section>
    )
  }
  const data = similar.data
  return (
    <Section title="Look-alikes">
      {!data ? (
        <p className="text-muted-foreground">Loading.</p>
      ) : data.basis === 'none' ? (
        <p className="text-muted-foreground">{data.note ?? 'This lead has no profile yet.'}</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Clients with deals, and other leads, that read alike.
          </p>
          {data.deals.length > 0 ? (
            <ul aria-label="Similar clients" className="flex flex-col gap-1">
              {data.deals.map((deal) => (
                <li key={deal.hubspot_id}>
                  {deal.name}{' '}
                  <span className="text-muted-foreground">
                    ({formatPercent(deal.similarity * 100)} alike
                    {deal.deal_names.length > 0 ? `: ${deal.deal_names.join('; ')}` : ''})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {data.leads.length > 0 ? (
            <ul aria-label="Similar leads" className="flex flex-col gap-1">
              {data.leads.map((item) => (
                <li key={item.lead_id} className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/leads/${item.lead_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </Link>
                  <ResultBadge result={item.result} />
                  <span className="text-muted-foreground">
                    {formatPercent(item.similarity * 100)} alike
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {data.deals.length === 0 && data.leads.length === 0 ? (
            <p className="text-muted-foreground">Nothing reads alike yet.</p>
          ) : null}
        </>
      )}
    </Section>
  )
}

function Notes({ lead }: { lead: LeadDetail }) {
  if (lead.notes.length === 0) return null
  return (
    <Section title="What each source said">
      <p className="text-caption text-muted-foreground">
        A summary of each page in Claude&apos;s words, not a quote.
      </p>
      <ul className="flex flex-col gap-3">
        {lead.notes.map((note, index) => (
          <li key={`${note.url}-${index}`} className="flex flex-col gap-1">
            <p>{note.claim}</p>
            <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span>{note.angle}</span>
              {note.published ? <span>{note.published}</span> : null}
              {note.from_memory ? <span>From memory</span> : null}
              <SourceLink href={note.url} />
            </p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** The values a change touches, as they were before it, for Undo. */
function before(lead: LeadDetail, patch: LeadPatch): LeadPatch {
  const previous: LeadPatch = {}
  if ('status' in patch) previous.status = lead.status === 'sent' ? 'new' : lead.status
  if ('status' in patch || 'reject_reason' in patch) previous.reject_reason = lead.reject_reason
  if ('useful' in patch) previous.useful = lead.useful
  if ('note' in patch) previous.note = lead.note
  return previous
}

function Actions({ lead }: { lead: LeadDetail }) {
  const navigate = useNavigate()
  const patchLead = usePatchLead()
  const recheck = useRecheckLead()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const change = (patch: LeadPatch, done: string, onDone?: () => void): void => {
    const undo = before(lead, patch)
    patchLead.mutate(
      { leadId: lead.id, patch },
      {
        onSuccess: () => {
          onDone?.()
          toast(done, {
            action: {
              label: 'Undo',
              onClick: () => {
                patchLead.mutate({ leadId: lead.id, patch: undo }, { onError: toastProblem })
              },
            },
          })
        },
        onError: toastProblem,
      },
    )
  }

  const watching = lead.status === 'watching'
  return (
    <div
      // A phone gets a tidy two-column grid of equal buttons; wider screens keep one wrapping row.
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center max-sm:[&>button]:w-full"
      role="group"
      aria-label="Actions"
    >
      <Button
        type="button"
        variant="outline"
        disabled={patchLead.isPending || lead.status === 'sent'}
        onClick={() => {
          change(
            { status: watching ? 'new' : 'watching' },
            watching ? 'Not watching any more.' : 'Watching.',
          )
        }}
      >
        {watching ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        {watching ? 'Stop watching' : 'Watch'}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={patchLead.isPending || lead.status === 'rejected' || lead.status === 'sent'}
        onClick={() => {
          setReason('')
          setReasonError(null)
          setRejecting(true)
        }}
      >
        <XCircle aria-hidden="true" />
        Reject
      </Button>
      <Button
        type="button"
        variant={lead.useful === true ? 'secondary' : 'ghost'}
        aria-pressed={lead.useful === true}
        disabled={patchLead.isPending}
        onClick={() => {
          change({ useful: lead.useful === true ? null : true }, 'Thanks. Marked as useful.')
        }}
      >
        <ThumbsUp aria-hidden="true" />
        Useful
      </Button>
      <Button
        type="button"
        variant={lead.useful === false ? 'secondary' : 'ghost'}
        aria-pressed={lead.useful === false}
        disabled={patchLead.isPending}
        onClick={() => {
          change({ useful: lead.useful === false ? null : false }, 'Thanks. Marked as not useful.')
        }}
      >
        <ThumbsDown aria-hidden="true" />
        Not useful
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" disabled={recheck.isPending}>
            <RefreshCw aria-hidden="true" />
            Re-check
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Research {lead.company} again?</AlertDialogTitle>
            <AlertDialogDescription>
              This searches the web again, even where memory is fresh. It costs money: up to the
              company cap, last time <Money value={lead.research.cost_usd} />. It can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                recheck.mutate(lead.id, {
                  onSuccess: (run) => {
                    void navigate(`/runs/${run.id}`)
                  },
                  onError: toastProblem,
                })
              }}
            >
              Research again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="inline-flex flex-col gap-2 max-sm:col-span-2 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" disabled aria-describedby={`send-${lead.id}`}>
          <Send aria-hidden="true" />
          Send to HubSpot
        </Button>
        <span id={`send-${lead.id}`} className="text-caption text-muted-foreground">
          Sending to HubSpot comes in Phase 5.
        </span>
      </span>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {lead.company}</DialogTitle>
            <DialogDescription>
              Say why, so the rules can learn from it. You can undo this.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`reason-${lead.id}`}>Reason</FieldLabel>
            <Textarea
              id={`reason-${lead.id}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
              }}
              aria-invalid={reasonError ? true : undefined}
              placeholder="Too small for us, or already with another fitout company"
            />
            {reasonError ? <FieldError>{reasonError}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRejecting(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={patchLead.isPending}
              onClick={() => {
                if (reason.trim() === '') {
                  setReasonError('Say why it is rejected.')
                  return
                }
                change({ status: 'rejected', reject_reason: reason.trim() }, 'Rejected.', () => {
                  setRejecting(false)
                })
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export interface LeadCardViewProps {
  lead: LeadDetail
  /** For the side panel: no title (the panel has one), and the sections in one column. */
  compact?: boolean
}

export function LeadCardView({ lead, compact = false }: LeadCardViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ResultBadge result={lead.result} />
          {lead.stage ? <span className="text-ui text-muted-foreground">{lead.stage}</span> : null}
          <span className="text-ui tabular-nums">
            Score {formatScore(lead.score, lead.score_checked)}
            {lead.score_checked ? ' checked' : ''}
          </span>
          {lead.band ? <Badge variant="outline">{BAND_WORDS[lead.band] ?? lead.band}</Badge> : null}
          <StatusBadge status={lead.status} />
          {lead.is_test ? <Badge variant="outline">Test set</Badge> : null}
        </div>
        <p className="max-w-prose text-body">{lead.summary}</p>
        {lead.status === 'rejected' && lead.reject_reason ? (
          <p className="text-ui text-muted-foreground">Rejected: {lead.reject_reason}</p>
        ) : null}
        <Actions lead={lead} />
      </div>
      <div className={cn('grid gap-6', !compact && 'xl:grid-cols-2')}>
        <Rules lead={lead} />
        <ScoreSection lead={lead} />
        <Facts lead={lead} />
        <Triggers lead={lead} />
        <HubSpot lead={lead} />
        <Section title="Who to talk to">
          <p>{lead.contact_role ?? 'Not known yet.'}</p>
          <DecisionMakers people={lead.facts.decision_makers} />
          {lead.opening_line ? (
            <p className="font-serif">&ldquo;{lead.opening_line}&rdquo;</p>
          ) : null}
          {lead.facts.talking_points.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Talking points</p>
              <ul className="list-disc pl-5">
                {lead.facts.talking_points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {lead.facts.fitout_contractors.length > 0 ? (
            <p className="text-muted-foreground">
              Past fitout firms: {lead.facts.fitout_contractors.join(', ')}
            </p>
          ) : null}
        </Section>
        <LookAlikes leadId={lead.id} />
        <Notes lead={lead} />
        <Section title="Research">
          <p>
            Cost <Money value={lead.research.cost_usd} /> of a{' '}
            <Money value={lead.research.cap_usd} /> cap, {formatNumber(lead.research.web_searches)}{' '}
            web searches.
          </p>
          {lead.problems.length > 0 ? (
            <ul className="list-disc pl-5 text-muted-foreground">
              {lead.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          {lead.dropped.length > 0 ? (
            <p className="text-muted-foreground">
              Left out by the source check: {lead.dropped.join('; ')}
            </p>
          ) : null}
          {lead.run_id ? (
            <Link to={`/runs/${lead.run_id}`} className="underline-offset-4 hover:underline">
              Open the run that found it
            </Link>
          ) : null}
          {lead.previous.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Researched before</p>
              <ul className="flex flex-col gap-1">
                {lead.previous.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <Link to={`/leads/${item.id}`} className="underline-offset-4 hover:underline">
                      {formatDate(item.created_at)}
                    </Link>
                    <ResultBadge result={item.result} />
                    <span className="tabular-nums">Score {item.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  )
}
