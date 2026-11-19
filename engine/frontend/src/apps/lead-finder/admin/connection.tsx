/**
 * Admin, HubSpot: the connection page (PLAN-V5 C1). The key (set or not, never the key itself),
 * each permission, what each project can do, the syncs with "Sync now" (what changed, and
 * everything once a week), "Full copy" and, while one runs, its phase and Stop (PLAN-V15 T2-6),
 * whether writing is on, and the last 50 writes with links to HubSpot.
 *
 * Each project's line is the backend's own sentence, like "Companies: reading ready. Sending waits
 * for crm.objects.calls.write." (PLAN-V17 T3-7: Companies sends call notes). An icon beside it says
 * where it stands at a glance, as the permissions above have: ready, waiting, not known or off.
 */
import { createColumnHelper } from '@tanstack/react-table'
import {
  ChevronDown,
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  CircleX,
  Copy,
  Hourglass,
  RefreshCw,
  ShieldCheck,
  Square,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { isApiProblem } from '@/api/client'
import {
  useCancelHubSpotSync,
  useHubSpotStatus,
  useHubSpotWrites,
  useRecheckHubSpot,
  useStartHubSpotSync,
} from '@/api/hooks'
import type { HubSpotProject, HubSpotScope, HubSpotSync, HubSpotWrite } from '@/api/types'
import { useOpensHubSpot } from '@/auth/hubspot-user'
import { DataTable } from '@/components/data-table'
import { isStopping, stoppedWords, syncProgress } from '@/components/hubspot/sync-progress'
import { ErrorState } from '@/components/error-state'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatDateTime, pluralise } from '@/lib/format'
import { toastProblem } from '@/lib/problems'

const STATE: Record<HubSpotScope['state'], { icon: LucideIcon; word: string }> = {
  yes: { icon: CircleCheck, word: 'Yes' },
  no: { icon: CircleX, word: 'No' },
  unknown: { icon: CircleQuestionMark, word: 'Not known' },
}
const SYNC_STATUS: Record<HubSpotSync['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Stopped part way',
  cancelled: 'Stopped',
}
const TRIGGER: Record<HubSpotSync['trigger'], string> = {
  command: 'Command',
  website: 'Website',
  startup: 'Backend start',
  schedule: 'Schedule',
}
const WRITE_STATUS: Record<HubSpotWrite['status'], string> = {
  previewed: 'Previewed',
  writing: 'Writing',
  done: 'Sent',
  partial: 'Part sent',
  failed: 'Failed',
  uncertain: 'Not sure it landed',
}

/**
 * The icon for a project's line: waiting for a permission, not known yet, sending switched off, or
 * ready (reading and, if it sends, sending). The words are the backend's own `summary`.
 */
function projectIcon(project: HubSpotProject): LucideIcon {
  if (project.reading === 'waiting' || project.sending === 'waiting') return Hourglass
  if (project.reading === 'unknown' || project.sending === 'unknown') return CircleQuestionMark
  if (project.sending === 'off') return CirclePause
  return CircleCheck
}

function syncCounts(sync: HubSpotSync): string {
  return [
    pluralise(sync.companies_saved, 'company', 'companies'),
    pluralise(sync.offices_saved, 'office'),
    pluralise(sync.deals_saved, 'deal'),
    pluralise(sync.owners_read, 'owner'),
  ].join(', ')
}

const writeHelp = createColumnHelper<HubSpotWrite>()
/** A write's record in HubSpot: Open, or only "Yes" for someone with no HubSpot user (T3-4). */
function WrittenTo({ url }: { url: string | null }) {
  const opens = useOpensHubSpot()
  if (!url) return 'Not yet'
  return opens ? <SourceLink href={url} label="Open" /> : 'Yes'
}

const writeColumns = [
  writeHelp.accessor('created_at', {
    header: 'When',
    enableSorting: false,
    cell: (info) => formatDateTime(info.row.original.finished_at ?? info.getValue()),
  }),
  writeHelp.display({
    id: 'company',
    header: 'Company',
    enableSorting: false,
    cell: (info) => info.row.original.plan.company_name,
  }),
  writeHelp.accessor('app', {
    header: 'Project',
    enableSorting: false,
    meta: { hideBelow: 'md' },
    cell: (info) => (info.getValue() === 'lead_finder' ? 'Lead Finder' : info.getValue()),
  }),
  writeHelp.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: (info) => WRITE_STATUS[info.getValue()],
  }),
  writeHelp.accessor('hubspot_url', {
    header: 'In HubSpot',
    enableSorting: false,
    meta: { hideBelow: 'sm' },
    cell: (info) => <WrittenTo url={info.getValue()} />,
  }),
]

/**
 * The connection and its permissions in one card (PLAN-V13 T1-9): the key, the account, writing on
 * or off and when it was checked, then the permissions as one line ("6 of 8 permissions") that
 * opens the list and what each project can do.
 */
