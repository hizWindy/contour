/**
 * The parts of Results that few visits need, each in a file of its own (PLAN-V7 D1): the divider
 * between the list and the map (react-resizable-panels, about 25 kB gzip) and the calendar for the
 * date filters (react-day-picker with date-fns, about 40 kB gzip). The page asks for them when the
 * browser is idle after it shows, so a person who opens one finds it already there.
 */
export const loadMapSplit = () => import('./map-split')

export const loadCalendar = () =>
  import('@/components/ui/calendar').then((module) => ({ default: module.Calendar }))
