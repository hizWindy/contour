/**
 * The icon and the style of each badge, in one place. A badge always has an icon and a word, so
 * colour is never the only signal (DESIGN.md, "Accessibility"). The words are in `lib/labels.ts`.
 *
 * Results use colour: Pass is Olive, Director review is Ochre, Watch is Sand, Drop is a grey
 * outline. Colour is saved for results, so lead statuses, run statuses and HubSpot labels use
 * plain neutral badges, and only a failed run uses the Terracotta of an error.
 */
import {
  Ban,
  Bookmark,
  Building2,
  Circle,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CirclePause,
  CirclePlus,
  CircleQuestionMark,
  CircleSlash,
  CircleX,
  Clock,
  Eye,
  Handshake,
  Inbox,
  Send,
  TriangleAlert,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import type { HubSpotStatus, LeadResult, LeadStatus, RunStatus } from '@/api/types'

export type BadgeVariant =
  'default' | 'outline' | 'pass' | 'review' | 'watch' | 'drop' | 'destructive'

export interface BadgeMeta {
  icon: LucideIcon
  variant: BadgeVariant
}

/** Circle with a tick, person with a tick, eye, circle with a minus (DESIGN.md "Results"). */
export const RESULT_META: Record<LeadResult, BadgeMeta> = {
  pass: { icon: CircleCheck, variant: 'pass' },
  director_review: { icon: UserCheck, variant: 'review' },
  watch: { icon: Eye, variant: 'watch' },
  drop: { icon: CircleMinus, variant: 'drop' },
}

export const LEAD_STATUS_META: Record<LeadStatus, BadgeMeta> = {
  new: { icon: Inbox, variant: 'default' },
  watching: { icon: Bookmark, variant: 'outline' },
  rejected: { icon: CircleX, variant: 'drop' },
  sent: { icon: Send, variant: 'default' },
}

export const RUN_STATUS_META: Record<RunStatus, BadgeMeta> = {
  queued: { icon: Clock, variant: 'default' },
  // A live run is shown by a still dot. Nothing pulses.
  running: { icon: CircleDot, variant: 'outline' },
  done: { icon: CircleCheck, variant: 'default' },
  failed: { icon: TriangleAlert, variant: 'destructive' },
  cancelled: { icon: Ban, variant: 'outline' },
  interrupted: { icon: CirclePause, variant: 'outline' },
}

/** HubSpot labels are plain outline badges with an icon. Colour is saved for results. */
export const HUBSPOT_STATUS_META: Record<HubSpotStatus, BadgeMeta> = {
  new: { icon: CirclePlus, variant: 'outline' },
  in_hubspot: { icon: Building2, variant: 'outline' },
  open_deal: { icon: Handshake, variant: 'outline' },
  dissolved_deal: { icon: CircleSlash, variant: 'outline' },
  possible_match: { icon: CircleQuestionMark, variant: 'outline' },
}

/** For a value this build does not know: a plain outline badge with an empty circle. */
export const UNKNOWN_META: BadgeMeta = { icon: Circle, variant: 'outline' }
