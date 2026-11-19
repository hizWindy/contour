/**
 * V with the AI off (PLAN-V22 T3-5, choice 17): the words can't be read into a command, so they go
 * in a new call note. Call logs' own Log call panel opens on its company list, and once the rep
 * picks the company, the note view opens with the words in the note box, to check and save as any
 * call note. A toast says why, in the plan's words.
 *
 * The words become that company's draft as it is picked (`call-notes/draft.ts`), so the note view
 * shows them, and a refresh or a closed panel keeps them as any draft is kept. A draft the rep had
 * already started for that company keeps its words, and the new ones go after them.
 *
 * Its code loads late, with the review card's host, only when it is needed.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { SignIn } from '@/api/hooks/auth'
import { useCallNoteOptions } from '@/api/hooks/call-note-counts'
import { queryKeys } from '@/api/query'
import type { CommandSource } from '@/api/types'
import { LogCallSheet, type LogCallState } from '@/apps/companies/call-logs/log-call'
import { draftOwner, keepDraft, readDraft, startDraft } from '@/apps/companies/call-notes/draft'
import { PHONE, useMediaQuery } from '@/lib/use-media-query'
import { AI_OFF } from './words'

export interface DictationProps {
  words: string
  source: CommandSource
  open: boolean
  onClose: () => void
}

export default function Dictation({ words, source, open, onClose }: DictationProps) {
  const client = useQueryClient()
  const options = useCallNoteOptions()
  const onPhone = useMediaQuery(PHONE)
  const [state, setState] = useState<LogCallState>({ from: 'picker', picked: null })

  // Once, as it opens: why Log call opened.
  useEffect(() => {
    toast(AI_OFF)
  }, [])

  return (
    <LogCallSheet
      state={open ? state : null}
      options={options.data}
      onPhone={onPhone}
      onPickCompany={(target) => {
        const owner = draftOwner(client.getQueryData<SignIn>(queryKeys.auth.me()))
        const kept = readDraft(owner, target.companyKey, null)
        const text = kept?.text.trim() ? `${kept.text.trimEnd()} ${words}` : words
        keepDraft({
          ...(kept ?? startDraft(owner, target.companyKey, null)),
          text,
          source: source === 'mic' ? 'mic' : 'typed',
          updatedAt: new Date().toISOString(),
        })
        setState({ from: 'picker', picked: target })
      }}
      onBackToList={() => {
        setState({ from: 'picker', picked: null })
      }}
      onClose={onClose}
    />
  )
}
