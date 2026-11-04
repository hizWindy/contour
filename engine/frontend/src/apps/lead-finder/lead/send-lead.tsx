/**
 * The lead card's "Send to HubSpot" button (PLAN-V5 D4). It opens the shared preview dialog:
 * the backend reads HubSpot and says what would be written, and nothing is written until a
 * person confirms. A lead that was sent shows its send and a link instead.
 */
import { Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useLeadHubSpot, usePreviewLeadHubSpot, useSendLeadHubSpot } from '@/api/hooks'
import type { LeadDetail } from '@/api/types'
import { SendToHubSpotDialog } from '@/components/hubspot'
import { Button } from '@/components/ui/button'
import { toastProblem } from '@/lib/problems'

const SENT_WORDS = {
  done: 'Sent to HubSpot.',
  partial: 'Part sent. Open it to try the rest again.',
  uncertain: "HubSpot didn't answer. Check HubSpot before trying again.",
  failed: 'Nothing was sent. Try again.',
} as const

export function SendLead({ lead }: { lead: LeadDetail }) {
  const [open, setOpen] = useState(false)
  const existing = useLeadHubSpot(lead.id)
  const preview = usePreviewLeadHubSpot(lead.id)
  const send = useSendLeadHubSpot(lead.id)
  const write = send.data ?? preview.data ?? existing.data ?? undefined
  const sent = lead.status === 'sent' || write?.status === 'done'
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true)
          if (!sent) preview.mutate(undefined)
        }}
      >
        <Send aria-hidden="true" />
        {sent ? 'Sent to HubSpot' : 'Send to HubSpot'}
      </Button>
      <SendToHubSpotDialog
        open={open}
        onOpenChange={setOpen}
        company={lead.company}
        write={write}
        loading={preview.isPending}
        error={preview.error}
        sending={send.isPending}
        onConfirm={() => {
          if (!write) return
          send.mutate(write.id, {
            onSuccess: (result) => {
              const words =
                result.status in SENT_WORDS
                  ? SENT_WORDS[result.status as keyof typeof SENT_WORDS]
                  : null
              if (words) toast(words)
            },
            onError: toastProblem,
          })
        }}
      />
    </>
  )
}
