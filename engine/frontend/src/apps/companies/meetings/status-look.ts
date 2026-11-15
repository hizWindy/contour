/**
 * Each status's icon and ink, on Meetings' rows and the pre-read's own page (PLAN-V17 "The
 * screens", parts 5 and 6). Done is Olive and a failure Terracotta, as on Activity. The word goes
 * with it (`STATUS_WORDS`), so colour is never the only signal.
 */
import {
  Ban,
  CircleCheck,
  CircleX,
  FileCheck,
  FilePlus,
  Hourglass,
  MailCheck,
  Notebook,
  type LucideIcon,
} from 'lucide-react'
import type { RowStatus } from './rows'

export const STATUS_LOOK: Readonly<Record<RowStatus, { icon: LucideIcon; ink: string }>> = {
  needs: { icon: FilePlus, ink: 'text-foreground' },
  drafting: { icon: Hourglass, ink: 'text-muted-foreground' },
  draft: { icon: FileCheck, ink: 'text-foreground' },
  sent: { icon: MailCheck, ink: 'text-pass-ink' },
  failed: { icon: CircleX, ink: 'text-destructive-ink' },
  notes_logged: { icon: CircleCheck, ink: 'text-pass-ink' },
  no_notes: { icon: Notebook, ink: 'text-muted-foreground' },
  cancelled: { icon: Ban, ink: 'text-muted-foreground' },
}
