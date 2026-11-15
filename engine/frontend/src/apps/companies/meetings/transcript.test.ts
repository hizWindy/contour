/**
 * A past meeting's transcript in plain code (PLAN-V17 T3-11, "Log meeting"): how long it is as the
 * server counts it, when the server reads it as a .vtt, whether it can go, and reading a .txt or
 * .vtt file in the browser. Made-up words only.
 */
import { describe, expect, it } from 'vitest'
import {
  checkTranscript,
  FILE_MAX_BYTES,
  isVtt,
  nearCount,
  readTranscriptFile,
  TEXT_MAX_CHARS,
  TRANSCRIPT_MAX_CHARS,
  transcriptLength,
} from './transcript'

const VTT = [
  'WEBVTT',
  '',
  '1',
  '00:00:01.000 --> 00:00:04.000',
  '<v Jo Sample>Thanks for coming in.</v>',
].join('\n')

function file(parts: BlobPart[], name: string): File {
  return new File(parts, name)
}

describe('how long it is', () => {
  it('counts as the server does: one line end, no spaces at the ends, an emoji as one', () => {
    expect(transcriptLength('  Jo: Hi.  \r\nSam: Hello.\t\n\n')).toBe('Jo: Hi.\nSam: Hello.'.length)
    expect(transcriptLength('Thumbs up \u{1F44D}')).toBe(11)
    expect(transcriptLength(' \n \t ')).toBe(0)
  })

  it('knows a .vtt by its name or its first word, as the server does', () => {
    expect(isVtt('Jo: Hi.', 'Meeting.VTT')).toBe(true)
    expect(isVtt(`\n  ${VTT}`, null)).toBe(true)
    expect(isVtt(`${String.fromCharCode(0xfeff)}${VTT}`, null)).toBe(true)
    expect(isVtt('Jo: Hi.', 'meeting.txt')).toBe(false)
    expect(isVtt('We spoke about WEBVTT files.', null)).toBe(false)
  })
})

describe('whether it can go', () => {
  it('takes plain text up to 60,000 characters, and says when it is empty', () => {
    expect(TRANSCRIPT_MAX_CHARS).toBe(60_000)
    expect(checkTranscript('a'.repeat(60_000), null)).toEqual({ kind: 'ok' })
    expect(checkTranscript('a'.repeat(60_001), null)).toEqual({
      kind: 'too_long',
      length: 60_001,
      max: 60_000,
    })
    expect(checkTranscript('   ', null)).toEqual({ kind: 'empty' })
  })

  it("leaves a .vtt's 60,000 to the server, which takes its times out, up to 200,000 in all", () => {
    const long = `${VTT}\n${'a'.repeat(70_000)}`
    expect(checkTranscript(long, 'meeting.vtt')).toEqual({ kind: 'ok' })
    const tooLong = `${VTT}\n${'a'.repeat(TEXT_MAX_CHARS)}`
    expect(checkTranscript(tooLong, 'meeting.vtt')).toEqual({
      kind: 'too_long',
      length: tooLong.length,
      max: TEXT_MAX_CHARS,
    })
  })

  it('shows the count in the last tenth of the room only', () => {
    expect(nearCount('a'.repeat(53_999), null)).toBeNull()
    expect(nearCount('a'.repeat(54_000), null)).toEqual({ length: 54_000, max: 60_000 })
    // A .vtt counts against the 200,000 its text may hold, times and all.
    expect(nearCount(`${VTT}\n${'a'.repeat(70_000)}`, 'meeting.vtt')).toBeNull()
  })
})

describe('reading a file', () => {
  it('reads a .txt or .vtt file as text, and keeps its name', async () => {
    expect(
      await readTranscriptFile(file(['Jo: Thanks for coming in.'], 'Meeting notes.txt')),
    ).toEqual({ kind: 'ok', text: 'Jo: Thanks for coming in.', name: 'Meeting notes.txt' })
    expect(await readTranscriptFile(file([VTT], 'meeting.vtt'))).toEqual({
      kind: 'ok',
      text: VTT,
      name: 'meeting.vtt',
    })
  })

  it("reads Notepad's Unicode, and an older file's Western letters", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00, 0x2e, 0x00])
    expect(await readTranscriptFile(file([utf16], 'notes.txt'))).toMatchObject({
      kind: 'ok',
      text: 'Hi.',
    })
    const western = new Uint8Array([0x63, 0x61, 0x66, 0xe9])
    expect(await readTranscriptFile(file([western], 'notes.txt'))).toMatchObject({
      kind: 'ok',
      text: 'café',
    })
  })

  it('says why it reads no other file: its type, its size, or bytes that are not text', async () => {
    expect(await readTranscriptFile(file(['x'], 'notes.docx'))).toEqual({ kind: 'type' })
    expect(
      await readTranscriptFile(file([new Uint8Array(FILE_MAX_BYTES + 1)], 'notes.txt')),
    ).toEqual({ kind: 'too_big' })
    expect(
      await readTranscriptFile(file([new Uint8Array([0x50, 0x4b, 0x00, 0x03])], 'a.txt')),
    ).toEqual({ kind: 'unreadable' })
  })
})
