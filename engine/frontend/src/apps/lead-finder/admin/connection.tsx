/**
 * Admin, HubSpot: the connection page (PLAN-V5 C1). The key (set or not, never the key itself),
 * each permission, what each project can do, the syncs with a "Sync now" button, whether
 * writing is on, and the last 50 writes with links to HubSpot.
 */
import { createColumnHelper } from '@tanstack/react-table'
import {
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useHubSpotStatus,
  useHubSpotWrites,
  useRecheckHubSpot,
  useStartHubSpotSync,
} from '@/api/hooks'
import type { HubSpotScope, HubSpotSync, HubSpotWrite } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SourceLink } from '@/components/source-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

function syncCounts(sync: HubSpotSync): string {
  return [
    pluralise(sync.companies_saved, 'company', 'companies'),
    pluralise(sync.offices_saved, 'office'),
    pluralise(sync.deals_saved, 'deal'),
    pluralise(sync.owners_read, 'owner'),
  ].join(', ')
}

const syncHelp = createColumnHelper<HubSpotSync>()
const syncColumns = [
  syncHelp.accessor('started_at', {
    header: 'Started',
    enableSorting: false,
    cell: (info) => formatDateTime(info.getValue()),
  }),
  syncHelp.accessor('mode', {
    header: 'What it read',
    enableSorting: false,
    cell: (info) => (info.getValue() === 'full' ? 'Everything' : 'Changes only'),
  }),
  syncHelp.accessor('trigger', {
    header: 'Started by',
    enableSorting: false,
    meta: { hideBelow: 'md' },
    cell: (info) => TRIGGER[info.getValue()],
  }),
  syncHelp.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: (info) => SYNC_STATUS[info.getValue()],
  }),
  syncHelp.display({
    id: 'counts',
    header: 'Saved',
    meta: { hideBelow: 'sm' },
    cell: (info) => syncCounts(info.row.original),
  }),
  syncHelp.display({
    id: 'problems',
    header: 'Problems',
    meta: { hideBelow: 'md' },
    cell: (info) => {
      const sync = info.row.original
      const lines = [sync.error, ...sync.warnings].filter(Boolean)
      return lines.length > 0 ? lines.join(' ') : 'None'
    },
  }),
]

const writeHelp = createColumnHelper<HubSpotWrite>()
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
    cell: (info) => {
      const url = info.getValue()
      return url ? <SourceLink href={url} label="Open" /> : 'Not yet'
    },
  }),
]

export function ConnectionCard() {
  const status = useHubSpotStatus()
  const recheck = useRecheckHubSpot()
  const data = status.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">The connection</CardTitle>
        <CardDescription>
          One HubSpot key for every project. It is kept in engine/.env and never shown here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-ui">
        {status.error ? <ErrorState error={status.error} /> : null}
        {data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Key</dt>
            <dd>{data.key_set ? 'Set' : 'Missing: add HUBSPOT_SERVICE_KEY to engine/.env'}</dd>
            <dt className="text-muted-foreground">Connected</dt>
            <dd>
              {data.check.connected
                ? `Yes, account ${String(data.check.portal_id ?? '')}`
                : (data.check.problem ?? 'No')}
            </dd>
            <dt className="text-muted-foreground">Writing</dt>
            <dd>
              {data.write_enabled ? 'On' : 'Off (HUBSPOT_WRITE_ENABLED). Previews still work.'}
            </dd>
            <dt className="text-muted-foreground">Checked</dt>
            <dd>{formatDateTime(data.check.checked_at)}</dd>
          </dl>
        ) : null}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={recheck.isPending}
            onClick={() => {
              recheck.mutate(undefined, { onError: toastProblem })
            }}
          >
            <ShieldCheck aria-hidden="true" />
            {recheck.isPending ? 'Checking.' : 'Check again'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function PermissionsCard() {
  const status = useHubSpotStatus()
  const data = status.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Permissions and projects</CardTitle>
        <CardDescription>
          Found by trying each one. A check never changes anything in HubSpot.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-ui">
        {data ? (
          <>
            <ul className="flex flex-col gap-1" aria-label="Permissions">
              {data.check.scopes.map((scope) => {
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
              {data.projects.map((project) => (
                <li key={project.app}>
                  <p className="font-semibold">{project.summary}</p>
                  <p className="text-muted-foreground">{project.uses}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SyncCard() {
  const status = useHubSpotStatus()
  const start = useStartHubSpotSync()
  const data = status.data
  const running = data?.running_sync ?? null
  const good = data?.last_good_sync ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Syncs</CardTitle>
        <CardDescription>
          {running
            ? `Syncing since ${formatDateTime(running.started_at)}. This page updates by itself.`
            : good
              ? `Last good sync ${formatDateTime(good.finished_at ?? good.started_at)}: ${syncCounts(good)}.`
              : 'No sync yet. Pages use the export until the first one.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button
            type="button"
            disabled={!data?.key_set || running !== null || start.isPending}
            onClick={() => {
              start.mutate('auto', {
                onSuccess: (sync) => {
                  toast(
                    sync.mode === 'full'
                      ? 'Sync started. It reads everything, which takes a few minutes.'
                      : 'Sync started. It reads what changed since the last one.',
                  )
                },
                onError: toastProblem,
              })
            }}
          >
            <RefreshCw aria-hidden="true" />
            {running ? 'Syncing.' : 'Sync now'}
          </Button>
        </div>
        <DataTable
          label="Recent syncs"
          columns={syncColumns}
          data={data?.recent_syncs ?? []}
          getRowId={(sync) => String(sync.id)}
          loading={status.isFetching && !data}
        />
      </CardContent>
    </Card>
  )
}

export function WritesCard() {
  const writes = useHubSpotWrites(50)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Writes to HubSpot</CardTitle>
        <CardDescription>
          The last 50 changes a person confirmed. Each is written once only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {writes.error ? (
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
