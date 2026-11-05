/**
 * Admin, Settings: caps, models and limits a person may change, and the ones only engine/.env can
 * change (shown read only, with the HubSpot approval and the ceilings).
 *
 * Changes are saved together, all or nothing: a value the server refuses comes back beside its field
 * and nothing is saved. A changed setting can go back to its default. A change applies to the next
 * run and the next request; a run in progress keeps the caps it started with.
 */
import { RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fieldErrorMap, toApiProblem } from '@/api/client'
import { useResetSetting, useSettings, useUpdateSettings } from '@/api/hooks'
import type { SettingField, SettingValue } from '@/api/types'
import { PendingForm } from '@/components/skeletons'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toastProblem } from '@/lib/problems'

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

function Editor({
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
  const range =
    field.min !== null && field.max !== null
      ? `From ${String(field.min)} to ${String(field.max)}.`
      : ''
  if (field.type === 'bool') {
    return (
      <Field orientation="horizontal">
        <Checkbox
          id={id}
          checked={draft === true}
          onCheckedChange={(checked) => {
            onChange(checked === true)
          }}
        />
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      </Field>
    )
  }
  if (field.type === 'choice' || field.type === 'choice_or_null') {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Select
          value={draft === null ? DEFAULT_CHOICE : String(draft)}
          onValueChange={(value) => {
            onChange(value === DEFAULT_CHOICE ? null : value)
          }}
        >
          <SelectTrigger id={id} aria-invalid={error ? true : undefined}>
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
        <FieldDescription>{field.description}</FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
    )
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      <Input
        id={id}
        inputMode={field.type === 'int' ? 'numeric' : 'decimal'}
        value={draft === null ? '' : String(draft)}
        onChange={(event) => {
          onChange(parsed(field, event.target.value))
        }}
        aria-invalid={error ? true : undefined}
      />
      <FieldDescription>
        {field.description} {range}
      </FieldDescription>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export default function AdminSettingsTab() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const reset = useResetSetting()
  const [drafts, setDrafts] = useState<Record<string, SettingValue>>({})

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

  const save = (): void => {
    update.mutate(changed, {
      onSuccess: () => {
        setDrafts({})
        toast('Settings saved. They apply to the next run and the next request.')
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold">Settings you can change</CardTitle>
          <CardDescription>
            Left today across every run: <Money value={settings.data.daily_left_usd} />.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {update.error && Object.keys(errors).length === 0 ? (
            <ErrorState error={update.error} />
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2">
            {editable.map((field) => (
              <div key={field.key} className="flex flex-col gap-2">
                <Editor
                  field={field}
                  draft={field.key in drafts ? (drafts[field.key] ?? null) : field.value}
                  error={errors[field.key]}
                  onChange={(value) => {
                    setDrafts((current) => ({ ...current, [field.key]: value }))
                  }}
                />
                {field.overridden ? (
                  <div className="flex items-center gap-2 text-caption text-muted-foreground">
                    <Badge variant="outline">Changed</Badge>
                    <span>Default {shown(field.default)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={reset.isPending}
                      onClick={() => {
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
                    >
                      <RotateCcw aria-hidden="true" />
                      Use the default
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={Object.keys(changed).length === 0 || update.isPending}
              onClick={save}
            >
              <Save aria-hidden="true" />
              {update.isPending ? 'Saving.' : 'Save changes'}
            </Button>
            {Object.keys(changed).length > 0 ? (
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
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold">Set in engine/.env</CardTitle>
          <CardDescription>These change only in engine/.env, then a restart.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-ui sm:grid-cols-[auto_1fr]">
            {fixed.map((field) => (
              <div key={field.key} className="contents">
                <dt className="font-semibold">{field.label}</dt>
                <dd className="flex flex-col gap-1">
                  <span>{shown(field.value)}</span>
                  <span className="text-caption text-muted-foreground">{field.description}</span>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
