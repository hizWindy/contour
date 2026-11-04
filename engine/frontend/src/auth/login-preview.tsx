/**
 * The sign-in page's mockup (PLAN-V6, C1): the real page with fake states, while the sign-in
 * backend is still being built. Only the dev server has this address (`/preview/login`), so it
 * never ships.
 *
 * A small panel in the corner picks the state, the notice and a remembered username. The address
 * can set them too, for a screenshot: `?state=locked&notice=idle&remembered=1`. "Sign in" shows
 * "Signing in." for a moment, then the wrong-password message. Nothing is sent anywhere.
 */
import { SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LoginStatus } from './login-form'
import { LoginView } from './login-view'

const STATES = {
  ready: 'Ready',
  signing_in: 'Signing in',
  wrong: 'Wrong email or password',
  locked: 'Locked for 12 minutes',
  failed: 'No answer',
} as const
type StateKey = keyof typeof STATES

const NOTICE_WORDS = {
  none: 'No notice',
  idle: 'Signed out after idle',
  expired: 'Signed out after 12 hours',
  ended: 'Signed out elsewhere',
  signed_out: 'Signed out',
} as const
type NoticeKey = keyof typeof NOTICE_WORDS

function statusOf(key: StateKey): LoginStatus {
  return key === 'locked' ? { kind: 'locked', seconds: 12 * 60 } : { kind: key }
}

function pick<T extends string>(value: string | null, known: Record<T, string>, fallback: T): T {
  return value !== null && value in known ? (value as T) : fallback
}

/** A fake remembered username for the mockup. Not anyone's real one. */
const SAMPLE_USERNAME = 'sample.admin'

export default function LoginPreview() {
  const [params] = useSearchParams()
  const [state, setState] = useState<StateKey>(pick(params.get('state'), STATES, 'ready'))
  const [notice, setNotice] = useState<NoticeKey>(pick(params.get('notice'), NOTICE_WORDS, 'none'))
  const [remembered, setRemembered] = useState(params.get('remembered') === '1')
  // `?controls=0` starts with the controls folded away, for a clean screenshot.
  const [folded, setFolded] = useState(params.get('controls') === '0')
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )

  return (
    <>
      <LoginView
        // A new remembered username fills the field again, as on a fresh visit.
        key={remembered ? 'remembered' : 'empty'}
        status={statusOf(state)}
        notice={notice === 'none' ? null : notice}
        rememberedIdentifier={remembered ? SAMPLE_USERNAME : ''}
        onSubmit={() => {
          setState('signing_in')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            setState('wrong')
          }, 900)
        }}
      />
      {folded ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="fixed right-4 bottom-4 z-50 shadow-float max-sm:right-2 max-sm:bottom-2"
          onClick={() => {
            setFolded(false)
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          Mockup
        </Button>
      ) : (
        <aside
          aria-label="Mockup controls"
          className="fixed right-4 bottom-4 z-50 flex w-64 flex-col gap-3 rounded-lg border bg-popover p-4 text-ui shadow-float max-sm:right-2 max-sm:bottom-2 max-sm:w-56"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <p className="font-semibold">Mockup</p>
              <p className="text-caption text-muted-foreground">
                Fake states. Nothing is sent, so it can&apos;t sign you in. The real page is{' '}
                <Link to="/login" className="underline underline-offset-4">
                  /login
                </Link>
                .
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Hide the mockup controls"
              onClick={() => {
                setFolded(true)
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor="mockup-state">State</FieldLabel>
            <Select
              value={state}
              onValueChange={(value) => {
                setState(pick(value, STATES, 'ready'))
              }}
            >
              <SelectTrigger id="mockup-state" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATES) as StateKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATES[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="mockup-notice">Notice</FieldLabel>
            <Select
              value={notice}
              onValueChange={(value) => {
                setNotice(pick(value, NOTICE_WORDS, 'none'))
              }}
            >
              <SelectTrigger id="mockup-notice" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(NOTICE_WORDS) as NoticeKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {NOTICE_WORDS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="mockup-remembered"
              checked={remembered}
              onCheckedChange={(checked) => {
                setRemembered(checked === true)
              }}
            />
            <FieldLabel htmlFor="mockup-remembered" className="font-normal">
              Remembered username
            </FieldLabel>
          </Field>
        </aside>
      )}
    </>
  )
}
