/**
 * Admin, HubSpot: the connection page (the key, its permissions, each project, the syncs and the
 * writes, in connection.tsx), the watchlist our copy gives, and, folded away, the backup: our
 * copy's counts, uploading an export and rebuilding the company profiles (nothing goes to
 * Claude here).
 */
import { createColumnHelper } from '@tanstack/react-table'
import { ChevronDown, RefreshCw, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useHubspotSummary, useImportHubspot, useRebuildProfiles, useWatchlist } from '@/api/hooks'
import type { WatchlistOut } from '@/api/types'
import { DataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { PendingText } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatDateTime, formatNumber, formatStaff } from '@/lib/format'
import { toastProblem } from '@/lib/problems'
import { ConnectionCard, PermissionsCard, SyncCard, WritesCard } from './connection'

type WatchItem = WatchlistOut['items'][number]
const help = createColumnHelper<WatchItem>()
const columns = [
  help.accessor('name', { header: 'Company', enableSorting: false }),
  help.accessor('city', {
    header: 'City',
    enableSorting: false,
    cell: (info) => info.getValue() ?? '',
  }),
  help.accessor('industry', {
    header: 'Industry',
    enableSorting: false,
    meta: { hideBelow: 'md' },
    cell: (info) => info.getValue() ?? 'Not known',
  }),
  help.accessor('office_based', {
    header: 'Works in an office',
    enableSorting: false,
    cell: (info) => (info.getValue() === 'likely' ? 'Likely' : 'Unlikely'),
  }),
  help.accessor('estimated_staff', {
    header: 'Staff (estimated)',
    enableSorting: false,
    meta: { align: 'right', hideBelow: 'sm' },
    cell: (info) => (info.getValue() === null ? 'Not known' : formatStaff(info.getValue())),
  }),
  help.accessor('note', {
    header: 'Note',
    enableSorting: false,
    meta: { hideBelow: 'md' },
    cell: (info) => info.getValue() ?? '',
  }),
]

function Summary() {
  const summary = useHubspotSummary()
  const rebuild = useRebuildProfiles()
  const data = summary.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Our copy of HubSpot</CardTitle>
        <CardDescription>
          {data?.last_imported_at
            ? `Last saved ${formatDateTime(data.last_imported_at)}.`
            : 'Nothing saved yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-ui">
        {summary.error ? <ErrorState error={summary.error} /> : null}
        {data ? (
          <p>
            {formatNumber(data.companies)} companies, {formatNumber(data.offices)} offices,{' '}
            {formatNumber(data.deals)} deals.
            {data.companies_by_source && data.companies_by_source.export > 0
              ? ` ${formatNumber(data.companies_by_source.export)} companies are from an export.`
              : ''}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={rebuild.isPending}
            onClick={() => {
              rebuild.mutate(undefined, {
                onSuccess: (result) => {
                  toast(`Rebuilt ${formatNumber(result.profiles_rebuilt)} company profiles.`)
                },
                onError: toastProblem,
              })
            }}
          >
            <RefreshCw aria-hidden="true" />
            {rebuild.isPending ? 'Rebuilding.' : 'Rebuild the company profiles'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function UploadExport() {
  const upload = useImportHubspot()
  const [file, setFile] = useState<File | null>(null)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!file) return
    upload.mutate(file, {
      onSuccess: (result) => {
        toast(
          `Uploaded ${formatNumber(result.companies)} companies and ${formatNumber(result.deals)} deals.`,
          { description: `${formatNumber(result.profiles_rebuilt)} profiles rebuilt.` },
        )
      },
      onError: toastProblem,
    })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Upload an export</CardTitle>
        <CardDescription>
          The .xlsx export from HubSpot. A Contacts sheet is skipped: no contact details are kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field className="max-w-md flex-1">
            <FieldLabel htmlFor="hubspot-file">Export file</FieldLabel>
            <Input
              id="hubspot-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
              }}
            />
            <FieldDescription>
              It replaces the companies, offices and deals kept now.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={!file || upload.isPending}>
            <Upload aria-hidden="true" />
            {upload.isPending ? 'Uploading.' : 'Upload'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Watchlist() {
  const watchlist = useWatchlist({ limit: 200 })
  const data = watchlist.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section font-semibold">Watchlist preview</CardTitle>
        <CardDescription>
          {data ? (
            `${formatNumber(data.counts.watch)} to watch (${formatNumber(data.counts.likely)} likely to work in an office), ${formatNumber(data.counts.director)} for Director review. Left out: ${formatNumber(data.counts.open_deal)} with an open deal, ${formatNumber(data.counts.dropped_small)} too small or with no staff number, ${formatNumber(data.counts.no_office)} with no office in a city we cover.`
          ) : (
            <PendingText />
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {watchlist.error ? (
          <ErrorState error={watchlist.error} context="The watchlist couldn't be worked out." />
        ) : (
          <DataTable
            label="Watchlist"
            columns={columns}
            data={data?.items ?? []}
            getRowId={(item) => item.hubspot_id}
            loading={watchlist.isFetching}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Backup() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-section font-semibold hover:bg-muted touch:min-h-11">
        Backup: upload an export
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 transition-transform duration-(--duration-fast) ease-(--ease) group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="grid gap-6 lg:grid-cols-2">
          <Summary />
          <UploadExport />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default function AdminHubSpotTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ConnectionCard />
        <PermissionsCard />
      </div>
      <SyncCard />
      <WritesCard />
      <Watchlist />
      <Backup />
    </div>
  )
}
