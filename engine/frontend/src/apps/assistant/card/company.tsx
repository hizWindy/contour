/**
 * The company on the review card (PLAN-V22 T3-3; PLAN-V23 T1-6, "Words for when things go wrong"):
 * as found, to pick from two or more, or to find, and, when it is nowhere, to add to HubSpot.
 *
 * - **Found:** its name. Found by HubSpot's own search, a line under it: "Northwind is new in
 *   HubSpot. We'll use it."
 * - **Two or more:** "Which Sample?", each one a button.
 * - **None:** "We couldn't find 'North Wind' in HubSpot. Pick the company.", and the search list.
 * - **Nowhere, after HubSpot was searched (`can_add`):** "North Wind isn't in HubSpot. Add it, or
 *   pick another company.", "Add to HubSpot", and the search list. Add to HubSpot opens the name and
 *   a city, and checks HubSpot first (the preview, which writes nothing):
 *   - a company like it: "HubSpot already has Northwind. Use it, or add North Wind anyway.", with
 *     "Use Northwind" and "Add anyway";
 *   - the same name: the server's words, with that company to use;
 *   - adding switched off: "Adding companies to HubSpot is off for now. Pick a company that's
 *     there.", and the search list;
 *   - nothing like it: "Add to HubSpot" adds it.
 *   The add is a HubSpot write, so it waits for its own press, after the check. It goes with an
 *   Idempotency-Key, new for each name and city, so a double press or a retry makes one company.
 *   Then the card uses the new company.
 *
 * A company found here, after the command found nothing, teaches the mic the words heard once the
 * card is sent (`learnedOf`, T1-5).
 */
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { newIdempotencyKey, toApiProblem } from '@/api/client'
import { useCompanySearch } from '@/api/hooks'
import { addCompany, previewCompany } from '@/api/hooks/assistant-names'
import { queryKeys } from '@/api/query'
import type { AssistantCompanyIn, CompanyHit } from '@/api/types'
import { FIND_COMPANY, LOOKING, NO_MATCH } from '@/apps/companies/words'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebounced } from '@/hooks/useDebounced'
import { isPending, type Company, type CompanyFind } from './draft'
import { foundNote } from './lines'
import { CardLine, ChoiceList, PartProblem } from './parts'
import {
  ADD_ANYWAY,
  ADD_TO_HUBSPOT,
  ADDING,
  ADDING_OFF,
  BACK,
  CHECKING_HUBSPOT,
  CITY,
  CITY_HINT,
  COMPANY,
  COMPANY_NAME,
  isntInHubspotWords,
  likeItWords,
  noCompanyWords,
  NOTHING_LIKE_IT,
  pickWords,
  TRY_AGAIN,
  WHICH_COMPANY,
  whichWords,
} from './words'

/** How the company was picked: from the command's choices, by hand, or added to HubSpot. */
export type PickedHow = 'choice' | 'by_hand' | 'added'

export type OnPick = (company: Company, how: PickedHow) => void

/** A line of the company part, in plain words. */
function Line({ children }: { children: ReactNode }) {
  return <p className="text-ui text-pretty text-foreground">{children}</p>
}

/** A problem from the server, in its own words. */
function problemWords(error: unknown): string {
  const problem = toApiProblem(error)
  return [problem.title, problem.detail].filter(Boolean).join('. ')
}

// --- The search list ---------------------------------------------------------------------------

