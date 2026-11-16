/**
 * "Check and send" (PLAN-V17 "The screens", part 6; T3-11): an Alert Dialog with the email as it
 * will arrive and who gets it, then one Navy button, "Send to 4 people". The pre-read leaves
 * Contour here, so this is a real confirmation (DESIGN.md "A real confirmation"), built as
 * Activity's batch send is: it asks for a fresh preview each time it opens.
 *
 * - **The email:** the subject and the plain text part, in a quiet box that scrolls, by keyboard
 *   too (it takes the focus). The server's HTML never goes into the page.
 * - **The people,** each with a tick and why they are there, in the server's words. The Contour
 *   people on the meeting come ticked. "Add someone" takes an address, or a pasted list ("Jo
 *   Sample <jo@x.com>; Mia <mia@x.com>", DESIGN.md "Fields forgive"), and asks for the preview
 *   again with it, so the server says whether it is Contour's. One that isn't can't be ticked, and
 *   says why beside it, before anything is sent. An address the rep added can be taken out again.
 * - **The meeting's notes:** one line, in the server's words, when Send also adds the pre-read to
 *   the meeting's notes in HubSpot.
 * - **A refused send** keeps the dialog open and says why in the server's words, under the people
 *   (scrolled into view): an address that isn't Contour's is named there, nothing is sent, and the
 *   preview is asked again, so its row says so too. With no email set up, it says the pre-read
 *   stays here.
 * - **While it sends** nothing can stop it or change who gets it: Cancel, Esc, the ticks, Add and
 *   the X buttons wait until the server answers.
 * - **Sent:** the dialog closes, the page shows who got it and when, and the focus goes there.
 * - **The title and the buttons stay put;** only the middle (the email and the people) scrolls, so
 *   Send is always in view, on a laptop and on a phone, where the dialog keeps clear of the safe
 *   area at the bottom. The email box scrolls on its own, and hands the wheel on at its end.
 *
 * It waits for a blank the rep has just left to be saved before it asks for the preview, so the
 * email it shows holds it. The people the rep added, and their ticks, stay while the page is open.
 * It rises 8px as it fades in, and fades out in 150ms, as Activity's does.
 */
import { CalendarCheck, CircleAlert, Copy, Hourglass, Send, X } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from 'react'
import type { ApiProblem } from '@/api/client'
import {
  isOutsideAddress,
  useFormEditing,
  useMeetingFormPreview,
  useSendMeetingForm,
} from '@/api/hooks/meetings'
import type { FormEmailPreview, FormPerson, MeetingFormOut } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Pending } from '@/components/skeletons'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { addressKey, isTicked, MOST_PEOPLE, readAddresses, sendTo } from './rules'
import {
  ADD,
  ADD_SOMEONE,
  ADDRESS_PLACEHOLDER,
  ADDRESS_UNREADABLE,
  ALREADY_LISTED,
  CANCEL,
  CHECKING,
  EMAIL_BOX,
  GETTING_READY,
  NOBODY_LISTED,
  NOBODY_TICKED,
  NOT_CHECKED,
  NOT_CONTOUR,
  ONLY_CONTOUR,
  OVER_THE_MOST,
  PREVIEW_FAILED,
  removeWords,
  SAVING_FIRST,
  SEND,
  SEND_DESCRIPTION,
  SEND_TITLE,
  SENDING,
  sendProblemWords,
  sendToWords,
  COPY_PRE_READ,
  COPIED,
  NOT_COPIED,
  SUBJECT,
  THE_EMAIL,
  TOO_MANY,
  TRY_AGAIN,
  WHO_GETS_IT,
  whyLine,
} from './words'

export interface SendDialogProps {
  form: MeetingFormOut
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pre-read went: the page shows who got it. */
  onSent: () => void
}

/** The still shape of the email and two people, at their size, while the preview comes. */
function PreviewPending({ label }: { label: string }) {
  return (
    <Pending label={label}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          <div className="flex h-48 flex-col gap-2 rounded-md border p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </Pending>
  )
}

