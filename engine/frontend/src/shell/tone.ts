/**
 * Project colour (DESIGN.md "Project colour"): one quiet tint per project, so a page shows at a
 * glance which project it belongs to. It goes on the project's icon tiles, its icon in the menu
 * and on its Home card, and nowhere else: buttons, text and status keep Navy and the
 * result colours.
 */
export type ProjectTone = 'lead'

export const TONE_CLASSES: Record<ProjectTone, { icon: string; tile: string }> = {
  lead: {
    icon: 'text-lead',
    tile: 'bg-lead-soft text-lead-ink',
  },
}
