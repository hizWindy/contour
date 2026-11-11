/**
 * Rules: the rules a company is checked against, read only (a Lead Finder page, once an Admin
 * tab; redesigned in PLAN-V13 T2-6). They live in the rules files (`apps/lead_finder/rules/`).
 *
 * A segmented control at the top jumps to a section. Each rule is one compact row: the rule in
 * plain words, its number in table digits, and a mark when it is TBC or changed on 9 Nov. The
 * score is one bar split into its parts. The signs are grouped as Claude reads them. "Waiting on
 * Levi" lists every TBC rule, beside the rules on a laptop and under them on a phone.
 */
import { Check, Minus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useRules } from '@/api/hooks'
import { ErrorState } from '@/components/error-state'
import { Reveal, Segmented } from '@/components/motion'
import { PendingCards } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber, pluralise } from '@/lib/format'
import { resultLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { ScoreBar } from './score-bar'
import {
  CHANGED,
  keyWords,
  list,
  NAME_CHECK_WORDS,
  RANK_WORDS,
  SECTIONS,
  sources,
  tbcByKey,
  type Rules,
  type SectionId,
  type TbcNote,
} from './words'

/** A rule in one row: the words, then the value in table digits, with its marks. */
function Row({
  label,
  rule,
  tbc,
  children,
}: {
  label: ReactNode
  /** The rule's key in the rules files, for the TBC and "Changed" marks. */
  rule?: string
  tbc: Map<string, TbcNote>
  children: ReactNode
}) {
  const note = rule ? tbc.get(rule) : undefined
  const changed = rule ? CHANGED[rule] : undefined
  return (
    <div
      data-slot="rule-row"
      data-rule={rule}
      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b py-2 text-ui last:border-0"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span>{label}</span>
        {changed ? <span className="text-caption text-accent-ink">{changed}</span> : null}
        {note ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-help">
                TBC
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{note.note}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}

/** Yes or no, with an icon and a word. */
function YesNo({ value }: { value: boolean }) {
  const Icon = value ? Check : Minus
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-4" />
      {value ? 'Yes' : 'No'}
    </span>
  )
}

/** A section card: a title, one line under it, a thin line, then its rows. */
function Section({
  id,
  index,
  title,
  description,
  tbc,
  children,
}: {
  id: SectionId
  index: number
  title: string
  description: string
  /** A TBC note on the whole section (its key is the section's, like "score"). */
  tbc?: TbcNote
  children: ReactNode
}) {
  return (
    <Reveal index={index}>
      <Card id={`rules-${id}`} data-section={id} className="scroll-mt-20">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-section font-semibold">
            {title}
            {tbc ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help">
                    TBC
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{tbc.note}</TooltipContent>
              </Tooltip>
            ) : null}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">{children}</CardContent>
      </Card>
    </Reveal>
  )
}

/** A sign as Claude reads it: its label, with its code name in small print. */
function Sign({
  item,
  rule,
  tbc,
}: {
  item: { id: string; label: string }
  rule?: string
  tbc: Map<string, TbcNote>
}) {
  return (
    <Row label={item.label} rule={rule} tbc={tbc}>
      <span className="text-caption text-muted-foreground">{item.id}</span>
    </Row>
  )
}

function SignGroup({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col pt-2 first:pt-0">
      <p className="flex items-baseline gap-2 pb-1 font-semibold">
        {title}
        {hint ? (
          <span className="text-caption font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </p>
      {children}
    </div>
  )
}

/** One TBC rule in the "Waiting on Levi" list: the rule in words, and the note behind "More". */
function Waiting({ note }: { note: TbcNote }) {
  const [open, setOpen] = useState(false)
  const long = note.note.length > 140
  return (
    <li className="flex flex-col gap-0.5 border-b py-2 text-ui last:border-0">
      <span className="font-semibold">{keyWords(note.key)}</span>
      <span className="text-caption text-muted-foreground">{note.key}</span>
      <span className={cn('text-caption', !open && long && 'line-clamp-2')}>{note.note}</span>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="self-start text-caption font-semibold text-link underline-offset-4 hover:underline"
        >
          {open ? 'Less' : 'More'}
        </button>
      ) : null}
    </li>
  )
}

export default function RulesView() {
  const rules = useRules()
  if (rules.error) {
    return <ErrorState error={rules.error} context="The rules couldn't be loaded." />
  }
  if (!rules.data) {
    return <PendingCards label="Loading the rules." cards={3} />
  }
  return <RulesLoaded rules={rules.data} />
}

/**
 * The segmented control that jumps to a section, and follows the section in view while the
 * page scrolls. It owns that state, so a jump re-renders this bar and nothing else: the eight
 * sections and the "Waiting on Levi" list stay as they are (the speed budget, T2-9).
 */
function JumpBar({ main }: { main: RefObject<HTMLDivElement | null> }) {
  const [section, setSection] = useState<SectionId>('cities')

  function jump(id: SectionId) {
    setSection(id)
    document.getElementById(`rules-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const root = main.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((entry) => entry.isIntersecting)
        const id = seen?.target.getAttribute('data-section') as SectionId | null
        if (id) setSection(id)
      },
      { rootMargin: '-20% 0px -70% 0px' },
    )
    root.querySelectorAll('[data-section]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [main])

  return (
    <Segmented
      aria-label="Jump to a section"
      options={SECTIONS}
      value={section}
      onChange={jump}
      size="sm"
    />
  )
}

function RulesLoaded({ rules }: { rules: Rules }) {
  const { criteria: c, watchlist, version } = rules
  const tbc = tbcByKey(rules)
  const waiting = [...c.tbc, ...watchlist.tbc]
  const main = useRef<HTMLDivElement>(null)

  const signLabel = (id: string) =>
    [...c.triggers.main, ...c.triggers.other, ...c.triggers.weak].find((t) => t.id === id)?.label ??
    id
  const watchBand = c.size.staff_hint_min > c.size.staff_floor

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-background px-4 py-2 sm:mx-0 sm:px-0">
        <JumpBar main={main} />
        <p className="text-caption text-muted-foreground">
          Version <span className="font-semibold text-foreground">{version}</span>. {c.label}.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div ref={main} className="flex min-w-0 flex-col gap-6">
          <Section
            id="cities"
            index={0}
            title="Cities"
            description="Where a company's office has to be."
          >
            <Row label="Can pass" tbc={tbc}>
              {list(c.cities.pass)}
            </Row>
            <Row label="Director review" tbc={tbc}>
              {list(c.cities.director_review) || 'None'}
            </Row>
            <Row label="Any other city" tbc={tbc}>
              {c.cities.other_cities === 'drop' ? 'Dropped' : 'Director review'}
            </Row>
            <Row label="Overseas, no city named yet" rule="cities.no_city_director_signs" tbc={tbc}>
              {(c.cities.no_city_director_signs ?? []).length
                ? `Director review, when the sign is "${list((c.cities.no_city_director_signs ?? []).map(signLabel))}"`
                : 'Watch'}
            </Row>
          </Section>

          <Section
            id="size"
            index={1}
            title="Size"
            description="The office that fits, and the staff that stand in for it when the size is unknown."
          >
            <Row label="An office that fits" tbc={tbc}>
              {formatNumber(c.size.office_m2_min)} to {formatNumber(c.size.office_m2_max)} m²
            </Row>
            <Row label="A Director decides from" rule="size.director_band_m2" tbc={tbc}>
              {formatNumber(c.size.director_band_m2[0])} m² up to{' '}
              {formatNumber(c.size.office_m2_min)} m²
            </Row>
            <Row label="Fitout rate" tbc={tbc}>
              A${formatNumber(Number(c.fitout.rate_per_m2_aud))} a m²
            </Row>
            <Row
              label="Staff that fits, when the office size is unknown"
              rule="size.staff_hint_min"
              tbc={tbc}
            >
              {c.size.staff_hint_min}+
            </Row>
            {watchBand ? (
              <Row label='A Watch with a "check office size" flag' tbc={tbc}>
                {c.size.staff_floor} to {c.size.staff_hint_min - 1}
              </Row>
            ) : null}
            <Row label="Too small, dropped" rule="size.staff_floor" tbc={tbc}>
              under {c.size.staff_floor}
            </Row>
            <Row label="Over this, a Director decides" tbc={tbc}>
              {formatNumber(c.size.staff_max)} staff
            </Row>
            <Row label="Staff counted" rule="size.staff_counted_in" tbc={tbc}>
              {c.size.staff_counted_in === 'city' ? 'in the city' : 'across the company'}
            </Row>
            <Row label="Office size from staff" rule="size.m2_per_staff" tbc={tbc}>
              {formatNumber(c.size.m2_per_staff)} m² a person
            </Row>
            <Row label="The HubSpot watchlist starts at" rule="size.staff_min" tbc={tbc}>
              {c.size.staff_min}+ staff
            </Row>
            <Row
              label="Small but growing still fits, within"
              rule="size.grow_into_range_months"
              tbc={tbc}
            >
              {c.size.grow_into_range_months} months
            </Row>
            <Row label="Growth signs, always researched" rule="size.growth_signs" tbc={tbc}>
              <span className="text-caption">{(c.size.growth_signs ?? []).join(', ')}</span>
            </Row>
            <Row
              label="LinkedIn's count, multiplied by"
              rule="size.linkedin_staff_multiplier"
              tbc={tbc}
            >
              {formatNumber(c.size.linkedin_staff_multiplier)}
            </Row>
            <Row
              label="Signal Hire's count, multiplied by"
              rule="size.headcount_tool_multiplier"
              tbc={tbc}
            >
              {formatNumber(c.size.headcount_tool_multiplier)}
            </Row>
            <Row label="Signal Hire's name check" rule="size.headcount_tool_name_check" tbc={tbc}>
              <span className="text-caption">
                {c.size.headcount_tool_name_check}:{' '}
                {NAME_CHECK_WORDS[c.size.headcount_tool_name_check] ?? ''}
              </span>
            </Row>
            <p className="pt-3 text-caption text-muted-foreground">
              An overseas company that announces an office here big enough fits too. A company that
              HubSpot and Signal Hire both say has under {c.size.staff_floor} staff, with no growth
              sign, is dropped before any paid search.
            </p>
          </Section>

          <Section
            id="signs"
            index={2}
            title="Signs of an office change"
            description="Each sign as Claude reads it, with its code name. A main sign can make a Pass; the others add to it."
            tbc={tbc.get('triggers')}
          >
            <SignGroup title="Main" hint={`${c.triggers.main.length}`}>
              {c.triggers.main.map((item) => (
                <Sign key={item.id} item={item} rule={`triggers.main.${item.id}`} tbc={tbc} />
              ))}
            </SignGroup>
            <SignGroup title="Boosters" hint="evidence that lifts the score">
              {c.boosters.map((item) => (
                <Sign
                  key={item.id}
                  item={item}
                  rule={item.id === c.boosters[0]?.id ? 'boosters' : undefined}
                  tbc={tbc}
                />
              ))}
            </SignGroup>
            <SignGroup title="Other" hint="worth less than a main sign">
              {c.triggers.other.map((item) => (
                <Sign key={item.id} item={item} tbc={tbc} />
              ))}
            </SignGroup>
            <SignGroup title="Weak" hint="ranks after real news">
              {c.triggers.weak.map((item) => (
                <Sign key={item.id} item={item} tbc={tbc} />
              ))}
            </SignGroup>
            <p className="pt-3 text-caption text-muted-foreground">
              The old office&apos;s sign ({c.office_age.tenure_years}+ years at the same address)
              comes from the office dates, never from a search.
            </p>
          </Section>

          <Section
            id="timing"
            index={3}
            title="Timing"
            description="How old an event can be, and what the office's age says."
          >
            <Row label="An event still counts for" rule="triggers.recent_months" tbc={tbc}>
              {c.triggers.recent_months} months
            </Row>
            <Row label="A lease end counts within" tbc={tbc}>
              {c.triggers.window_years} years
            </Row>
            <Row
              label="The best window for a lease end"
              rule="triggers.best_window_years"
              tbc={tbc}
            >
              {c.triggers.best_window_years[0]} to {c.triggers.best_window_years[1]} years
            </Row>
            <Row
              label="A consultant is probably already hired within"
              rule="triggers.consultant_window_months"
              tbc={tbc}
            >
              {c.triggers.consultant_window_months} months
            </Row>
            <Row label="Due for a change after" rule="office_age.due_years" tbc={tbc}>
              {c.office_age.due_years} years at the same address
            </Row>
            <Row label="A recent move or fitout" rule="office_age.recent_move_years" tbc={tbc}>
              the last {c.office_age.recent_move_years} years
            </Row>
            <Row label="Just moved, so a Watch" rule="office_age.just_moved_months" tbc={tbc}>
              the last {c.office_age.just_moved_months} months
            </Row>
            <Row label="An old office, a main sign" rule="office_age.tenure_years" tbc={tbc}>
              {c.office_age.tenure_years}+ years at the same address
            </Row>
            {c.office_age.lease_guess_years ? (
              <Row
                label="The lease guess on Why now, estimated"
                rule="office_age.lease_guess_years"
                tbc={tbc}
              >
                {c.office_age.lease_guess_years[0]} to {c.office_age.lease_guess_years[1]} years
                after the move-in
              </Row>
            ) : null}
          </Section>

          <Section
            id="score"
            index={4}
            title="Score"
            description="Six parts that add up to 100. Point at a part to see its checks."
            tbc={tbc.get('score')}
          >
            <div className="py-2">
              <ScoreBar score={c.score} />
            </div>
            <Row label="Research first" tbc={tbc}>
              {c.score.bands.research_first} to 100
            </Row>
            <Row label="Investigate" tbc={tbc}>
              {c.score.bands.investigate} to {c.score.bands.research_first - 1}
            </Row>
            <Row label="Nurture" tbc={tbc}>
              under {c.score.bands.investigate}
            </Row>
            <Row label="The bands use" rule="score.band_basis" tbc={tbc}>
              {c.score.band_basis === 'scaled'
                ? 'the points scaled to the points checked'
                : 'the raw points'}
            </Row>
            <Row label="Years at the same address" rule="score.years_at_address" tbc={tbc}>
              {c.score.years_at_address} points
            </Row>
            <Row label="No recent move or fitout" rule="score.no_recent_move" tbc={tbc}>
              {c.score.no_recent_move} points
            </Row>
            {Object.entries(c.stages).map(([result, stage]) => (
              <Row key={result} label={`${resultLabel(result)} in HubSpot`} tbc={tbc}>
                {stage}
              </Row>
            ))}
          </Section>

          <Section
            id="industries"
            index={5}
            title="Industries and fit"
            description="Which industries score, which get a Director, and which get an office check."
          >
            <Row label="Tier 1" rule="industries.tier_1" tbc={tbc}>
              <span className="text-caption">{list(c.industries.tier_1)}</span>
            </Row>
            <Row label="Tier 2" rule="industries.tier_2" tbc={tbc}>
              <span className="text-caption">{list(c.industries.tier_2)}</span>
            </Row>
            <Row label="Director review" tbc={tbc}>
              <span className="text-caption">{list(c.industries.director_review)}</span>
            </Row>
            <Row
              label="An office check, because the office may not matter"
              rule="industries.check_office_size"
              tbc={tbc}
            >
              <span className="text-caption">{list(c.industries.check_office_size)}</span>
            </Row>
            <Row
              label="The local team runs the project"
              rule="fit.local_team_runs_project"
              tbc={tbc}
            >
              <YesNo value={c.fit.local_team_runs_project} />
            </Row>
            <Row label="The company is healthy" rule="fit.healthy" tbc={tbc}>
              <YesNo value={c.fit.healthy} />
            </Row>
            <Row label="Rivals of a booming company" rule="rivals" tbc={tbc}>
              {c.rivals.enabled
                ? `up to ${c.rivals.per_lead} a lead, ${c.rivals.per_run} a run, in ${list(c.rivals.tiers.map((t) => t.replace('_', ' ')))}`
                : 'Switched off'}
            </Row>
          </Section>

          <Section
            id="never"
            index={6}
            title="Never suggest"
            description="Companies a run leaves out, whatever their signs."
          >
            <Row label="A company with an open deal" tbc={tbc}>
              <YesNo value={c.never_suggest.open_deal} />
            </Row>
            <Row label="A company already sent" tbc={tbc}>
              <YesNo value={c.never_suggest.already_sent} />
            </Row>
            <Row
              label="A dissolved deal waits, unless a new sign appears"
              rule="never_suggest.dissolved_deal_wait_months"
              tbc={tbc}
            >
              {c.never_suggest.dissolved_deal_wait_months} months
            </Row>
            <Row label="A company marked do not contact" tbc={tbc}>
              <YesNo value={c.never_suggest.do_not_contact} />
            </Row>
          </Section>

          <Section
            id="sources"
            index={7}
            title="Sources"
            description="Which source is main for which fact, how strong each kind of source is, and the sites never read."
            tbc={tbc.get('source_domains')}
          >
            <Row label="Staff in the city" rule="size.staff_sources" tbc={tbc}>
              <span className="text-caption">{sources(c.size.staff_sources)}</span>
            </Row>
            <Row label="Company name, website and industry" rule="data_sources" tbc={tbc}>
              <span className="text-caption">{sources(c.data_sources.company_details)}</span>
            </Row>
            <Row label="Cities with an office" tbc={tbc}>
              <span className="text-caption">{sources(c.data_sources.office_cities)}</span>
            </Row>
            <Row label="Decision makers" tbc={tbc}>
              <span className="text-caption">{sources(c.data_sources.decision_makers)}</span>
            </Row>
            <Row
              label="Staff numbers that disagree raise a flag from"
              rule="conflicts.staff_gap_ratio"
              tbc={tbc}
            >
              {formatNumber(c.conflicts.staff_gap_ratio)} times apart
            </Row>
            <Row label="Source strength, strongest first" tbc={tbc}>
              <span className="text-caption">
                {c.sources_rank.map((r) => RANK_WORDS[r] ?? r).join(', then ')}
              </span>
            </Row>
            <Row label="Official news sites" tbc={tbc}>
              <span className="text-caption">
                {c.source_domains.asx_or_official_news.join(', ')}
              </span>
            </Row>
            <Row label="Job ad sites" tbc={tbc}>
              <span className="text-caption">{c.source_domains.job_ads.join(', ')}</span>
            </Row>
            <Row label="Never read" tbc={tbc}>
              <span className="text-caption">{c.source_domains.blocked.join(', ')}</span>
            </Row>
            <Row label="Search angles for a company" tbc={tbc}>
              <span className="text-caption">{Object.keys(rules.queries.company).join(', ')}</span>
            </Row>
            <Row label="Discovery searches" tbc={tbc}>
              {pluralise(Object.keys(rules.queries.discovery).length, 'sign')} in{' '}
              {pluralise(Object.keys(rules.queries.areas).length, 'city', 'cities')}
            </Row>
          </Section>
        </div>

        <aside
          aria-labelledby="waiting-title"
          className="flex flex-col gap-2 rounded-lg border bg-card p-4 lg:sticky lg:top-16"
        >
          <h2 id="waiting-title" className="text-section font-semibold">
            Waiting on Levi{' '}
            <span className="text-muted-foreground tabular-nums">{waiting.length}</span>
          </h2>
          <p className="text-caption text-muted-foreground">
            Each rule marked TBC, with why. The number is the rule's value today.
          </p>
          {waiting.length === 0 ? (
            <p className="text-ui text-muted-foreground">Nothing is waiting.</p>
          ) : (
            <ul className="flex max-h-[70vh] flex-col overflow-y-auto">
              {waiting.map((note) => (
                <Waiting key={note.key} note={note} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
