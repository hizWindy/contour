/**
 * "Check and send" and "Send to more people" (PLAN-V17 T3-11; PLAN-V19 T2-3 to T2-5):
 * an Alert Dialog showing the HubSpot task preview, the email preview, the team list from
 * `GET /companies/team`, the "Also email them" tick (off by default), and "Add someone" for
 * extra Contour addresses.
 *
 * - On open, asks for a preview (`owner_ids: null`) so the meeting's Contour HubSpot owners come
 *   ticked. Anyone who already received this pre-read shows greyed with "Got it 17 Nov".
 * - Ticking team members, toggling "Also email them" or adding an email updates the preview from
 *   the server so each row shows what that person gets in the server's words ("HubSpot task",
 *   "Email" or both) and why.
 * - If the team list doesn't load (`team_unavailable`), "Add someone" and email sending still work
 *   and Try again reloads the team list.
 * - If HubSpot writing is off and nobody would be emailed (`hubspot_writes_off`), the alert tells
 *   the rep to tick "Also email them" to send by email instead.
 */
import { CalendarCheck, CircleAlert, Copy, Hourglass, Send, X } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from 'react'
import type { ApiProblem } from '@/api/client'
import {
  isOutsideAddress,
  useFormEditing,
  useMeetingFormPreview,
  useSendMeetingForm,
  useTeam,
} from '@/api/hooks/meetings'
import type {
  FormEmailPreview,
  FormPerson,
  FormRecipient,
  MeetingFormOut,
  TeamMember,
} from '@/api/types'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  addressKey,
  countSendRecipients,
  isTicked,
  MOST_PEOPLE,
  personKey,
  readAddresses,
  sendEmailAddresses,
} from './rules'
import {
  ADD,
  ADD_SOMEONE,
  ADDRESS_PLACEHOLDER,
  ADDRESS_UNREADABLE,
  ALREADY_GOT_IT,
  ALREADY_LISTED,
  ALSO_EMAIL_HINT,
  ALSO_EMAIL_THEM,
  CANCEL,
  CHECKING,
  COPIED,
  COPY_PRE_READ,
  deliveryWords,
  DUE_LABEL,
  EMAIL_BOX,
  GETTING_READY,
  gotItWords,
  NOBODY_LISTED,
  NOBODY_TICKED,
  NO_CONTOUR_ACCOUNT,
  NOT_CHECKED,
  NOT_CONTOUR,
  NOT_COPIED,
  OVER_THE_MOST,
  PREVIEW_FAILED,
  recipientLabel,
  removeWords,
  SAVING_FIRST,
  SEND,
  SEND_DESCRIPTION,
  SEND_TITLE,
  SENDING,
  sendProblemWords,
  sendToWords,
  SUBJECT,
  TASK_BOX,
  TEAM_UNAVAILABLE,
  THE_EMAIL,
  THE_TASK,
  TOO_MANY,
  TRY_AGAIN,
  WHO_GETS_HINT,
  WHO_GETS_IT,
  whyLine,
  YOU_TAG,
} from './words'

export interface SendDialogProps {
  form: MeetingFormOut
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pre-read went: the page shows who got it. */
  onSent: () => void
}

