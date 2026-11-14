/**
 * A list whose rows can leave: the row fades and moves 8px to the right (`exit`, 150ms), and the
 * rows under it glide up as a transform (Motion's `layout`, on `snappy`), never an animated
 * height. Activity uses it when a card leaves the batch: X, or sent (PLAN-V17 T3-6).
 *
 *   <ListExit aria-label="Calls to confirm" className="flex flex-col gap-3">
 *     {notes.map((note) => (
 *       <ListExitItem key={note.id}>
 *         <NoteCard note={note} />
 *       </ListExitItem>
 *     ))}
 *   </ListExit>
 *
 * The children are ListExitItem rows, each with its own key, and nothing else: the list counts
 * them. The leaving row is taken out of the layout at once (`popLayout` pins it where it was), so
 * the rows under it start to glide while it fades. Only a row's place moves (`layout="position"`):
 * a card that grows while it is edited changes size at once, so its text is never stretched. A row
 * that arrives is simply there, and the rows around it glide; wrap its content in Reveal if it
 * should fade in.
 *
 * The leaving row is inert while it goes, so J, K, Tab and a screen reader skip it. Focus is the
 * caller's job: when the row with the focus leaves, the browser drops the focus, so move it at
 * once to the next row (or the one before, if it was the last).
 *
 * More than 50 rows: nothing moves at all (DESIGN.md "Speed budget"), and a leaving row is simply
 * gone. The same with reduced motion.
 */
import { AnimatePresence, m, useIsPresent, type HTMLMotionProps } from 'motion/react'
import { Children, createContext, useContext, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { INSTANT, springs } from './springs'
import { useStill } from './use-still'

/** More rows than this, and nothing in the list moves (DESIGN.md "Speed budget"). */
export const LIST_EXIT_MAX = 50

/** How far a leaving row moves as it fades. */
const SHIFT = 8

/** Whether the rows move: not with reduced motion, and not in a list of more than 50 rows. */
const MovingRows = createContext(false)

export type ListExitProps = ComponentProps<'ul'>

export function ListExit({ children, className, ...props }: ListExitProps) {
  const still = useStill()
  const moving = !still && Children.toArray(children).length <= LIST_EXIT_MAX
  return (
    <ul data-slot="list-exit" className={cn('relative', className)} {...props}>
      <MovingRows.Provider value={moving}>
        <AnimatePresence mode="popLayout">{children}</AnimatePresence>
      </MovingRows.Provider>
    </ul>
  )
}

export type ListExitItemProps = Omit<
  HTMLMotionProps<'li'>,
  'layout' | 'initial' | 'animate' | 'exit' | 'transition' | 'inert' | 'hidden'
>

/** One row of a ListExit. Give it a key, as any row of a list. */
export function ListExitItem({ children, ...props }: ListExitItemProps) {
  const moving = useContext(MovingRows)
  const present = useIsPresent()
  return (
    <m.li
      {...props}
      layout={moving ? 'position' : false}
      initial={false}
      exit={
        moving
          ? { opacity: 0, x: SHIFT, transition: springs.exit }
          : { opacity: 0, transition: INSTANT }
      }
      transition={{ layout: springs.snappy }}
      inert={!present}
      hidden={!moving && !present}
    >
      {children}
    </m.li>
  )
}
