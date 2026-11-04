/**
 * The "Send to HubSpot" preview, for any project: what would be written, and a Confirm button.
 *
 * The backend works the preview out (core/hubspot/writer.py). This only shows it: a new company or
 * an update of its empty fields, each field and what happens to it, the note, the list, and any
 * warning. While writing is switched off it says "Waiting for write access" and still shows the
 * preview. After a send it shows each step's result. A finished send can't be sent again.
 */
import {
  CircleCheck,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ApiProblem } from '@/api/client'
import type { HubSpotFieldChange, HubSpotStep, HubSpotWrite } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { SourceLink } from '@/components/source-link'
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

const STEP_NAMES: Record<HubSpotStep['step'], string> = {
  company: 'The company',
  note: 'The note',
  list: 'The list',
}
const STEP_WORDS: Record<HubSpotStep['status'], { icon: LucideIcon; word: string }> = {
  done: { icon: CircleCheck, word: 'Done' },
  failed: { icon: CircleX, word: 'Failed' },
  uncertain: { icon: CircleQuestionMark, word: 'Not sure it landed' },
  skipped: { icon: CircleMinus, word: 'Skipped' },
}
const FINISHED = new Set<HubSpotWrite['status']>(['done'])
const RETRY = new Set<HubSpotWrite['status']>(['partial', 'failed', 'uncertain'])

export interface SendToHubSpotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The company's name, for the title. */
  company: string
  /** The preview (or the finished send) from the backend. */
  write: HubSpotWrite | undefined
  /** The preview is being worked out. */
  loading: boolean
  /** The preview couldn't be worked out. */
  error: ApiProblem | null
  /** The send is running. */
  sending: boolean
  onConfirm: () => void
}

function happens(change: HubSpotFieldChange): string {
  if (change.write) return 'Written'
  if (change.current !== null && change.current !== undefined) {
    return `Kept: HubSpot has ${change.current}`
  }
  return 'Goes in the note'
}

function FieldTable({ fields }: { fields: HubSpotFieldChange[] }) {
  if (fields.length === 0) return null
  return (
    <div className="max-h-64 overflow-auto rounded-md border">
      <table className="w-full text-ui">
        <caption className="sr-only">The fields this sends</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="px-3 py-2 font-semibold">
              Field
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Value
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              What happens
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((change) => (
            <tr key={change.property} className="border-b last:border-0 align-top">
              <td className="px-3 py-2">{change.label}</td>
              <td className="px-3 py-2 break-words">{change.value}</td>
              <td className="px-3 py-2 text-muted-foreground">{happens(change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Steps({ steps }: { steps: HubSpotStep[] }) {
  return (
    <ul className="flex flex-col gap-1 text-ui" aria-label="What happened">
      {steps.map((step) => {
        const { icon: Icon, word } = STEP_WORDS[step.status]
        return (
          <li key={step.step} className="flex items-start gap-2">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">
                {STEP_NAMES[step.step]}: {word}.
              </span>{' '}
              {step.detail ?? ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Plan({ write }: { write: HubSpotWrite }) {
  const plan = write.plan
  return (
    <div className="flex flex-col gap-3 text-ui">
      <p>
        {plan.action === 'create'
          ? 'This makes a new company in HubSpot.'
          : `This fills the empty fields of ${plan.company_name} in HubSpot. What a person typed stays.`}{' '}
        {plan.company_url ? <SourceLink href={plan.company_url} label="Open in HubSpot" /> : null}
      </p>
      {(plan.warnings ?? []).length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Before you send">
          {(plan.warnings ?? []).map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <FieldTable fields={plan.fields} />
      {plan.note ? (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">The note</p>
          <p className="max-h-40 overflow-auto rounded-md border px-3 py-2 whitespace-pre-wrap">
            {plan.note}
          </p>
        </div>
      ) : null}
      {plan.list_name ? (
        <p>
          {plan.list_id
            ? `It is added to the list "${plan.list_name}".`
            : `The list "${plan.list_name}" isn't ready, so it is skipped.`}
        </p>
      ) : null}
    </div>
  )
}

export function SendToHubSpotDialog({
  open,
  onOpenChange,
  company,
  write,
  loading,
  error,
  sending,
  onConfirm,
}: SendToHubSpotDialogProps) {
  const finished = write ? FINISHED.has(write.status) : false
  const retry = write ? RETRY.has(write.status) : false
  const canSend = Boolean(write?.can_write) && !finished && !sending && !loading
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {finished ? `${company} is in HubSpot` : `Send ${company} to HubSpot?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {loading
              ? 'Reading HubSpot. Nothing is written yet.'
              : finished
                ? 'It was sent once. Sending again changes nothing.'
                : 'Check what would be written. Nothing is written until you confirm.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <ErrorState error={error} context="The preview couldn't be worked out." /> : null}
        {write ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto">
            {write.steps.length > 0 ? <Steps steps={write.steps} /> : null}
            {finished && write.hubspot_url ? (
              <SourceLink href={write.hubspot_url} label="Open the company in HubSpot" />
            ) : null}
            {!finished ? <Plan write={write} /> : null}
            {write.waiting_for && !finished ? (
              <p role="status" className="rounded-md border px-3 py-2 text-ui">
                <span className="font-semibold">{write.waiting_for}.</span> The HubSpot admin adds
                the write permissions to the key, then writing is switched on. The preview works
                until then.
              </p>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{finished ? 'Close' : 'Cancel'}</AlertDialogCancel>
          {finished ? null : (
            <Button type="button" disabled={!canSend} onClick={onConfirm}>
              <Send aria-hidden="true" />
              {sending ? 'Sending.' : retry ? 'Try the rest again' : 'Send to HubSpot'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