/** The email as it will arrive: the subject, then the plain text, in a box that scrolls. */
function EmailBox({ preview }: { preview: FormEmailPreview }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui font-semibold text-foreground">
        {THE_EMAIL}
      </h3>
      <div
        role="region"
        aria-label={EMAIL_BOX}
        // It scrolls, so the keyboard can reach it (WCAG 2.1.1).
        tabIndex={0}
        data-slot="email-box"
        className="max-h-48 overflow-y-auto rounded-md border bg-background p-3 text-ui text-foreground"
      >
        <p className="break-words">
          <span className="text-muted-foreground">{SUBJECT} </span>
          <span className="font-semibold">{preview.subject}</span>
        </p>
        {/* Text, never the HTML part: React writes it as text, so nothing in it can run. */}
        <p className="mt-3 break-words whitespace-pre-wrap">{preview.text}</p>
      </div>
    </section>
  )
}

function PersonRow({
  person,
  ticked,
  removable,
  locked,
  onTick,
  onRemove,
}: {
  person: FormPerson
  ticked: boolean
  removable: boolean
  /** The send is on its way: who gets it can't change now. */
  locked: boolean
  onTick: (ticked: boolean) => void
  onRemove: () => void
}) {
  const boxId = useId()
  const whyId = useId()
  const refusedId = useId()
  const name = person.name?.trim()
  return (
    <li data-slot="send-person" className="flex items-start gap-3 px-3 py-2.5">
      <Checkbox
        id={boxId}
        checked={ticked}
        disabled={!person.allowed || locked}
        aria-describedby={person.allowed ? whyId : `${whyId} ${refusedId}`}
        className="mt-0.5"
        onCheckedChange={(value) => {
          onTick(value === true)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label
          htmlFor={boxId}
          className={cn(
            'font-semibold break-words',
            person.allowed ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {name || person.email}
        </label>
        <p id={whyId} className="text-caption break-words text-muted-foreground">
          {name ? `${person.email} · ${person.why}` : whyLine(person.why)}
        </p>
        {person.allowed ? null : (
          <p id={refusedId} className="flex items-start gap-1.5 text-caption text-destructive-ink">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {NOT_CONTOUR}
          </p>
        )}
      </div>
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1.5"
          disabled={locked}
          aria-label={removeWords(person.email)}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  )
}

/**
 * An address the rep has added that the server hasn't answered for: being checked, or not checked
 * because the check failed (Try again is under the list). It can be taken out either way, but not
 * while the send is on its way.
 */
function CheckingRow({
  address,
  checking,
  locked,
  onRemove,
}: {
  address: string
  checking: boolean
  locked: boolean
  onRemove: () => void
}) {
  return (
    <li data-slot="send-person" className="flex items-start gap-3 px-3 py-2.5">
      <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold break-words text-foreground">{address}</p>
        <p className="text-caption text-muted-foreground">{checking ? CHECKING : NOT_CHECKED}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-my-1.5"
        disabled={locked}
        aria-label={removeWords(address)}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  )
}

/**
 * Email isn't set up (PLAN-V18 T2-7): the pre-read stays here, and this copies the email as it
 * would have gone (its subject, then its plain text), so the rep can paste it into their own.
 */
function CopyEmail({ email }: { email: FormEmailPreview }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit touch:h-11"
        onClick={() => {
          void navigator.clipboard.writeText(`${email.subject}\n\n${email.text}`).then(
            () => {
              setCopied(true)
            },
            () => {
              setCopied(false)
            },
          )
        }}
      >
        <Copy aria-hidden="true" />
        {COPY_PRE_READ}
      </Button>
      <p role="status" className="text-caption text-muted-foreground">
        {copied === true ? COPIED : copied === false ? NOT_COPIED : null}
      </p>
    </div>
  )
}

/** What went wrong, in the server's words: its title, then what to do. */
function Problem({ error }: { error: unknown }) {
  const { title, detail } = sendProblemWords(error)
  return (
    <div role="alert" className="flex items-start gap-2 text-ui text-destructive-ink">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words">
        <span className="font-semibold">{title}</span>
        {detail ? ` ${detail}` : null}
      </p>
    </div>
  )
}

export function SendDialog({ form, open, onOpenChange, onSent }: SendDialogProps) {
  const preview = useMeetingFormPreview(form.id)
  const send = useSendMeetingForm(form.id)
  // A blank the rep has just left is still being saved.
  const saving = useFormEditing(form.id)
  const [shown, setShown] = useState<FormEmailPreview | null>(null)
  const [added, setAdded] = useState<readonly string[]>([])
  const [picks, setPicks] = useState<Readonly<Record<string, boolean>>>({})
  const [typed, setTyped] = useState('')
  const [addProblem, setAddProblem] = useState<string | null>(null)
  const [sendProblem, setSendProblem] = useState<ApiProblem | null>(null)
  const [checkProblem, setCheckProblem] = useState<ApiProblem | null>(null)
  const asked = useRef(false)
  const sent = useRef(false)
  const problemRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const addNoteId = useId()
  const blockId = useId()
  const peopleId = useId()

  const ask = (to: readonly string[]): void => {
    setCheckProblem(null)
    preview.mutate(to, {
      onSuccess: (answer) => {
        setShown(answer)
      },
      onError: (error) => {
        setCheckProblem(error)
      },
    })
  }

  // Each time it opens, once the rep's last edit has saved: the email as it is now.
  const askNow = useEffectEvent(() => {
    ask(added)
  })
  useEffect(() => {
    if (!open) {
      asked.current = false
      return
    }
    if (saving || asked.current) return
    asked.current = true
    askNow()
  }, [open, saving])

  // A refused send says why under the people, which may be scrolled away from Send: bring it up.
  useEffect(() => {
    if (sendProblem) problemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [sendProblem])

  const close = (): void => {
    setShown(null)
    setTyped('')
    setAddProblem(null)
    setSendProblem(null)
    setCheckProblem(null)
    preview.reset()
    onOpenChange(false)
  }

  const people = shown?.people ?? []
  const listed = new Set(people.map((person) => addressKey(person.email)))
  // Added, and not answered for yet: being checked, or the check failed.
  const unlisted = added.filter((address) => !listed.has(address))
  const to = sendTo(people, picks)
  const block = to.length === 0 ? NOBODY_TICKED : to.length > MOST_PEOPLE ? OVER_THE_MOST : null
  // On its way: nothing may stop it or change who gets it until the server answers.
  const locked = send.isPending
  const busy = preview.isPending || locked || saving
  const canSend = shown !== null && !busy && block === null

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (locked) return
    const { found, unreadable } = readAddresses(typed)
    if (found.length === 0 || unreadable.length > 0) {
      setAddProblem(ADDRESS_UNREADABLE)
      return
    }
    const fresh = found.filter((address) => !listed.has(address) && !added.includes(address))
    if (fresh.length === 0) {
      setAddProblem(ALREADY_LISTED)
      return
    }
    const next = [...added, ...fresh]
    if (next.length > MOST_PEOPLE) {
      setAddProblem(TOO_MANY)
      return
    }
    setAdded(next)
    setTyped('')
    setAddProblem(null)
    ask(next)
  }

  const remove = (address: string): void => {
    if (locked) return
    const key = addressKey(address)
    const next = added.filter((one) => one !== key)
    setAdded(next)
    setPicks((now) => Object.fromEntries(Object.entries(now).filter(([one]) => one !== key)))
    // Gone at once; the next answer says the rest.
    setShown((now) =>
      now
        ? { ...now, people: now.people.filter((person) => addressKey(person.email) !== key) }
        : now,
    )
    ask(next)
  }

  const confirm = (): void => {
    if (!canSend) return
    setSendProblem(null)
    send.mutate(to, {
      onSuccess: () => {
        sent.current = true
        onSent()
        close()
      },
      onError: (error) => {
        setSendProblem(error)
        // The server names the address it refused; the rows say so too once it is asked again.
        if (isOutsideAddress(error)) ask(added)
      },
    })
  }

  let body
  if (shown === null) {
    body =
      checkProblem !== null && !preview.isPending ? (
        <ErrorState
          error={checkProblem}
          context={PREVIEW_FAILED}
          onRetry={() => {
            ask(added)
          }}
        />
      ) : (
        <PreviewPending label={saving ? SAVING_FIRST : GETTING_READY} />
      )
  } else {
    body = (
      <>
        <EmailBox preview={shown} />
        <section aria-labelledby={peopleId} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id={peopleId} className="text-ui font-semibold text-foreground">
              {WHO_GETS_IT}
            </h3>
            <p className="text-caption text-muted-foreground">{ONLY_CONTOUR}</p>
          </div>
          {people.length === 0 && unlisted.length === 0 ? (
            <p className="text-ui text-muted-foreground">{NOBODY_LISTED}</p>
          ) : (
            <ul
              aria-labelledby={peopleId}
              aria-busy={preview.isPending || undefined}
              className="flex flex-col divide-y rounded-md border text-ui"
            >
              {people.map((person) => {
                const key = addressKey(person.email)
                return (
                  <PersonRow
                    key={key}
                    person={person}
                    ticked={isTicked(person, picks)}
                    removable={added.includes(key)}
                    locked={locked}
                    onTick={(ticked) => {
                      setPicks((now) => ({ ...now, [key]: ticked }))
                    }}
                    onRemove={() => {
                      remove(person.email)
                    }}
                  />
                )
              })}
              {unlisted.map((address) => (
                <CheckingRow
                  key={address}
                  address={address}
                  checking={preview.isPending}
                  locked={locked}
                  onRemove={() => {
                    remove(address)
                  }}
                />
              ))}
            </ul>
          )}
          {sendProblem !== null ? (
            <div ref={problemRef} className="flex flex-col gap-2">
              {/* With no email set up, the server's words say the pre-read stays here already. */}
              <Problem error={sendProblem} />
              {sendProblem.code === 'email_not_set_up' && shown ? (
                <CopyEmail email={shown} />
              ) : null}
            </div>
          ) : null}
          {checkProblem !== null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Problem error={checkProblem} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                disabled={locked}
                onClick={() => {
                  ask(added)
                }}
              >
                {TRY_AGAIN}
              </Button>
            </div>
          ) : null}
          <form noValidate className="flex flex-col gap-1.5" onSubmit={add}>
            <label htmlFor={inputId} className="text-ui font-semibold text-foreground">
              {ADD_SOMEONE}
            </label>
            <div className="flex gap-2">
              <Input
                id={inputId}
                type="text"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                placeholder={ADDRESS_PLACEHOLDER}
                disabled={locked}
                aria-invalid={addProblem !== null || undefined}
                aria-describedby={addProblem !== null ? addNoteId : undefined}
                className="touch:text-body"
                onChange={(event) => {
                  setTyped(event.target.value)
                  setAddProblem(null)
                }}
              />
              <Button type="submit" variant="outline" disabled={locked}>
                {ADD}
              </Button>
            </div>
            {addProblem !== null ? (
              <p id={addNoteId} role="alert" className="text-caption text-destructive-ink">
                {addProblem}
              </p>
            ) : null}
          </form>
        </section>
        {shown.meeting_note?.trim() ? (
          <p className="flex items-start gap-2 text-ui text-muted-foreground">
            <CalendarCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {shown.meeting_note}
          </p>
        ) : null}
      </>
    )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // While it sends, nothing closes it: it goes, or says why it didn't.
        if (!next && locked) return
        // Cancel or Esc: nothing was sent, so the focus goes back to Check and send.
        if (!next) {
          sent.current = false
          close()
        }
      }}
    >
      <AlertDialogContent
        data-slot="send-dialog"
        // A column whose middle scrolls: the title and the buttons stay in view. Twice the safe
        // area comes off its height, so centred on a phone it ends above the safe area.
        className="flex max-h-[calc(100dvh-2rem-2*env(safe-area-inset-bottom))] flex-col data-open:slide-in-from-bottom-2 sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          // Sent: the button that opened it is gone, so the focus goes to who got it.
          if (!sent.current) return
          const note = document.querySelector<HTMLElement>('[data-slot="sent-note"]')
          if (note) {
            event.preventDefault()
            note.focus()
          }
        }}
      >
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>{SEND_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{SEND_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* The middle scrolls. Its edge room (-mx-6 px-6, -my-1 py-1) keeps focus rings whole. */}
        <div
          data-slot="send-dialog-body"
          className="-mx-6 -my-1 flex min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-1"
        >
          {body}
        </div>
        {shown !== null && block !== null ? (
          <p id={blockId} className="shrink-0 text-ui text-muted-foreground">
            {block}
          </p>
        ) : null}
        <AlertDialogFooter className="shrink-0">
          <AlertDialogCancel disabled={locked}>{CANCEL}</AlertDialogCancel>
          <Button
            type="button"
            disabled={!canSend}
            aria-describedby={shown !== null && block !== null ? blockId : undefined}
            onClick={confirm}
          >
            <Send aria-hidden="true" />
            {send.isPending ? SENDING : to.length > 0 ? sendToWords(to.length) : SEND}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
