/**
 * Admin, Settings (PLAN-V13 T1-9): the limits, models and switches a person may change, in five
 * groups (Money, Claude, Runs, Why now, Call prep) with one group shown at a time, so a group fits
 * on one laptop screen. Each setting is one row: its name and one line, and the field. "Show the
 * details" adds the full words and the allowed range. The values only engine/.env can change are
 * under "Set in engine/.env".
 *
 * Changes are saved together, all or nothing: a value the server refuses comes back beside its field
 * and nothing is saved. A changed setting can go back to its default. A change applies from the next
 * run, said once at the top: a run in progress keeps the caps it started with.
 */
import { RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fieldErrorMap, toApiProblem } from '@/api/client'
import { useResetSetting, useSettings, useUpdateSettings } from '@/api/hooks'
import type { SettingField, SettingValue } from '@/api/types'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { Segmented } from '@/components/motion'
import { PendingForm } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toastProblem } from '@/lib/problems'
import { firstSentence, groupOf, GROUPS, type GroupId } from './settings-groups'

const DEFAULT_CHOICE = '__default__'

function shown(value: SettingValue): string {
  if (value === null) return 'The main model'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** A typed value as the server wants it: decimals as text, ints as numbers. */
function parsed(field: SettingField, text: string): SettingValue {
  if (field.type === 'int') {
    const trimmed = text.trim()
    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed
  }
  return text.trim()
}

/** The field on the right of a row. */
function Control({
  field,
  draft,
  error,
  onChange,
}: {
  field: SettingField
  draft: SettingValue
  error: string | undefined
  onChange: (value: SettingValue) => void
}) {
  const id = `setting-${field.key}`
  if (field.type === 'bool') {
    return (
      <Switch
        id={id}
        checked={draft === true}
        onCheckedChange={(checked) => {
          onChange(checked)
        }}
      />
    )
  }
  if (field.type === 'choice' || field.type === 'choice_or_null') {
    return (
      <Select
        value={draft === null ? DEFAULT_CHOICE : String(draft)}
        onValueChange={(value) => {
          onChange(value === DEFAULT_CHOICE ? null : value)
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.type === 'choice_or_null' ? (
            <SelectItem value={DEFAULT_CHOICE}>The main model</SelectItem>
          ) : null}
          {(field.choices ?? []).map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      id={id}
      inputMode={field.type === 'int' ? 'numeric' : 'decimal'}
      className="tabular-nums"
      value={draft === null ? '' : String(draft)}
      onChange={(event) => {
        onChange(parsed(field, event.target.value))
      }}
      aria-invalid={error ? true : undefined}
      aria-describedby={`${id}-line`}
    />
  )
}

function SettingRow({
  field,
  draft,
  error,
  details,
  resetting,
  onChange,
  onReset,
}: {
  field: SettingField
  draft: SettingValue
  error: string | undefined
  details: boolean
  resetting: boolean
  onChange: (value: SettingValue) => void
  onReset: () => void
}) {
  const id = `setting-${field.key}`
  const range =
    field.min !== null && field.max !== null
      ? ` From ${String(field.min)} to ${String(field.max)}.`
      : ''
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 border-b py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-ui font-semibold">
          {field.label}
        </label>
        <p id={`${id}-line`} className="text-caption text-muted-foreground">
          {details ? `${field.description}${range}` : firstSentence(field.description)}
        </p>
        {field.overridden ? (
          <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            <Badge variant="outline">Changed</Badge>
            <span>Default {shown(field.default)}</span>
            <Button type="button" variant="ghost" size="xs" disabled={resetting} onClick={onReset}>
              <RotateCcw aria-hidden="true" />
              Use the default
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="text-caption text-destructive-ink" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className={field.type === 'bool' ? 'flex sm:justify-end' : undefined}>
        <Control field={field} draft={draft} error={error} onChange={onChange} />
      </div>
    </li>
  )
}

export default function AdminSettingsTab() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const reset = useResetSetting()
  const [drafts, setDrafts] = useState<Record<string, SettingValue>>({})
  const [group, setGroup] = useState<GroupId>('money')
  const [details, setDetails] = useState(false)

  if (settings.error) {
    return <ErrorState error={settings.error} context="The settings couldn't be loaded." />
  }
  if (!settings.data) {
    return <PendingForm label="Loading the settings." fields={8} />
  }
  const fields = settings.data.fields
  const editable = fields.filter((field) => field.editable)
  const fixed = fields.filter((field) => !field.editable)
  const changed = Object.fromEntries(
    Object.entries(drafts).filter(([key, value]) => {
      const field = fields.find((item) => item.key === key)
      return field !== undefined && String(field.value) !== String(value)
    }),
  )
  const errors = update.error
    ? fieldErrorMap(toApiProblem(update.error), ['body.values.', 'values.'])
    : {}
  const groups = GROUPS.filter((item) =>
    editable.some((field) => groupOf(field.key) === item.value),
  )
  // A group with a refused value is shown, so an error is never hidden on another group.
  const withError = Object.keys(errors).map(groupOf)[0]
  const open = withError ?? (groups.some((item) => item.value === group) ? group : groups[0]?.value)
  const shownFields = editable.filter((field) => groupOf(field.key) === open)
  const count = Object.keys(changed).length

  const save = (): void => {
    update.mutate(changed, {
      onSuccess: () => {
        setDrafts({})
        toast('Settings saved. They apply from the next run.')
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold">Settings</CardTitle>
          <CardDescription>
            Applies from the next run. Left today across every run:{' '}
            <Money value={settings.data.daily_left_usd} />.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={details}
              onClick={() => {
                setDetails((on) => !on)
              }}
            >
              {details ? 'Hide the details' : 'Show the details'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {update.error && Object.keys(errors).length === 0 ? (
            <ErrorState error={update.error} />
          ) : null}
          {groups.length > 1 && open ? (
            <div className="flex">
              <Segmented
                aria-label="Settings group"
                options={groups}
                value={open}
                onChange={(value) => {
                  setGroup(value)
                }}
              />
            </div>
          ) : null}
          {/* Two columns from a laptop up, so a group fits on one screen. */}
          <ul
            aria-label={GROUPS.find((item) => item.value === open)?.label ?? 'Settings'}
            className="grid lg:grid-cols-2 lg:gap-x-10"
          >
            {shownFields.map((field) => (
              <SettingRow
                key={field.key}
                field={field}
                draft={field.key in drafts ? (drafts[field.key] ?? null) : field.value}
                error={errors[field.key]}
                details={details}
                resetting={reset.isPending}
                onChange={(value) => {
                  setDrafts((current) => ({ ...current, [field.key]: value }))
                }}
                onReset={() => {
                  reset.mutate(field.key, {
                    onSuccess: () => {
                      setDrafts((current) => {
                        const next = { ...current }
                        delete next[field.key]
                        return next
                      })
                    },
                    onError: toastProblem,
                  })
                }}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button type="button" disabled={count === 0 || update.isPending} onClick={save}>
              <Save aria-hidden="true" />
              {update.isPending ? 'Saving.' : 'Save changes'}
            </Button>
            {count > 0 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDrafts({})
                    update.reset()
                  }}
                >
                  Discard changes
                </Button>
                <span className="text-caption text-muted-foreground">
                  {count === 1 ? '1 change' : `${String(count)} changes`}, saved together.
                </span>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {fixed.length > 0 ? (
        <details className="rounded-lg border bg-card px-6 py-4 text-ui">
          <summary className="cursor-pointer font-semibold">
            Set in engine/.env ({fixed.length})
          </summary>
          <p className="mt-1 text-caption text-muted-foreground">
            These change only in engine/.env, then a restart.
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            {fixed.map((field) => (
              <div key={field.key} className="contents">
                <dt className="font-semibold">{field.label}</dt>
                <dd className="text-muted-foreground">
                  {shown(field.value)}. {firstSentence(field.description)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  )
}
