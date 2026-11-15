/**
 * A past meeting's transcript, in plain code with no screen (PLAN-V17 T3-11, "Log meeting"): how
 * long it is as the server counts it, whether the server reads it as a .vtt, whether it can go,
 * and reading a .txt or .vtt file in the browser as text. The file itself is never sent: only its
 * text, and its name, go when the rep saves.
 *
 * The transcript holds the client's words. It is only ever shown as text (React writes it so), and
 * kept in this page's memory while it waits (`log-meeting-save.ts`), never in the browser's storage.
 */

/**
 * The most the server takes, counted once a .vtt's times are out (`transcript_max_chars`, 60,000,
 * TBC). The contract doesn't say it, so this is the plan's number, and the server's 422
 * `transcript_too_long` has the last word.
 */
export const TRANSCRIPT_MAX_CHARS = 60_000

/** The most `text` itself may hold (the contract's own limit): a .vtt before its times go. */
export const TEXT_MAX_CHARS = 200_000

/** The longest file name the server takes. */
export const FILE_NAME_MAX_CHARS = 255

/**
 * A bigger file can't be a transcript under the limits, so it isn't read: 200,000 characters at
 * up to 4 bytes each.
 */
export const FILE_MAX_BYTES = 800_000

/** The files it reads, by their ending, as the server does. */
export const TEXT_FILES: readonly string[] = ['.txt', '.vtt']

/** What the file picker offers: the endings, and their types for a browser that wants them. */
export const FILE_ACCEPT = '.txt,.vtt,text/plain,text/vtt'

/** Characters, as the server counts them: one each, not one for each half of an emoji. */
function characters(text: string): number {
  let count = 0
  for (const _character of text) count += 1
  return count
}

/** The text from its first word on: spaces, line ends and a byte order mark (0xFEFF) go. */
function withoutLead(text: string): string {
  let start = 0
  while (
    start < text.length &&
    (text.charCodeAt(start) === 0xfeff || /\s/.test(text.charAt(start)))
  ) {
    start += 1
  }
  return text.slice(start)
}

/**
 * Whether the server reads it as a .vtt, and takes out the header, the cue numbers and the times:
 * by the file's name, or by its first word, as the server does.
 */
export function isVtt(text: string, fileName: string | null): boolean {
  const named = (fileName ?? '').trim().toLowerCase().endsWith('.vtt')
  return named || withoutLead(text).startsWith('WEBVTT')
}

/**
 * How long a transcript is, as the server counts it: each line end as one, the spaces at the end
 * of each line and of the whole left out.
 */
export function transcriptLength(text: string): number {
  const tidy = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
  return characters(tidy)
}

/** Whether it can go, and if not, why. */
export type TranscriptCheck =
  { kind: 'ok' } | { kind: 'empty' } | { kind: 'too_long'; length: number; max: number }

/**
 * Plain text may hold up to 60,000 characters. A .vtt's times come out on the server, so here only
 * the contract's 200,000 holds for it: the server's 422 says if its words are still too long.
 */
export function checkTranscript(text: string, fileName: string | null): TranscriptCheck {
  const length = transcriptLength(text)
  if (length === 0) return { kind: 'empty' }
  const raw = characters(text)
  if (raw > TEXT_MAX_CHARS) return { kind: 'too_long', length: raw, max: TEXT_MAX_CHARS }
  if (!isVtt(text, fileName) && length > TRANSCRIPT_MAX_CHARS) {
    return { kind: 'too_long', length, max: TRANSCRIPT_MAX_CHARS }
  }
  return { kind: 'ok' }
}

/** The count to show under the box, once it is near its limit (the last tenth), or null. */
export function nearCount(
  text: string,
  fileName: string | null,
): { length: number; max: number } | null {
  const vtt = isVtt(text, fileName)
  const length = vtt ? characters(text) : transcriptLength(text)
  const max = vtt ? TEXT_MAX_CHARS : TRANSCRIPT_MAX_CHARS
  return length >= Math.floor(max * 0.9) ? { length, max } : null
}

/** A file read, or why it wasn't. */
export type FileRead =
  | { kind: 'ok'; text: string; name: string }
  | { kind: 'type' }
  | { kind: 'too_big' }
  | { kind: 'unreadable' }

/**
 * The text of a file's bytes: UTF-16 when it starts with that mark (Notepad's "Unicode"), else
 * UTF-8, else Windows' own Western letters (an older Notepad file), so "café" stays "café".
 */
function decode(bytes: Uint8Array): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : null
  if (encoding) return new TextDecoder(encoding).decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Reads a .txt or .vtt file in the browser, as text. Nothing is uploaded: the text goes in the box,
 * and the name with it when the rep saves. A file with a zero byte in it (a Word file renamed .txt,
 * say) isn't text.
 */
export async function readTranscriptFile(file: File): Promise<FileRead> {
  const lower = file.name.trim().toLowerCase()
  if (!TEXT_FILES.some((ending) => lower.endsWith(ending))) return { kind: 'type' }
  if (file.size > FILE_MAX_BYTES) return { kind: 'too_big' }
  let text: string
  try {
    text = decode(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return { kind: 'unreadable' }
  }
  if (text.includes('\u0000')) return { kind: 'unreadable' }
  return { kind: 'ok', text, name: file.name.trim().slice(0, FILE_NAME_MAX_CHARS) }
}
