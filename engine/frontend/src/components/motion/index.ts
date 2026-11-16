/**
 * The motion kit (PLAN-V13 T2-4, DESIGN.md "Motion"), built on the `motion` package.
 *
 *   MotionRoot      at the app's root: loads motion's features once, follows reduced motion
 *   springs         snappy, smooth, soft and exit; INSTANT for reduced motion
 *   Segmented       one choice from a few, the highlight slides
 *   ChipGroup       chips you tap to pick, with a tick and a press
 *   TabIndicator    the sliding underline for tabs
 *   Reveal          content fades and rises 4px once, at most 8 items one after another
 *   RollingNumber   a number that rolls to its new value, in table digits
 *   PushView        a view pushed over another in a box that keeps its size; the one under stays
 *   useViewShown    whether the view a part sits in is the one on show
 *   ListExit        a list whose rows leave: the row fades, the rows under it glide up
 *   LevelMeter      five bars that follow the mic's level, still at silence
 *   TickIn          a tick that draws once, when it mounts
 *   usePress        the 0.98 press, for any m.* element
 *   handleRovingKey the arrows, Home and End for a group that works like radio buttons
 *   useStill        true with reduced motion; useTransition picks INSTANT then
 *
 * Pages animate with `m.*` from 'motion/react' (never `motion.*`: MotionRoot is strict) and one of
 * the springs. Nothing loops, only transform and opacity move, and a table of more than 50 rows
 * gets no animation.
 *
 * Code in the first visit (main.tsx and the Home cards that modules.ts loads) imports a part from
 * its own file, not from here. Through this file the build would put every part a page uses into
 * the first visit (found in PLAN-V17 T3-5: Log call's PushView went there).
 */
export { ChipGroup, type ChipGroupProps, type ChipOption } from './chip-group'
export { LevelMeter, type LevelMeterProps } from './level-meter'
export {
  LIST_EXIT_MAX,
  ListExit,
  ListExitItem,
  type ListExitItemProps,
  type ListExitProps,
} from './list-exit'
export { MotionRoot } from './motion-root'
export { PushView, type PushViewProps } from './push-view'
export { Reveal, type RevealProps } from './reveal'
export { focusRadio, handleRovingKey, rovingTarget } from './roving'
export { RollingNumber, type RollingNumberProps } from './rolling-number'
export { Segmented, type SegmentedOption, type SegmentedProps } from './segmented'
export { EASE, INSTANT, REVEAL_MAX, REVEAL_STAGGER, springs, type SpringName } from './springs'
export { TabIndicator, type TabIndicatorProps } from './tab-indicator'
export { TickIn, type TickInProps } from './tick-in'
export { PRESS_SCALE, usePress } from './use-press'
export { useStill, useTransition } from './use-still'
export { useViewShown } from './view-shown'

// PLAN-V18 Track 2: an icon that turns once for each press (Meetings' Sync), and a row of steps
// whose dots fill as each state arrives (the pre-read while the AI drafts it).
export { SpinOnce, type SpinOnceProps } from './spin-once'
export { StepTrail, type StepTrailProps } from './step-trail'

// The mic card's parts (PLAN-V18 Track 3, T3-4): bars that follow the mic's own sound, and the
// card that grows from the mic button. The mic's code imports them from their own files.
export { FrequencyBars, type FrequencyBarsProps } from './frequency-bars'
export { MicSheet, MicSheetTitle, type MicSheetProps } from './mic-sheet'
