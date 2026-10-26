/**
 * Money on the website.
 *
 * The backend sends money as Decimal strings ("12.345600"), never as numbers. This file reads and
 * adds them as whole numbers of millionths of a dollar (BigInt), so no amount is ever put through
 * a floating point number. Use these helpers for every sum, comparison and share. Do not call
 * `Number()`, `parseFloat()` or `+` on a money string.
 *
 * Costs from Claude are in US dollars (`USD`). Money from Australian data, like a rent, is in
 * Australian dollars (`AUD`). The two are never mixed, and each is shown with its own prefix:
 * `US$12.30` and `A$1,250.00`.
 *
 * The one exception is `chartNumber`, for the axis of a chart. A chart needs a number, and a
 * rounding error of a millionth is invisible there. It is named so that nobody adds with it.
 */

export type Currency = 'USD' | 'AUD'

/** Shown where an amount is missing or not a number. */
export const MONEY_UNKNOWN = 'Not known'

const SCALE = 6
const MICROS_PER_UNIT = 10n ** BigInt(SCALE)
const MAX_DIGITS = 40
const MAX_EXPONENT = 30

const PREFIX: Record<Currency, string> = { USD: 'US$', AUD: 'A$' }

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/**
 * Reads a Decimal string into millionths of a unit, or `null` when it is not a plain decimal.
 * `"12.5"` gives `12500000n`. Digits past the sixth decimal are rounded half up. An exponent
 * ("1e-3") is understood, because Python can write a very small Decimal that way.
 */
export function parseMoney(value: unknown): bigint | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = DECIMAL_PATTERN.exec(value.trim())
  if (!match) {
    return null
  }
  const sign = match[1] === '-' ? -1n : 1n
  const whole = match[2] ?? ''
  const fraction = match[3] ?? ''
  const exponent = match[4] === undefined ? 0 : Number(match[4])
  if (whole.length + fraction.length === 0 || Math.abs(exponent) > MAX_EXPONENT) {
    return null
  }
  const digitText = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
  if (digitText.length > MAX_DIGITS) {
    return null
  }
  const digits = BigInt(digitText)
  const shift = SCALE + exponent - fraction.length
  if (shift >= 0) {
    return sign * digits * pow10(shift)
  }
  const divisor = pow10(-shift)
  const quotient = digits / divisor
  const remainder = digits % divisor
  return sign * (remainder * 2n >= divisor ? quotient + 1n : quotient)
}

/** Millionths as a plain decimal string without trailing zeros: `12500000n` gives `"12.5"`. */
export function moneyToString(micros: bigint): string {
  const negative = micros < 0n
  const magnitude = negative ? -micros : micros
  const whole = magnitude / MICROS_PER_UNIT
  const fraction = (magnitude % MICROS_PER_UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '')
  const text = fraction === '' ? whole.toString() : `${whole}.${fraction}`
  return negative && magnitude !== 0n ? `-${text}` : text
}

/** Adds Decimal strings. A missing or unreadable amount counts as zero. */
export function addMoney(...values: Array<string | null | undefined>): string {
  let total = 0n
  for (const value of values) {
    total += parseMoney(value) ?? 0n
  }
  return moneyToString(total)
}

/** `a - b` for Decimal strings. A missing or unreadable amount counts as zero. */
export function subtractMoney(a: string | null | undefined, b: string | null | undefined): string {
  return moneyToString((parseMoney(a) ?? 0n) - (parseMoney(b) ?? 0n))
}

/** -1, 0 or 1. A missing or unreadable amount counts as zero. */
export function compareMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): -1 | 0 | 1 {
  const left = parseMoney(a) ?? 0n
  const right = parseMoney(b) ?? 0n
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

/**
 * `part` as a percentage of `whole`, with two decimals (`16.67`). `null` when `whole` is zero,
 * negative or unreadable. This is a ratio for a bar or a label, not an amount of money.
 */
export function moneyPercent(
  part: string | null | undefined,
  whole: string | null | undefined,
): number | null {
  const top = parseMoney(part)
  const bottom = parseMoney(whole)
  if (top === null || bottom === null || bottom <= 0n) {
    return null
  }
  return Number((top * 10000n) / bottom) / 100
}

/**
 * An amount as a JavaScript number, for the axis or the bars of a chart only. Never add, compare
 * or round money with this. Use `addMoney` and `compareMoney`.
 */
export function chartNumber(value: string | null | undefined): number {
  const micros = parseMoney(value)
  return micros === null ? 0 : Number(micros) / Number(MICROS_PER_UNIT)
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export interface FormatMoneyOptions {
  /** USD (the default) shows `US$`. AUD shows `A$`. */
  currency?: Currency
  /** Decimals to show, 0 to 6. Default 2. The amount is rounded half up. */
  decimals?: number
  /** Leaves the currency prefix off. Use it only where a column heading already says it. */
  bare?: boolean
}

/**
 * `"12.3456"` gives `US$12.35`. Rounds half up on the exact decimal, so `"0.005"` is `US$0.01`.
 * A missing or unreadable amount gives `MONEY_UNKNOWN`. A negative amount gets a leading minus
 * sign: `-US$1.20`.
 */
export function formatMoney(
  value: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const micros = parseMoney(value)
  if (micros === null) {
    return MONEY_UNKNOWN
  }
  const decimals = Math.min(SCALE, Math.max(0, Math.trunc(options.decimals ?? 2)))
  const negative = micros < 0n
  const magnitude = negative ? -micros : micros
  const step = pow10(SCALE - decimals)
  const rounded = (magnitude / step + ((magnitude % step) * 2n) / step) * step
  const whole = rounded / MICROS_PER_UNIT
  const fraction = (rounded % MICROS_PER_UNIT).toString().padStart(SCALE, '0').slice(0, decimals)
  const amount = `${groupThousands(whole.toString())}${decimals > 0 ? `.${fraction}` : ''}`
  const prefix = options.bare ? '' : PREFIX[options.currency ?? 'USD']
  return `${negative && rounded !== 0n ? '-' : ''}${prefix}${amount}`
}