/** The still shape of the task, email and people while the preview comes. */
function PreviewPending({ label }: { label: string }) {
  return (
    <Pending label={label}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          <div className="flex h-40 flex-col gap-2 rounded-md border p-3">
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

/** The HubSpot task subject and due day as they will appear for picked team members. */
function TaskBox({ preview }: { preview: FormEmailPreview }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-ui font-semibold text-foreground">
        {THE_TASK}
      </h3>
      <div
        aria-label={TASK_BOX}
        data-slot="task-box"
        className="flex flex-col gap-1 rounded-md border bg-background p-3 text-ui text-foreground"
      >
        <p className="break-words">
          <span className="text-muted-foreground">{SUBJECT} </span>
          <span className="font-semibold">{preview.task_subject}</span>
        </p>
        <p className="text-caption text-muted-foreground tabular-nums">
          <span>{DUE_LABEL} </span>
          <span className="text-foreground">{formatDate(preview.task_due)}</span>
        </p>
      </div>
    </section>
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

/** One HubSpot owner from the team list (with "You" on the signed-in rep, and "Got it" when sent). */
function TeamMemberRow({
  member,
  ticked,
  prior,
  previewPerson,
  emailThem,
  locked,
  onTick,
}: {
  member: TeamMember
  ticked: boolean
  prior: FormRecipient | undefined
  previewPerson: FormPerson | undefined
  emailThem: boolean
  locked: boolean
  onTick: (ticked: boolean) => void
}) {
  const boxId = useId()
  const noteId = useId()
  const alreadyAt = prior?.at ?? previewPerson?.already ?? null
  const alreadySent = alreadyAt !== null

  let note: string | null = null
  if (alreadySent) {
    const how = prior ? deliveryWords({ task: prior.task !== 'none', email: prior.email }) : null
    note = [gotItWords(alreadyAt), how].filter(Boolean).join(' · ')
  } else if (ticked) {
    const delivery = previewPerson
      ? deliveryWords(previewPerson)
      : deliveryWords({ task: true, email: emailThem && member.has_account })
    const why = previewPerson?.why ? whyLine(previewPerson.why) : null
    const noAccountNote = !member.has_account && emailThem ? NO_CONTOUR_ACCOUNT : null
    note = [delivery, previewPerson?.address, why, noAccountNote].filter(Boolean).join(' · ')
  } else if (!member.has_account) {
    note = NO_CONTOUR_ACCOUNT
  }

  return (
    <li
      data-slot="send-person"
      data-already={alreadySent ? 'true' : undefined}
      className={cn('flex items-start gap-3 px-3 py-2.5', alreadySent && 'bg-muted/35')}
    >
      <Checkbox
        id={boxId}
        checked={alreadySent ? false : ticked}
        disabled={alreadySent || locked}
        aria-describedby={note ? noteId : undefined}
        className="mt-0.5"
        onCheckedChange={(value) => {
          onTick(value === true)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={boxId}
            className={cn(
              'font-semibold break-words',
              alreadySent ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {member.name}
          </label>
          {member.is_me ? (
            <Badge variant="outline" className="text-caption font-normal">
              {YOU_TAG}
            </Badge>
          ) : null}
        </div>
        {note ? (
          <p id={noteId} className="text-caption break-words text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * One person added by email (or typed meeting author fallback with no HubSpot owner), or a
 * prior recipient not shown in the team list.
 */
function EmailPersonRow({
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
  locked: boolean
  onTick: (ticked: boolean) => void
  onRemove: () => void
}) {
  const boxId = useId()
  const whyId = useId()
  const refusedId = useId()
  const name = person.name?.trim()
  const address = person.address ?? ''
  const alreadySent = person.already !== null
  const delivery = alreadySent ? null : person.allowed ? deliveryWords(person) : null
  const why = alreadySent ? gotItWords(person.already) : whyLine(person.why)
  const line = [delivery, name ? address : null, why].filter(Boolean).join(' · ')

  return (
    <li
      data-slot="send-person"
      data-already={alreadySent ? 'true' : undefined}
      className={cn('flex items-start gap-3 px-3 py-2.5', alreadySent && 'bg-muted/35')}
    >
      <Checkbox
        id={boxId}
        checked={alreadySent ? false : ticked}
        disabled={!person.allowed || alreadySent || locked}
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
            person.allowed && !alreadySent ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {name || address}
        </label>
        <p id={whyId} className="text-caption break-words text-muted-foreground">
          {line}
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
          aria-label={removeWords(address)}
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

/** Email isn't set up (409 `email_not_set_up`): copies the email so the rep can paste it. */
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

/** What went wrong, in the server's words (never duplicating a title inside detail). */
function Problem({ error }: { error: unknown }) {
  const { title, detail } = sendProblemWords(error)
  return (
    <div role="alert" className="flex items-start gap-2 text-ui text-destructive-ink">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words">
        {title ? <span className="font-semibold">{title}</span> : null}
        {title && detail ? ` ${detail}` : detail}
      </p>
    </div>
  )
}

export function SendDialog({ form, open, onOpenChange, onSent }: SendDialogProps) {
  const team = useTeam({ enabled: open })
  const preview = useMeetingFormPreview(form.id)
  const send = useSendMeetingForm(form.id)
  // A blank the rep has just left is still being saved.
  const saving = useFormEditing(form.id)

  const [shown, setShown] = useState<FormEmailPreview | null>(null)
  // Null until initial open preview tells us which HubSpot owners on the meeting start ticked.
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<readonly string[] | null>(null)
  const [added, setAdded] = useState<readonly string[]>([])
  const [picks, setPicks] = useState<Readonly<Record<string, boolean>>>({})
  const [emailThem, setEmailThem] = useState(false)
  const [typed, setTyped] = useState('')
  const [addProblem, setAddProblem] = useState<string | null>(null)
  const [sendProblem, setSendProblem] = useState<ApiProblem | null>(null)
  const [checkProblem, setCheckProblem] = useState<ApiProblem | null>(null)

  const asked = useRef(false)
  const sent = useRef(false)
  const requestSeq = useRef(0)
  const problemRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const addNoteId = useId()
  const blockId = useId()
  const peopleId = useId()
  const emailThemId = useId()
  const emailHintId = useId()

  const sentByOwner = new Map<string, FormRecipient>()
  const sentByAddr = new Map<string, FormRecipient>()
  for (const r of form.sent_to) {
    if (r.owner_id) sentByOwner.set(r.owner_id, r)
    if (r.address) sentByAddr.set(addressKey(r.address), r)
  }

  const ask = (
    ownerIds: readonly string[] | null,
    emails: readonly string[],
    alsoEmail: boolean,
  ): void => {
    const seq = ++requestSeq.current
    setCheckProblem(null)
    preview.mutate(
      { ownerIds, emails, emailThem: alsoEmail },
      {
        onSuccess: (answer) => {
          if (seq !== requestSeq.current) return
          setShown(answer)
          if (ownerIds === null) {
            setSelectedOwnerIds(
              answer.people
                .filter((p) => p.owner_id !== null && p.ticked && p.already === null)
                .map((p) => p.owner_id as string),
            )
          }
        },
        onError: (error) => {
          if (seq !== requestSeq.current) return
          setCheckProblem(error)
        },
      },
    )
  }

  // Each time it opens, once the rep's last edit has saved: ask the server for who starts ticked
  // and the task + email preview.
  const askNow = useEffectEvent(() => {
    const unsentAdded = added.filter((addr) => !sentByAddr.has(addr))
    if (unsentAdded.length !== added.length) setAdded(unsentAdded)
    ask(null, unsentAdded, emailThem)
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
    if (sent.current) {
      setSelectedOwnerIds(null)
      setAdded([])
      setPicks({})
      setEmailThem(false)
    }
    preview.reset()
    onOpenChange(false)
  }

  const previewPeople = shown?.people ?? []
  const previewByOwner = new Map<string, FormPerson>()
  for (const person of previewPeople) {
    if (person.owner_id) previewByOwner.set(person.owner_id, person)
  }

  const activeOwnerIds = (selectedOwnerIds ?? []).filter((id) => !sentByOwner.has(id))

  // Team rows: active HubSpot owners from GET /companies/team; if the team list failed or omits a
  // previously-sent / previewed owner, include them so no one on the pre-read vanishes.
  const teamMembers: TeamMember[] = [...(team.data ?? [])]
  const teamOwnerIds = new Set(teamMembers.map((m) => m.owner_id))
  for (const person of previewPeople) {
    if (person.owner_id && !teamOwnerIds.has(person.owner_id)) {
      teamOwnerIds.add(person.owner_id)
      teamMembers.push({
        owner_id: person.owner_id,
        name: recipientLabel(person),
        has_account: Boolean(person.address),
        is_me: false,
      })
    }
  }
  for (const prior of form.sent_to) {
    if (prior.owner_id && !teamOwnerIds.has(prior.owner_id)) {
      teamOwnerIds.add(prior.owner_id)
      teamMembers.push({
        owner_id: prior.owner_id,
        name: recipientLabel(prior),
        has_account: Boolean(prior.address),
        is_me: false,
      })
    }
  }

  const emailOnlyPeople: FormPerson[] = previewPeople.filter((p) => p.owner_id === null)
  const listedAddrs = new Set<string>([
    ...previewPeople.map((p) => (p.address ? addressKey(p.address) : '')).filter(Boolean),
    ...sentByAddr.keys(),
  ])
  for (const prior of form.sent_to) {
    if (prior.owner_id === null && prior.address) {
      const addr = addressKey(prior.address)
      if (!emailOnlyPeople.some((p) => p.address && addressKey(p.address) === addr)) {
        emailOnlyPeople.push({
          owner_id: null,
          name: prior.name,
          address: addr,
          task: false,
          email: false,
          why: '',
          already: prior.at ?? form.sent_at ?? '',
          ticked: false,
          allowed: true,
        })
      }
    }
  }

  const unlisted = added.filter((addr) => !listedAddrs.has(addr))
  const extraEmails = sendEmailAddresses(emailOnlyPeople, picks)
  const totalCount = countSendRecipients(activeOwnerIds, previewPeople, picks)
  const block = totalCount === 0 ? NOBODY_TICKED : totalCount > MOST_PEOPLE ? OVER_THE_MOST : null

  const locked = send.isPending
  const busy = preview.isPending || locked || saving
  const canSend = shown !== null && !busy && block === null

  const toggleOwner = (ownerId: string, nextTicked: boolean): void => {
    if (locked || sentByOwner.has(ownerId)) return
    const nextOwners = nextTicked
      ? [...activeOwnerIds, ownerId]
      : activeOwnerIds.filter((id) => id !== ownerId)
    setSelectedOwnerIds(nextOwners)
    setSendProblem(null)
    ask(nextOwners, added, emailThem)
  }

  const toggleEmailThem = (nextEmailThem: boolean): void => {
    if (locked) return
    setEmailThem(nextEmailThem)
    setSendProblem(null)
    ask(selectedOwnerIds, added, nextEmailThem)
  }

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (locked) return
    const { found, unreadable } = readAddresses(typed)
    if (found.length === 0 || unreadable.length > 0) {
      setAddProblem(ADDRESS_UNREADABLE)
      return
    }
    const alreadyGot = found.filter((address) => sentByAddr.has(address))
    if (alreadyGot.length === found.length) {
      setAddProblem(ALREADY_GOT_IT)
      return
    }
    const fresh = found.filter(
      (address) =>
        !listedAddrs.has(address) && !added.includes(address) && !sentByAddr.has(address),
    )
    if (fresh.length === 0) {
      setAddProblem(ALREADY_LISTED)
      return
    }
    const next = [...added, ...fresh]
    if (next.length + activeOwnerIds.length > MOST_PEOPLE) {
      setAddProblem(TOO_MANY)
      return
    }
    setAdded(next)
    setTyped('')
    setAddProblem(null)
    ask(selectedOwnerIds, next, emailThem)
  }

  const remove = (address: string): void => {
    if (locked) return
    const key = addressKey(address)
    const next = added.filter((one) => one !== key)
    setAdded(next)
    setPicks((now) =>
      Object.fromEntries(Object.entries(now).filter(([k]) => k !== key && k !== `email:${key}`)),
    )
    setShown((now) =>
      now
        ? {
            ...now,
            people: now.people.filter(
              (person) => !(person.owner_id === null && addressKey(person.address ?? '') === key),
            ),
          }
        : now,
    )
    ask(selectedOwnerIds, next, emailThem)
  }

  const confirm = (): void => {
    if (!canSend) return
    setSendProblem(null)
    send.mutate(
      {
        ownerIds: activeOwnerIds,
        emails: extraEmails,
        emailThem,
      },
      {
        onSuccess: () => {
          sent.current = true
          onSent()
          close()
        },
        onError: (error) => {
          setSendProblem(error)
          // The server names the address it refused; the rows say so too once it is asked again.
          if (isOutsideAddress(error)) ask(selectedOwnerIds, added, emailThem)
        },
      },
    )
  }

  let body
  if (shown === null) {
    body =
      checkProblem !== null && !preview.isPending ? (
        <ErrorState
          error={checkProblem}
          context={PREVIEW_FAILED}
          onRetry={() => {
            ask(selectedOwnerIds, added, emailThem)
          }}
        />
      ) : (
        <PreviewPending label={saving ? SAVING_FIRST : GETTING_READY} />
      )
  } else {
    body = (
      <>
        <TaskBox preview={shown} />
        <EmailBox preview={shown} />
        <section aria-labelledby={peopleId} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id={peopleId} className="text-ui font-semibold text-foreground">
              {WHO_GETS_IT}
            </h3>
            <p className="text-caption text-muted-foreground">{WHO_GETS_HINT}</p>
          </div>

          <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-2.5">
            <Checkbox
              id={emailThemId}
              checked={emailThem}
              disabled={locked}
              aria-describedby={emailHintId}
              className="mt-0.5"
              onCheckedChange={(value) => {
                toggleEmailThem(value === true)
              }}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor={emailThemId} className="text-ui font-semibold text-foreground">
                {ALSO_EMAIL_THEM}
              </label>
              <p id={emailHintId} className="text-caption text-muted-foreground">
                {ALSO_EMAIL_HINT}
              </p>
            </div>
          </div>

          {team.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-ui text-destructive-ink"
            >
              <p className="flex min-w-0 items-start gap-2">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{TEAM_UNAVAILABLE}</span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-11"
                disabled={locked || team.isFetching}
                onClick={() => {
                  void team.refetch()
                }}
              >
                {TRY_AGAIN}
              </Button>
            </div>
          ) : null}

          {teamMembers.length === 0 && emailOnlyPeople.length === 0 && unlisted.length === 0 ? (
            <p className="text-ui text-muted-foreground">{NOBODY_LISTED}</p>
          ) : (
            <ul
              aria-labelledby={peopleId}
              aria-busy={preview.isPending || undefined}
              className="flex flex-col divide-y rounded-md border text-ui"
            >
              {teamMembers.map((member) => (
                <TeamMemberRow
                  key={`owner:${member.owner_id}`}
                  member={member}
                  ticked={activeOwnerIds.includes(member.owner_id)}
                  prior={sentByOwner.get(member.owner_id)}
                  previewPerson={previewByOwner.get(member.owner_id)}
                  emailThem={emailThem}
                  locked={locked}
                  onTick={(nextTicked) => {
                    toggleOwner(member.owner_id, nextTicked)
                  }}
                />
              ))}
              {emailOnlyPeople.map((person) => {
                const key = personKey(person)
                const addrKey = addressKey(person.address ?? '')
                return (
                  <EmailPersonRow
                    key={key}
                    person={person}
                    ticked={isTicked(person, picks)}
                    removable={added.includes(addrKey) && person.already === null}
                    locked={locked}
                    onTick={(nextTicked) => {
                      setPicks((now) => ({ ...now, [key]: nextTicked }))
                    }}
                    onRemove={() => {
                      if (person.address) remove(person.address)
                    }}
                  />
                )
              })}
              {unlisted.map((address) => (
                <CheckingRow
                  key={`checking:${address}`}
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
                  ask(selectedOwnerIds, added, emailThem)
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
              <Button type="submit" variant="outline" className="touch:h-11" disabled={locked}>
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
        if (!next) {
          sent.current = false
          close()
        }
      }}
    >
      <AlertDialogContent
        data-slot="send-dialog"
        className="flex max-h-[calc(100dvh-2rem-2*env(safe-area-inset-bottom))] flex-col data-open:slide-in-from-bottom-2 sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
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
            {send.isPending ? SENDING : totalCount > 0 ? sendToWords(totalCount) : SEND}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
