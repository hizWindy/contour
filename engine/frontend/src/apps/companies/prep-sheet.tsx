/**
 * The prep card (PLAN-V10 D4 and F1): what to know and say on one call, in a side panel from the
 * right. The company's full record opens in the middle instead (`company-dialog.tsx`): call prep is
 * the thing done all day, so it gets the narrow, quick panel and the list stays in view beside it.
 *
 * - **One column, top to bottom, in the order of the call:** who you are calling, Still there?,
 *   Last talk and News (`before-you-dial.tsx`, in the header, which doesn't scroll), then the last
 *   call's note, then the script (opener, why now, questions, if they say, goal). Quick facts sit
 *   folded under "More about" at the end. The number and Copy script stay at the bottom.
 * - **At once:** the sales script and the guided questions are written here from what we already
 *   know (`playbook.ts`). Free, and ready as the card opens.
 * - **Then complete:** with call prep switched on, Claude checks the web for news and "still
 *   there?" and writes its own script. It cross-fades in where the free one was, so nothing jumps.
 *   Its lines show their sources (F for a fact we had, W for a web page found).
 * - **The list stays usable** on a laptop: the panel doesn't block the page, so "Prep" on another
 *   row, or P on the active row, switches the panel to that company. Esc or Close shuts it, and
 *   focus goes back to the row's Prep button.
 * - **A company with no person** asks "Who are you calling?", with "Prep a cold call" for the
 *   switchboard.
 * - **Log call** (PLAN-V17 T3-5): with call notes on, "Log call" in the footer, or L anywhere in
 *   the panel outside a text field, brings the note view in from the right (`call-notes/`). The
 *   panel keeps its size. Esc or the arrow goes back to the script, and focus lands on Log call.
 *   The script stays under the note view the whole time (`PushView`), so Back finds the ticked
 *   questions, an open line edit and the scroll as they were (T3-8). "Save and next" closes the
 *   panel, and focus goes back to the row.
 * - **Motion:** the panel slides in over 250 ms and out in 150 ms. Another person in the same
 *   panel cross-fades in 150 ms. The note view pushes in like a phone app's next screen.
 * - **Phone:** it fills the screen and blocks the page, and the number with a Call button stays at
 *   the bottom.
 */
import {
  Building2,
  CircleAlert,
  Copy,
  Hourglass,
  NotebookPen,
  PhoneCall,
  PhoneOutgoing,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import { useCompany, useMe, usePrep, usePrepFacts, useStartPrep } from '@/api/hooks'
import { useCallNoteOptions } from '@/api/hooks/call-notes'
import { prepLost } from '@/api/hooks/companies'
import { toneInUse, useScriptStyle } from '@/api/hooks/script'
import type { CompanyDetail, CompanyPerson } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { PushView } from '@/components/motion'
import { Pending } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { melbourneDate } from '@/lib/format'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BeforeYouDial } from './before-you-dial'
import { NoteView } from './call-notes/note-view'
import { LOG_CALL } from './call-notes/words'
import { focusMovedOn, PREP_BUTTON } from './focus'
import { SourcesContext } from './guide-sources'
import { PanelDescription, PanelTitle } from './panel-title'
import { LastTalk, MoreAbout } from './prep-card'
import type { PrepTarget } from './prep-box'
import { guideText } from './playbook'
import { SalesScript, SalesScriptPending } from './sales-script'
import { SCRIPT_TITLE_ID, ScriptHeader } from './script-header'
import { useGuide } from './use-guide'
import { WAITING_FOR_PEOPLE } from './words'

const COPIED_MS = 2000

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** The script, or Log call's note view. */
type PanelView = 'script' | 'note'

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

export interface PrepSheetProps {
  target: PrepTarget | null
  onClose: () => void
  /** Another person (or a cold call) in the same panel. */
  onChangeTarget: (target: PrepTarget) => void
  /** "Company info": close the card and open the company's record. */
  onOpenCompany?: (companyKey: string) => void
}

