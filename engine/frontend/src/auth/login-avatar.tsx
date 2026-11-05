/**
 * The sign-in page's avatar: a person in a suit and glasses, drawn in the design's tokens. It
 * reacts to the form and then keeps still (DESIGN.md "Motion"):
 * - its eyes follow the login as it is typed, and close while a hidden password is typed;
 * - after a wrong try its head shakes once (0.6 s), and it looks concerned until you type again;
 * - after a sign-out it waves once (1.8 s) when the page opens.
 * Nothing loops. With reduced motion it changes face but does not move.
 *
 * It is for the eye only (`aria-hidden`): every state also has words and an icon on the form.
 */
import { m } from 'motion/react'
import { REDUCED_MOTION, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import type { AvatarMood } from './login-form'

/** The one curve (DESIGN.md "Motion"), for `motion`. */
const EASE = [0.4, 0, 0.2, 1] as const

const BROWS: Record<AvatarMood, [string, string]> = {
  ready: ['M26.2 23.6 Q28.5 22.6 30.6 23.4', 'M33.4 23.4 Q35.5 22.6 37.8 23.6'],
  watching: ['M26.2 23.4 Q28.5 22.6 30.6 23.4', 'M33.4 23.4 Q35.5 22.6 37.8 23.4'],
  eyes_closed: ['M26.2 23.8 Q28.5 23.2 30.6 23.8', 'M33.4 23.8 Q35.5 23.2 37.8 23.8'],
  thinking: ['M26.2 22.4 Q28.5 21.2 30.6 22.2', 'M33.4 23.4 Q35.5 23 37.8 23.6'],
  concerned: ['M26.2 23.4 Q28.5 23.2 30.6 22.2', 'M33.4 22.2 Q35.5 23.2 37.8 23.4'],
}

const MOUTHS: Record<AvatarMood, string> = {
  ready: 'M29 34.2 Q32 36.6 35 34.2',
  watching: 'M29.6 34.6 Q32 35.8 34.4 34.6',
  eyes_closed: 'M29.6 34.4 Q32 35.8 34.4 34.4',
  thinking: 'M30.2 35 Q32 34.6 33.8 35.2',
  concerned: 'M29.4 35.8 Q32 33.8 34.6 35.8',
}

const LINE = {
  stroke: 'var(--avatar-line)',
  strokeWidth: 0.9,
  strokeLinecap: 'round',
  fill: 'none',
} as const

export interface LoginAvatarProps {
  mood: AvatarMood
  /** 0 to 1: how long the typed login is, so the eyes move along it. */
  look: number
  /** Goes up by one at every failed try: the head shakes once each time. */
  shakes: number
  /** True when the person was just signed out: it waves once as the page opens. */
  wave: boolean
  className?: string
}

export function LoginAvatar({ mood, look, shakes, wave, className }: LoginAvatarProps) {
  const still = useMediaQuery(REDUCED_MOTION)
  const glide = { duration: still ? 0 : 0.15, ease: EASE }

  // Where the eyes look: along the login while it is typed, up while it thinks, ahead otherwise.
  const along = Math.min(Math.max(look, 0), 1)
  const eye =
    mood === 'watching'
      ? { x: -1.4 + along * 2.8, y: 1 }
      : mood === 'thinking'
        ? { x: 1, y: -1.2 }
        : mood === 'concerned'
          ? { x: 0, y: 0.6 }
          : { x: 0, y: 0 }
  const [leftBrow, rightBrow] = BROWS[mood]

  return (
    <span
      aria-hidden="true"
      data-slot="login-avatar"
      data-mood={mood}
      className={cn(
        'flex size-14 shrink-0 overflow-hidden rounded-lg border bg-secondary sm:size-16',
        className,
      )}
    >
      <svg viewBox="0 0 64 64" focusable="false" className="size-full">
        {/* Shoulders, shirt, tie and lapels. */}
        <path d="M8 64 C8 51 18 46 32 46 C46 46 56 51 56 64 Z" fill="var(--avatar-suit)" />
        <path d="M27 46.5 L32 56 L37 46.5 Z" fill="var(--avatar-shirt)" />
        <path
          d="M30.8 48 L33.2 48 L34.2 50.5 L33 58.5 L32 60 L31 58.5 L29.8 50.5 Z"
          fill="var(--avatar-tie)"
        />
        <path d="M27 46.5 L31 57 M37 46.5 L33 57" {...LINE} strokeOpacity={0.35} />
        <rect x="28.5" y="39" width="7" height="9" rx="2" fill="var(--avatar-skin-shade)" />

        {/* The head. A new `shakes` number starts one shake. */}
        <m.g
          key={shakes}
          initial={{ x: 0 }}
          animate={shakes > 0 && !still ? { x: [0, -2.4, 2.4, -1.8, 1.8, -0.8, 0] } : { x: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <ellipse cx="21.6" cy="29" rx="1.8" ry="2.8" fill="var(--avatar-skin-shade)" />
          <ellipse cx="42.4" cy="29" rx="1.8" ry="2.8" fill="var(--avatar-skin-shade)" />
          <ellipse cx="32" cy="28" rx="10.5" ry="12" fill="var(--avatar-skin)" />
          <path
            d="M21.5 27 C20.5 17 26 13 32.5 13 C39.5 13 44 18 42.6 27 C41 21.5 37 19.5 32 19.8 C27 20 23.2 22.5 21.5 27 Z"
            fill="var(--avatar-hair)"
          />
          <path d={leftBrow} {...LINE} />
          <path d={rightBrow} {...LINE} />
          {mood === 'eyes_closed' ? (
            <>
              <path d="M27.3 27.4 Q28.6 28.5 29.9 27.4" {...LINE} />
              <path d="M34.1 27.4 Q35.4 28.5 36.7 27.4" {...LINE} />
            </>
          ) : (
            <>
              <m.circle
                r={1.1}
                fill="var(--avatar-line)"
                initial={false}
                animate={{ cx: 28.6 + eye.x, cy: 27.2 + eye.y }}
                transition={glide}
              />
              <m.circle
                r={1.1}
                fill="var(--avatar-line)"
                initial={false}
                animate={{ cx: 35.4 + eye.x, cy: 27.2 + eye.y }}
                transition={glide}
              />
            </>
          )}
          {/* Thin glasses: a formal touch. */}
          <g stroke="var(--avatar-line)" strokeWidth={0.75} fill="none">
            <rect x="25.3" y="24.7" width="6.6" height="5" rx="1.6" />
            <rect x="32.1" y="24.7" width="6.6" height="5" rx="1.6" />
            <path d="M31.9 26.6 L32.1 26.6" />
          </g>
          <path d={MOUTHS[mood]} {...LINE} />
        </m.g>

        {/* One wave after a sign-out, then the arm goes down out of view. */}
        {wave && !still ? (
          <m.g
            data-slot="login-avatar-wave"
            style={{ originX: 0, originY: 1 }}
            initial={{ rotate: -25, opacity: 0 }}
            animate={{ rotate: [-25, 12, -8, 12, -25], opacity: [0, 1, 1, 1, 0] }}
            transition={{ duration: 1.8, ease: EASE, delay: 0.3 }}
          >
            <path
              d="M50 64 L54 46"
              stroke="var(--avatar-suit)"
              strokeWidth={5}
              strokeLinecap="round"
            />
            <circle cx="54.6" cy="43.4" r="2.8" fill="var(--avatar-skin)" />
          </m.g>
        ) : null}
      </svg>
    </span>
  )
}
