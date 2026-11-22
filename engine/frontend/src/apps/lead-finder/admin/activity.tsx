/**
 * Admin, People, a person, Activity (PLAN-V26 Part 3, choices 11 to 13): six tabs, newest first,
 * 50 to a page. Sign-ins (with what admins changed), Devices (each signed-in browser, with Sign
 * out), Calls and notes, Preps, Sent, and Spending (Claude's cost by day and by kind).
 *
 * Each row is a line of a list, not a table, so a phone shows all of it with no sideways scroll.
 */
import { ArrowLeft, LogOut } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMe, usePeople } from '@/api/hooks'
import {
  useActivityList,
  useDevices,
  useSignIns,
  useSignPersonOut,
  useSpending,
  type ActivityList,
  type DeviceItem,
} from '@/api/hooks/activity'
import { ErrorState } from '@/components/error-state'
import { Money } from '@/components/money'
import { Segmented } from '@/components/motion'
import { Pager } from '@/components/pager'
import { PendingCards } from '@/components/skeletons'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { eventFacts, eventWords } from './activity-words'

const PAGE_SIZE = 50

const TABS = [
  { value: 'sign-ins', label: 'Sign-ins' },
  { value: 'devices', label: 'Devices' },
  { value: 'calls', label: 'Calls and notes' },
  { value: 'preps', label: 'Preps' },
  { value: 'sent', label: 'Sent' },
  { value: 'spending', label: 'Spending' },
] as const
type TabId = (typeof TABS)[number]['value']

const EMPTY: Record<ActivityList, string> = {
  calls: 'No calls or notes yet.',
  preps: 'No call preps yet.',
  sent: 'Nothing sent yet.',
}

/** A tab's list: its error, its empty words, or its rows and the pages under them. */
function Rows({
  label,
  query,
  empty,
  page,
  onPage,
  children,
}: {
  label: string
  query: { error: Error | null; data: { total: number } | undefined; refetch: () => unknown }
  empty: string
  page: number
  onPage: (page: number) => void
  children: ReactNode
}) {
  if (query.error) {
    return (
      <ErrorState
        error={query.error}
        context={`${label} couldn't be loaded.`}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!query.data) return <PendingCards label={`Loading ${label.toLowerCase()}.`} cards={1} />
  const { total } = query.data
  if (total === 0) return <p className="text-ui text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={label} className="divide-y">
        {children}
      </ul>
      {total > PAGE_SIZE ? (
        <Pager page={{ pageIndex: page, pageSize: PAGE_SIZE, total }} onPageChange={onPage} />
      ) : null}
    </div>
  )
}

function Row({ title, facts, side }: { title: string; facts: string[]; side: ReactNode }) {
  return (
    <li className="flex flex-col gap-x-4 gap-y-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex min-w-0 flex-col">
        <span className="text-ui font-semibold break-words text-foreground">{title}</span>
        {facts.map((fact, index) => (
          <span key={index} className="text-caption break-words text-muted-foreground">
            {fact}
          </span>
        ))}
      </span>
      <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{side}</span>
    </li>
  )
}

interface TabProps {
  userId: string
  page: number
  onPage: (page: number) => void
}

function SignIns({ userId, page, onPage }: TabProps) {
  const query = useSignIns(userId, page * PAGE_SIZE)
  return (
    <Rows label="Sign-ins" query={query} empty="No sign-ins yet." page={page} onPage={onPage}>
      {query.data?.items.map((item) => (
        <Row
          key={item.id}
          title={eventWords(item)}
          facts={eventFacts(item)}
          side={formatDateTime(item.at)}
        />
      ))}
    </Rows>
  )
}

function List({ userId, list, page, onPage }: TabProps & { list: ActivityList }) {
  const query = useActivityList(userId, list, page * PAGE_SIZE)
  const label = TABS.find((tab) => tab.value === list)?.label ?? list
  return (
    <Rows label={label} query={query} empty={EMPTY[list]} page={page} onPage={onPage}>
      {query.data?.items.map((item) => (
        <Row
          key={`${item.id}-${item.at}`}
          title={item.what || 'No company yet'}
          facts={[item.detail, item.state].filter((fact): fact is string => Boolean(fact))}
          side={formatDateTime(item.at)}
        />
      ))}
    </Rows>
  )
}