/** Find a company in our HubSpot copy: the box, then the matches. `line` goes above the box. */
export function CompanyPicker({
  heard,
  line,
  onPick,
}: {
  heard: string
  line: ReactNode
  onPick: (company: Company) => void
}) {
  const [text, setText] = useState(heard)
  const settled = useDebounced(text, 250)
  const search = useCompanySearch(settled)
  const hits: readonly CompanyHit[] =
    settled.trim().length >= 2 ? (search.data?.companies ?? []) : []
  const id = useId()
  const matches =
    hits.length > 0 ? (
      <ChoiceList
        label={WHICH_COMPANY}
        box="company"
        options={hits.slice(0, 6).map((hit) => ({
          id: hit.key,
          title: hit.name,
          detail: [hit.industry, hit.city].filter(Boolean).join(' · ') || null,
        }))}
        onPick={(key) => {
          const hit = hits.find((one) => one.key === key)
          if (hit) onPick({ key: hit.key, name: hit.name })
        }}
      />
    ) : null
  return (
    <div className="flex flex-col gap-3">
      {line}
      {/* The box with its label, like the card's other boxes, so it says what it is with words
          in it, and what the search found under it. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-caption text-muted-foreground">
          {FIND_COMPANY}
        </label>
        <Input
          id={id}
          data-box="company"
          autoComplete="off"
          value={text}
          className="touch:text-body"
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            // Down goes into the matches, which then move with the arrow keys.
            if (event.key !== 'ArrowDown') return
            const first = event.currentTarget
              .closest('[data-slot=company-picker]')
              ?.querySelector<HTMLButtonElement>('[data-slot=card-choice]')
            if (!first) return
            event.preventDefault()
            first.focus()
          }}
        />
        {!matches && settled.trim().length >= 2 ? (
          <p role="status" className="text-caption text-muted-foreground">
            {search.isFetching ? LOOKING : NO_MATCH}
          </p>
        ) : null}
      </div>
      {matches}
    </div>
  )
}

// --- Adding it to HubSpot ----------------------------------------------------------------------

function companyOf(hit: CompanyHit): Company {
  return { key: hit.key, name: hit.name }
}

/** The name and city to add, checked with HubSpot, then added on its own press. */
function AddForm({
  heard,
  previewMs,
  onPick,
  onBack,
}: {
  heard: string
  previewMs: number
  onPick: OnPick
  onBack: () => void
}) {
  const [name, setName] = useState(heard.trim())
  const [city, setCity] = useState('')
  // One key for each name and city: a retry of the same is safe, a changed one is a new add.
  const [key, setKey] = useState(newIdempotencyKey)
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** The add was refused because adding is off, or because HubSpot has the name: its words. */
  const [refused, setRefused] = useState<string | null>(null)
  const nameId = useId()
  const cityId = useId()
  const nameBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameBox.current?.focus()
  }, [])

  const body: AssistantCompanyIn = { name: name.trim(), city: city.trim() || null }
  const now = body.name === '' ? '' : JSON.stringify(body)
  const asked = useDebounced(now, previewMs)
  const preview = useQuery({
    queryKey: [...queryKeys.companies.all, 'assistant', 'company-preview', asked],
    queryFn: ({ signal }) => previewCompany(JSON.parse(asked) as AssistantCompanyIn, signal),
    enabled: asked !== '',
    retry: false,
    staleTime: 30_000,
  })
  // The check is for what the boxes hold now, and has answered.
  const checked = asked === now && now !== '' && preview.data !== undefined && !preview.isFetching
  const data = checked ? preview.data : undefined

  const change = (next: { name?: string; city?: string }): void => {
    if (next.name !== undefined) setName(next.name)
    if (next.city !== undefined) setCity(next.city)
    setKey(newIdempotencyKey())
    setProblem(null)
  }

  const add = (): void => {
    if (adding || !checked) return
    setAdding(true)
    setProblem(null)
    addCompany(body, key).then(
      (added) => {
        onPick({ key: added.company_key, name: added.company.name }, 'added')
      },
      (error: unknown) => {
        setAdding(false)
        const refusal = toApiProblem(error)
        if (refusal.code === 'hubspot_writing_off') {
          setRefused(ADDING_OFF)
        } else if (refusal.code === 'company_exists') {
          setRefused(refusal.detail ?? refusal.title)
        } else {
          setProblem(problemWords(error))
        }
      },
    )
  }

  // Adding is off, or HubSpot has the name already: the words, and the search list.
  if (refused || (data && !data.can_write)) {
    return (
      <CompanyPicker
        heard={name}
        line={<Line>{refused ?? ADDING_OFF}</Line>}
        onPick={(company) => {
          onPick(company, 'by_hand')
        }}
      />
    )
  }
  // The same name is in HubSpot (or our copy) already: the server's words, and that company.
  if (data?.exists) {
    const exists = data.exists
    return (
      <div className="flex flex-col gap-3">
        {data.sentence ? <Line>{data.sentence}</Line> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-box="company"
            className="touch:h-11"
            onClick={() => {
              onPick(companyOf(exists), 'by_hand')
            }}
          >
            {pickWords(exists.name)}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="touch:h-11" onClick={onBack}>
            {BACK}
          </Button>
        </div>
      </div>
    )
  }
  const like = data?.similar[0] ?? null
  // HubSpot didn't answer the check: say so, and offer it again.
  const failed = preview.isError && asked === now
  return (
    <div data-slot="company-add" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-caption text-muted-foreground">
            {COMPANY_NAME}
          </label>
          <Input
            ref={nameBox}
            id={nameId}
            data-box="company"
            value={name}
            maxLength={120}
            autoComplete="off"
            className="touch:text-body"
            aria-invalid={name.trim() === '' ? true : undefined}
            onChange={(event) => {
              change({ name: event.target.value })
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={cityId} className="text-caption text-muted-foreground">
            {CITY}
          </label>
          <Input
            id={cityId}
            value={city}
            maxLength={80}
            placeholder={CITY_HINT}
            autoComplete="off"
            className="touch:text-body"
            onChange={(event) => {
              change({ city: event.target.value })
            }}
          />
        </div>
      </div>
      {/* What the check says, in one place that keeps its height, so the buttons don't jump, and
          that a screen reader hears. Nothing while a name is still being typed. */}
      <div role="status" data-slot="company-check" className="min-h-6">
        {failed ? (
          <PartProblem>{problemWords(preview.error)}</PartProblem>
        ) : like ? (
          <Line>{data?.sentence ?? likeItWords(like.name, body.name)}</Line>
        ) : checked ? (
          <p className="text-ui text-pretty text-muted-foreground">{NOTHING_LIKE_IT}</p>
        ) : preview.isFetching ? (
          <p className="text-ui text-muted-foreground">{CHECKING_HUBSPOT}</p>
        ) : null}
      </div>
      {problem ? <PartProblem>{problem}</PartProblem> : null}
      <div className="flex flex-wrap items-center gap-2">
        {like ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            onClick={() => {
              onPick(companyOf(like), 'by_hand')
            }}
          >
            {pickWords(like.name)}
          </Button>
        ) : null}
        {failed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            onClick={() => {
              void preview.refetch()
            }}
          >
            {TRY_AGAIN}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-11"
            disabled={!checked || adding}
            onClick={add}
          >
            {like ? null : <Plus aria-hidden="true" />}
            {adding ? ADDING : like ? ADD_ANYWAY : ADD_TO_HUBSPOT}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="touch:h-11" onClick={onBack}>
          {BACK}
        </Button>
      </div>
    </div>
  )
}

/**
 * Nowhere, after HubSpot was searched: the plan's line, "Add to HubSpot", and the search list.
 * Add to HubSpot opens the add, with the name as heard.
 */
function AddCompany({
  heard,
  previewMs,
  onPick,
}: {
  heard: string
  previewMs: number
  onPick: OnPick
}) {
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const back = useRef(false)
  useEffect(() => {
    if (adding || !back.current) return
    back.current = false
    addButton.current?.focus()
  }, [adding])
  if (adding) {
    return (
      <AddForm
        heard={heard}
        previewMs={previewMs}
        onPick={onPick}
        onBack={() => {
          back.current = true
          setAdding(false)
        }}
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <Line>{isntInHubspotWords(heard)}</Line>
      <div>
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-11"
          onClick={() => {
            setAdding(true)
          }}
        >
          <Plus aria-hidden="true" />
          {ADD_TO_HUBSPOT}
        </Button>
      </div>
      <CompanyPicker
        heard={heard}
        line={null}
        onPick={(company) => {
          onPick(company, 'by_hand')
        }}
      />
    </div>
  )
}

// --- The company part --------------------------------------------------------------------------

/** The company: as found, to pick from two or more, to find, or to add. */
export function CompanyPart({
  company,
  onPick,
  previewMs,
}: {
  company: CompanyFind
  onPick: OnPick
  /** How long the add's check waits after the last key. */
  previewMs: number
}) {
  if (company.found) {
    const note = foundNote(company, company.found.name)
    return (
      <CardLine label={COMPANY}>
        {company.found.name}
        {note ? (
          <span
            data-slot="company-note"
            className="mt-0.5 block text-caption text-muted-foreground"
          >
            {note}
          </span>
        ) : null}
      </CardLine>
    )
  }
  if (isPending(company)) {
    return (
      <ChoiceList
        label={whichWords(company.heard, WHICH_COMPANY)}
        box="company"
        options={company.choices.map((one) => ({ id: one.key, title: one.name }))}
        onPick={(key) => {
          const picked = company.choices.find((one) => one.key === key)
          if (picked) onPick(picked, 'choice')
        }}
      />
    )
  }
  return (
    <div data-slot="company-picker">
      {company.canAdd ? (
        <AddCompany heard={company.heard} previewMs={previewMs} onPick={onPick} />
      ) : (
        <CompanyPicker
          heard={company.heard}
          line={<Line>{noCompanyWords(company.heard)}</Line>}
          onPick={(picked) => {
            onPick(picked, 'by_hand')
          }}
        />
      )}
    </div>
  )
}
