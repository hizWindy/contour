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
 *   usePress        the 0.98 press, for any m.* element
 *   useStill        true with reduced motion; useTransition picks INSTANT then
 *
 * Pages animate with `m.*` from 'motion/react' (never `motion.*`: MotionRoot is strict) and one of
 * the springs. Nothing loops, only transform and opacity move, and a table of more than 50 rows
 * gets no animation.
 */
export { ChipGroup, type ChipGroupProps, type ChipOption } from './chip-group'
export { MotionRoot } from './motion-root'
export { Reveal, type RevealProps } from './reveal'
export { RollingNumber, type RollingNumberProps } from './rolling-number'
export { Segmented, type SegmentedOption, type SegmentedProps } from './segmented'
export { EASE, INSTANT, REVEAL_MAX, REVEAL_STAGGER, springs, type SpringName } from './springs'
export { TabIndicator, type TabIndicatorProps } from './tab-indicator'
export { PRESS_SCALE, usePress } from './use-press'
export { useStill, useTransition } from './use-still'