export function PrepSheet({ target, onClose, onChangeTarget, onOpenCompany }: PrepSheetProps) {
  // While the panel slides shut, it keeps showing what it had.
  const [shown, setShown] = useState(target)
  const [view, setView] = useState<PanelView>(target?.note ? 'note' : 'script')
  if (target !== null && target !== shown) {
    setShown(target)
    setView(target.note ? 'note' : 'script')
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

  // The tone in use, for "Written in a Friendly tone. Research again to use Direct." Unknown until
  // the style loads, so no hint shows before then.
  const styleNow = useScriptStyle().data
  const toneNow = styleNow?.tone ? toneInUse(styleNow) : null

  // Status checks that keep failing stop the asking: the card says so, with Try again.
  const lost = !off && prepLost(prep.data?.status, prep.failureCount)
  const checking = !off && prep.data?.status === 'searching' && !lost
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

  // Log call (PLAN-V17 T3-5): only while call notes are switched on.
  const noteOptions = useCallNoteOptions()
  const notes = noteOptions.data?.enabled ? noteOptions.data : null
  const noting = view === 'note' && notes !== null
  const panel = useRef<HTMLDivElement>(null)
  const logButton = useRef<HTMLButtonElement>(null)
  // Back from the note view, focus goes to Log call at once (PushView leaves focus to us). While
  // no one is picked there is no footer, so it goes to the panel.
  const focusLogCall = useRef(false)
  useEffect(() => {
    if (view !== 'script' || !focusLogCall.current) return
    focusLogCall.current = false
    ;(logButton.current ?? panel.current)?.focus()
  }, [view])
  const openNote = (): void => {
    if (notes) setView('note')
  }
  const backToScript = (): void => {
    focusLogCall.current = true
    setView('script')
  }
  // L anywhere in the panel, outside a text field, opens the note view.
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      noting ||
      !notes ||
      event.defaultPrevented ||
      (event.key !== 'l' && event.key !== 'L') ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      (event.target instanceof Element && event.target.closest(EDITABLE) !== null)
    ) {
      return
    }
    event.preventDefault()
    openNote()
  }
  const logCallButton = notes ? (
    <Button
      ref={logButton}
      type="button"
      variant="outline"
      size={onPhone ? 'lg' : 'sm'}
      className={onPhone ? 'w-full' : undefined}
      aria-keyshortcuts="L"
      onClick={openNote}
    >
      <NotebookPen aria-hidden="true" />
      {LOG_CALL}
      <Kbd aria-hidden="true" className="touch:hidden">
        L
      </Kbd>
    </Button>
  ) : null

  return (
    <Sheet
      open={target !== null}
      // On a laptop the list stays usable beside the panel; on a phone the panel is the screen.
      modal={onPhone}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        ref={panel}
        side="right"
        // 576 px: one column, and lines of reading length (DESIGN.md "Line length").
        className="w-full gap-0 p-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        // A click on the list (another row's Prep, J, K) must not close the panel.
        onInteractOutside={(event) => {
          event.preventDefault()
        }}
        // Esc in the note view goes back to the script; it doesn't close the panel.
        onEscapeKeyDown={(event) => {
          if (noting) {
            event.preventDefault()
            backToScript()
          }
        }}
        onKeyDown={onPanelKey}
        // Focus goes to the panel itself, not its first button (the company link), so a stray
        // Enter does nothing and a screen reader starts at the person's name. The note view puts
        // it in its text box as it mounts, so this only runs if that didn't happen. The script
        // stays under the note view, so the box is looked for in the note view only.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (!(event.currentTarget instanceof HTMLElement)) return
          const box = noting
            ? event.currentTarget.querySelector<HTMLElement>('[data-slot=note-view] textarea')
            : null
          ;(box ?? event.currentTarget).focus()
        }}
        onCloseAutoFocus={(event) => {
          // "Company info" opened the company's dialog: focus stays there.
          if (focusMovedOn()) {
            event.preventDefault()
            return
          }
          // Back to the Prep button of the row it came from, so J, K and P carry on from there.
          const id = shown?.companyKey ? CSS.escape(shown.companyKey) : null
          const button = id ? document.querySelector<HTMLElement>(`[${PREP_BUTTON}="${id}"]`) : null
          if (button) {
            event.preventDefault()
            button.focus()
          }
        }}
      >
        <PushView
          className="min-h-0 flex-1"
          pushed={
            noting ? (
              <NoteView
                // Another call in the same panel starts from its own draft.
                key={`${companyKey ?? ''}|${person?.id ?? ''}`}
                companyKey={companyKey ?? ''}
                companyName={companyName}
                person={person}
                company={company.data}
                companyFailed={Boolean(company.error)}
                prepId={prepId ?? null}
                options={notes}
                onPhone={onPhone}
                onBack={backToScript}
                onSaved={onClose}
              />
            ) : null
          }
        >
          {/* The script stays here under the note view, so Back finds its ticks and scroll. */}
          <div className="flex h-full flex-col">
            <SheetHeader className="gap-3 border-b p-5 pr-14 text-left max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pr-14">
              <div className="flex min-w-0 items-start gap-3">
                {picking ? (
                  <Avatar icon={Building2} />
                ) : person ? (
                  <Avatar name={person.name} />
                ) : (
                  <Avatar icon={PhoneOutgoing} />
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <PanelTitle className="text-section">{title}</PanelTitle>
                  <PanelDescription className="text-ui text-foreground">
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
                  </PanelDescription>
                </div>
              </div>
              {picking ? null : (
                // Under the person's name, and out of the scroll, so it stays in view.
                <SourcesContext.Provider value={sources}>
                  <div className="-mr-9 max-sm:-mr-10">
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
            </SheetHeader>
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
                      // The script for that person: not the note view the panel may have opened on.
                      onChangeTarget(
                        picked
                          ? {
                              ...shown,
                              person: { id: picked.id, name: picked.name, title: picked.title },
                              note: false,
                            }
                          : { ...shown, cold: true, note: false },
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
                      // What happened and what to do come from the server, in one sentence each
                      // (PLAN-V15 T3-7); the card says what it means for the script.
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-soft p-3 text-ui text-destructive-ink"
                      >
                        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {prep.data.error ?? "Call prep couldn't finish. Try again."} The script
                          below is from our HubSpot copy.
                        </span>
                      </div>
                    ) : lost ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive bg-destructive-soft p-3 text-ui text-destructive-ink"
                      >
                        <span className="flex min-w-0 flex-1 items-start gap-2">
                          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                          <span>
                            Lost touch with the server. The script below is from our HubSpot copy.
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={prep.isFetching}
                          onClick={() => {
                            void prep.refetch()
                          }}
                        >
                          Try again
                        </Button>
                      </div>
                    ) : null}
                    <LastTalk company={company.data} facts={facts.data} />
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
                          capUsd={facts.data?.prep_cap_usd ?? null}
                          running={checking || start.isPending}
                          stage={prep.data?.stage ?? 0}
                          failed={Boolean(problem) || prep.data?.status === 'failed'}
                          toneNow={toneNow}
                          copyAt={facts.data?.copy_at ?? null}
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
                    <MoreAbout
                      company={company.data}
                      companyName={companyName}
                      today={today}
                      onOpenCompany={openCompany}
                    />
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
                  <p className="py-1 text-center text-ui text-muted-foreground">
                    No number on record
                  </p>
                )}
                {/* After the call, the next step: its own row, where the thumb is. */}
                {logCallButton}
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
              <div className="flex flex-wrap items-center gap-2 border-t bg-popover px-5 py-3">
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
                  {logCallButton}
                </div>
              </div>
            ) : null}
          </div>
        </PushView>
      </SheetContent>
    </Sheet>
  )
}
