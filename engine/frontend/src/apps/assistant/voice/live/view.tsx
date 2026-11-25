/**
 * What live voice shows, in the voice bar and in the pill beside a card (PLAN-V28 T2-4, "Words on
 * screen"; TBC at Al-khair's look):
 *
 * - **Where it stands, in one word** (`liveTitle` in `state.ts`): Connecting, Listening, Working
 *   it out (a tool call waits for its answer), Speaking (until the Assistant's voice has played
 *   out), Reconnecting, or Muted. Speaking comes before Working it out, since it is what is heard;
 *   and Muted only stands in for Listening, so a rep always sees what the Assistant is doing, and
 *   the Mute button shows that it is on. The bar and the pill each say it once to a screen
 *   reader, politely (their `SaidStatus`), and never each word.
 * - **Captions** (`LiveCaptions`): the rep's words as Google hears them, then the Assistant's, each
 *   after its word ("You", "Assistant"), so who said it never rests on colour alone. Google's guess
 *   at the words being said now is quieter. A long line shows its end, which is what is being said.
 *   They help in a loud room, and anyone who can't hear well. Nothing moves: the words are there.
 * - **Mute** (`MuteToggle`): a toggle in the kit's pressed look (the accent's tint and ink), with
 *   `aria-pressed`. No sound goes while it is on, and the talk goes on. In the pill it is the icon
 *   alone, named "Mute" with its tooltip, so on a phone (390 px) the pill's one word still fits
 *   beside the bars and Stop.
 */
import { MicOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { captionTail } from './state'
import type { Captions } from './talk'
import { ASSISTANT, MUTE, YOU } from './words'

export interface LiveCaptionsProps {
  captions: Captions
  /** What shows before any words: the bar's examples, its last line, or the card's hint. */
  empty: ReactNode
  className?: string
}

export function LiveCaptions({ captions, empty, className }: LiveCaptionsProps) {
  const { rep, hearing, assistant } = captions
  if (rep === '' && hearing === '' && assistant === '') return <>{empty}</>
  const yours = captionTail([rep, hearing].filter((part) => part !== '').join(' '))
  // The part of the rep's line that is still Google's guess, quieter, at its end.
  const guess = hearing !== '' && yours.endsWith(hearing) ? hearing : ''
  const sure = guess === '' ? yours : yours.slice(0, yours.length - guess.length)
  return (
    <dl
      data-slot="live-captions"
      className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1', className)}
    >
      {yours !== '' ? (
        <>
          <dt className="pt-px text-caption text-muted-foreground">{YOU}</dt>
          <dd data-slot="caption-rep" className="text-pretty text-foreground">
            {sure}
            {guess !== '' ? <span className="text-muted-foreground">{guess}</span> : null}
          </dd>
        </>
      ) : null}
      {assistant !== '' ? (
        <>
          <dt className="pt-px text-caption text-muted-foreground">{ASSISTANT}</dt>
          <dd data-slot="caption-assistant" className="text-pretty text-foreground">
            {captionTail(assistant)}
          </dd>
        </>
      ) : null}
    </dl>
  )
}

export interface MuteToggleProps {
  muted: boolean
  onMute: (on: boolean) => void
  /** The icon alone, named "Mute", with its tooltip: for the pill's small row. */
  iconOnly?: boolean
  className?: string
}

export function MuteToggle({ muted, onMute, iconOnly = false, className }: MuteToggleProps) {
  if (!iconOnly) {
    return (
      <Toggle
        variant="outline"
        size="sm"
        data-slot="live-mute"
        className={cn('touch:h-11', className)}
        pressed={muted}
        onPressedChange={onMute}
      >
        <MicOff aria-hidden="true" />
        {MUTE}
      </Toggle>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          variant="outline"
          size="sm"
          data-slot="live-mute"
          aria-label={MUTE}
          className={cn('size-8 min-w-8 shrink-0 px-0 touch:size-11', className)}
          pressed={muted}
          onPressedChange={onMute}
        >
          <MicOff aria-hidden="true" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{MUTE}</TooltipContent>
    </Tooltip>
  )
}