/** Sign out, which asks first. `device` null: every browser. */
function SignOut({
  name,
  self,
  device,
  busy,
  onConfirm,
}: {
  name: string
  self: boolean
  device: DeviceItem | null
  busy: boolean
  onConfirm: () => void
}) {
  const who = self ? 'yourself' : name
  const signsMeOut = device ? device.current : self
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={device ? `Sign out ${device.device}` : undefined}
        >
          <LogOut aria-hidden="true" />
          {device ? 'Sign out' : 'Sign out everywhere'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {device ? `Sign ${who} out of ${device.device}?` : `Sign ${who} out everywhere?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {signsMeOut
              ? "This browser is signed out too, so you'll sign in again."
              : 'They need their password to sign in again.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Sign out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Devices({ userId, page, onPage, name }: TabProps & { name: string }) {
  const query = useDevices(userId, page * PAGE_SIZE)
  const out = useSignPersonOut(userId)
  const me = useMe()
  const self = me.data?.state === 'signed_in' && me.data.user.id === userId
  const end = (sessionId: string | null): void => {
    out.mutate(sessionId, {
      onSuccess: () => {
        toast(sessionId ? 'That browser is signed out.' : 'Signed out everywhere.')
      },
      onError: toastProblem,
    })
  }
  return (
    <div className="flex flex-col gap-3">
      {query.data && query.data.total > 0 ? (
        <div>
          <SignOut
            name={name}
            self={self}
            device={null}
            busy={out.isPending}
            onConfirm={() => {
              end(null)
            }}
          />
        </div>
      ) : null}
      <Rows
        label="Devices"
        query={query}
        empty="Not signed in on any browser now."
        page={page}
        onPage={onPage}
      >
        {query.data?.items.map((device) => (
          <Row
            key={device.id}
            title={device.current ? `${device.device} (this browser)` : device.device}
            facts={[
              device.ip ?? 'No IP address',
              `First used ${formatDateTime(device.first_used_at)}`,
              `Last used ${formatDateTime(device.last_used_at)}`,
            ]}
            side={
              <SignOut
                name={name}
                self={self}
                device={device}
                busy={out.isPending}
                onConfirm={() => {
                  end(device.id)
                }}
              />
            }
          />
        ))}
      </Rows>
    </div>
  )
}

function Spending({ userId, page, onPage }: TabProps) {
  const query = useSpending(userId, page * PAGE_SIZE)
  const data = query.data
  return (
    <div className="flex flex-col gap-3">
      {data && data.total > 0 ? (
        <p className="text-ui text-foreground">
          <Money value={data.total_usd} /> on Claude in all.
        </p>
      ) : null}
      <Rows
        label="Spending"
        query={query}
        empty="No Claude spending recorded."
        page={page}
        onPage={onPage}
      >
        {data?.items.map((row) => (
          <Row
            key={`${row.day}-${row.kind}`}
            title={row.kind}
            facts={[formatDate(row.day), pluralise(row.requests, 'request', 'requests')]}
            side={<Money value={row.cost_usd} />}
          />
        ))}
      </Rows>
      {/* Older requests didn't save who asked, so they can't be in a person's list (choice 13). */}
      {data && (page + 1) * PAGE_SIZE >= data.total ? (
        <p className="border-t pt-3 text-caption text-muted-foreground">
          Earlier: Not recorded before this update.
        </p>
      ) : null}
    </div>
  )
}

export default function AdminPersonActivity() {
  const { personId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const people = usePeople()
  const [paged, setPaged] = useState<{ tab: TabId; page: number }>({ tab: 'sign-ins', page: 0 })

  const tab = TABS.find((item) => item.value === params.get('tab'))?.value ?? 'sign-ins'
  const page = paged.tab === tab ? paged.page : 0 // another tab starts at its first page
  const onPage = (next: number): void => {
    setPaged({ tab, page: next })
  }

  const back = (
    <Button asChild variant="ghost" size="sm" className="self-start">
      <Link to="/admin/people">
        <ArrowLeft aria-hidden="true" />
        People
      </Link>
    </Button>
  )
  if (people.error) {
    return (
      <>
        {back}
        <ErrorState
          error={people.error}
          context="This person couldn't be loaded."
          onRetry={() => void people.refetch()}
        />
      </>
    )
  }
  if (!people.data) return <PendingCards label="Loading the person." cards={1} />
  const person = people.data.find((item) => item.id === personId)
  if (!person) {
    return (
      <>
        {back}
        <p className="text-ui text-muted-foreground">
          No such person. The account may have been removed.
        </p>
      </>
    )
  }

  const shared = { userId: person.id, page, onPage }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {back}
      <Card>
        <CardHeader>
          <CardTitle className="text-section font-semibold break-words">
            {person.name}: Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Segmented
            aria-label="Activity"
            size="sm"
            className="w-fit max-w-full"
            options={TABS}
            value={tab}
            onChange={(next) => {
              setPaged({ tab: next, page: 0 })
              setParams({ tab: next }, { replace: true })
            }}
          />
          {tab === 'sign-ins' ? <SignIns {...shared} /> : null}
          {tab === 'devices' ? <Devices {...shared} name={person.name} /> : null}
          {tab === 'calls' || tab === 'preps' || tab === 'sent' ? (
            <List key={tab} {...shared} list={tab} />
          ) : null}
          {tab === 'spending' ? <Spending {...shared} /> : null}
        </CardContent>
      </Card>
    </div>
  )
}