export function ConnectionCard() {
  const status = useHubSpotStatus()
  const recheck = useRecheckHubSpot()
  const data = status.data
  const scopes = data?.check.scopes ?? []
  const yes = scopes.filter((scope) => scope.state === 'yes').length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">The connection</CardTitle>
        <CardDescription>One key for every project, kept in the server's settings.</CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={recheck.isPending}
            onClick={() => {
              recheck.mutate(undefined, { onError: toastProblem })
            }}
          >
            <ShieldCheck aria-hidden="true" />
            {recheck.isPending ? 'Checking.' : 'Check again'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-ui">
        {status.error ? <ErrorState error={status.error} /> : null}
        {data ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
              <dt className="text-muted-foreground">Key</dt>
              <dd>
                {data.key_set
                  ? 'Set'
                  : 'Missing: whoever runs the server adds the HubSpot key to its settings'}
              </dd>
              <dt className="text-muted-foreground">Connected</dt>
              <dd>
                {data.check.connected
                  ? `Yes, account ${String(data.check.portal_id ?? '')}`
                  : (data.check.problem ?? 'No')}
              </dd>
              <dt className="text-muted-foreground">Writing</dt>
              <dd>{data.write_enabled ? 'On' : 'Off (a server setting). Previews still work.'}</dd>
              <dt className="text-muted-foreground">Checked</dt>
              <dd>{formatDateTime(data.check.checked_at)}</dd>
            </dl>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-fit items-center gap-2 rounded-md py-1 text-left font-semibold hover:text-foreground touch:min-h-11">
                {yes} of {scopes.length} permissions
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-4 pt-2">
                <p className="text-caption text-muted-foreground">
                  Found by trying each one. A check never changes anything in HubSpot.
                </p>
                <ul className="flex flex-col gap-1" aria-label="Permissions">
                  {scopes.map((scope) => {
                    const { icon: Icon, word } = STATE[scope.state]
                    return (
                      <li key={scope.scope} className="flex items-start gap-2">
                        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>
                          <span className="font-semibold">{word}:</span> {scope.label}{' '}
                          <span className="text-muted-foreground">({scope.scope})</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <ul className="flex flex-col gap-2" aria-label="Projects">
                  {data.projects.map((project) => {
                    const Icon = projectIcon(project)
                    return (
                      <li key={project.app} className="flex items-start gap-2">
                        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-semibold">{project.summary}</span>
                          <span className="text-muted-foreground">{project.uses}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The syncs as a short list: the newest five, each in one line. */
export function SyncCard() {
  const status = useHubSpotStatus()
  const start = useStartHubSpotSync()
  const cancel = useCancelHubSpotSync()
  const data = status.data
  const running = data?.running_sync ?? null
  const good = data?.last_good_sync ?? null
  const recent = (data?.recent_syncs ?? []).slice(0, 5)
  const lastFull = (data?.recent_syncs ?? []).find(
    (sync) => sync.status === 'done' && sync.mode === 'full',
  )
  const stopping = Boolean(running && (isStopping(running) || cancel.isPending))
  const startSync = (mode: 'auto' | 'full'): void => {
    start.mutate(mode, {
      onSuccess: (sync) => {
        toast(
          sync.mode === 'full'
            ? 'Sync started. It reads everything, which takes a few minutes.'
            : 'Sync started. It reads what changed since the last one.',
        )
      },
      onError: toastProblem,
    })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Syncs</CardTitle>
        <CardDescription role="status">
          {running
            ? `Syncing since ${formatDateTime(running.started_at)}. ${
                stopping ? 'Stopping…' : syncProgress(running, lastFull).words
              } This page updates by itself.`
            : good
              ? `Last good sync ${formatDateTime(good.finished_at ?? good.started_at)}: ${syncCounts(good)}.`
              : 'No sync yet. Pages use the export until the first one.'}
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          {running ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={stopping}
              onClick={() => {
                cancel.mutate(running.id, {
                  onError: (error) => {
                    if (isApiProblem(error) && error.code === 'not_running') {
                      toast('That sync had already finished')
                      void status.refetch()
                      return
                    }
                    toastProblem(error)
                  },
                })
              }}
            >
              <Square aria-hidden="true" />
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!data?.key_set || start.isPending}
                onClick={() => {
                  startSync('full')
                }}
              >
                <Copy aria-hidden="true" />
                Full copy
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!data?.key_set || start.isPending}
                onClick={() => {
                  startSync('auto')
                }}
              >
                <RefreshCw aria-hidden="true" />
                Sync now
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>
      {recent.length > 0 ? (
        <CardContent>
          <ul aria-label="Recent syncs" className="flex flex-col text-ui">
            {recent.map((sync) => (
              <li
                key={sync.id}
                className="flex flex-wrap items-baseline gap-x-3 border-b py-2 last:border-b-0"
              >
                <span className="font-semibold tabular-nums">
                  {formatDateTime(sync.started_at)}
                </span>
                <span>{SYNC_STATUS[sync.status]}</span>
                <span className="text-muted-foreground">
                  {sync.mode === 'full' ? 'Everything' : 'What changed'}, by{' '}
                  {TRIGGER[sync.trigger].toLowerCase()}. {syncCounts(sync)}.
                  {sync.status === 'cancelled' ? ` ${stoppedWords(sync)}` : ''}
                </span>
                {sync.error ? <span className="text-destructive-ink">{sync.error}</span> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}

/**
 * The write log is for Admins (PLAN-V17, Track 1's security fix): once writing is on it holds what
 * call notes sent (a call's outcome, follow-ups, field values, note text), and a rep sees only
 * their own notes. Everyone else who opens this page gets a 403 on this one list, which is a plain
 * line here, not an error: the rest of the page stays as it is.
 */
const WRITES_ADMIN_ONLY = 'Only an Admin can see the writes to HubSpot.'

export function WritesCard() {
  const writes = useHubSpotWrites(50)
  const adminOnly = isApiProblem(writes.error) && writes.error.status === 403
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Writes to HubSpot</CardTitle>
        <CardDescription>
          The last 50 changes a person confirmed. Each is written once only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {adminOnly ? (
          <p className="text-ui text-muted-foreground">{WRITES_ADMIN_ONLY}</p>
        ) : writes.error ? (
          <ErrorState error={writes.error} />
        ) : (
          <DataTable
            label="Writes to HubSpot"
            columns={writeColumns}
            data={writes.data ?? []}
            getRowId={(write) => write.id}
            loading={writes.isFetching}
          />
        )}
      </CardContent>
    </Card>
  )
}
