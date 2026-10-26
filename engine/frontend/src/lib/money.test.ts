import { describe, expect, it } from 'vitest'
import {
  addMoney,
  chartNumber,
  compareMoney,
  formatMoney,
  MONEY_UNKNOWN,
  moneyPercent,
  moneyToString,
  parseMoney,
  subtractMoney,
} from './money'

describe('parseMoney', () => {
  it('reads Decimal strings as millionths', () => {
    expect(parseMoney('12.5')).toBe(12_500_000n)
    expect(parseMoney('12.345600')).toBe(12_345_600n)
    expect(parseMoney('0')).toBe(0n)
    expect(parseMoney('-1.25')).toBe(-1_250_000n)
    expect(parseMoney('.5')).toBe(500_000n)
    expect(parseMoney('7.')).toBe(7_000_000n)
    expect(parseMoney('  3.10 ')).toBe(3_100_000n)
  })

  it('rounds digits past the sixth decimal half up', () => {
    expect(parseMoney('0.0000004')).toBe(0n)
    expect(parseMoney('0.0000005')).toBe(1n)
    expect(parseMoney('-0.0000005')).toBe(-1n)
  })

  it('understands an exponent, which Python writes for a very small Decimal', () => {
    expect(parseMoney('1e-3')).toBe(1_000n)
    expect(parseMoney('2.5E+2')).toBe(250_000_000n)
  })

  it('gives null for anything that is not a plain decimal', () => {
    for (const bad of [
      '',
      '.',
      '-',
      'abc',
      '1,000',
      '1.2.3',
      '12 USD',
      'NaN',
      'Infinity',
      '1e99',
    ]) {
      expect(parseMoney(bad), bad).toBeNull()
    }
    expect(parseMoney(12.5)).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
  })

  it('refuses an absurdly long number instead of building a huge BigInt', () => {
    expect(parseMoney('9'.repeat(60))).toBeNull()
  })
})

describe('sums without floating point', () => {
  it('adds the amounts that floating point gets wrong', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addMoney('0.1', '0.2')).toBe('0.3')
    expect(addMoney('0.1', '0.7', '0.2')).toBe('1')
  })

  it('adds many small costs exactly', () => {
    const costs = Array.from({ length: 1000 }, () => '0.001')
    expect(addMoney(...costs)).toBe('1')
  })

  it('counts a missing or unreadable amount as zero', () => {
    expect(addMoney('1.5', null, undefined, 'x')).toBe('1.5')
    expect(addMoney()).toBe('0')
  })

  it('subtracts and writes a negative result with a minus sign', () => {
    expect(subtractMoney('20', '3.2')).toBe('16.8')
    expect(subtractMoney('1', '2.5')).toBe('-1.5')
    expect(subtractMoney('1', '1')).toBe('0')
  })

  it('compares', () => {
    expect(compareMoney('1.10', '1.1')).toBe(0)
    expect(compareMoney('1.09', '1.1')).toBe(-1)
    expect(compareMoney('10', '9.999999')).toBe(1)
    expect(compareMoney(null, '0')).toBe(0)
  })

  it('writes millionths back as a plain decimal', () => {
    expect(moneyToString(12_345_600n)).toBe('12.3456')
    expect(moneyToString(0n)).toBe('0')
    expect(moneyToString(-500_000n)).toBe('-0.5')
    expect(moneyToString(1n)).toBe('0.000001')
  })
})

describe('moneyPercent', () => {
  it('gives a share with two decimals', () => {
    expect(moneyPercent('1', '3')).toBe(33.33)
    expect(moneyPercent('16', '20')).toBe(80)
    expect(moneyPercent('25', '20')).toBe(125)
  })

  it('gives null when there is nothing to divide by', () => {
    expect(moneyPercent('1', '0')).toBeNull()
    expect(moneyPercent('1', '-5')).toBeNull()
    expect(moneyPercent('1', null)).toBeNull()
    expect(moneyPercent('x', '5')).toBeNull()
  })
})

describe('formatMoney', () => {
  it('shows US dollars with the US$ prefix and two decimals by default', () => {
    expect(formatMoney('12.3')).toBe('US$12.30')
    expect(formatMoney('0')).toBe('US$0.00')
    expect(formatMoney('20.000000')).toBe('US$20.00')
  })

  it('shows Australian dollars with the A$ prefix', () => {
    expect(formatMoney('1250', { currency: 'AUD' })).toBe('A$1,250.00')
    expect(formatMoney('1234567.891', { currency: 'AUD', decimals: 0 })).toBe('A$1,234,568')
  })

  it('rounds half up on the exact decimal', () => {
    expect(formatMoney('0.005')).toBe('US$0.01')
    expect(formatMoney('0.004999')).toBe('US$0.00')
    expect(formatMoney('1.005')).toBe('US$1.01')
    expect(formatMoney('2.675')).toBe('US$2.68')
    expect(formatMoney('0.999999')).toBe('US$1.00')
  })

  it('shows more decimals where a small cost needs them', () => {
    expect(formatMoney('0.012345', { decimals: 4 })).toBe('US$0.0123')
    expect(formatMoney('0.012345', { decimals: 6 })).toBe('US$0.012345')
  })

  it('groups thousands', () => {
    expect(formatMoney('1234567.5')).toBe('US$1,234,567.50')
    expect(formatMoney('999.999')).toBe('US$1,000.00')
  })

  it('writes a negative amount with a leading minus and never as negative zero', () => {
    expect(formatMoney('-1.2')).toBe('-US$1.20')
    expect(formatMoney('-0.001')).toBe('US$0.00')
  })

  it('can leave the prefix off for a column that says the currency in its heading', () => {
    expect(formatMoney('3.5', { bare: true })).toBe('3.50')
  })

  it('says so when the amount is missing or not a number', () => {
    expect(formatMoney(null)).toBe(MONEY_UNKNOWN)
    expect(formatMoney(undefined)).toBe(MONEY_UNKNOWN)
    expect(formatMoney('abc')).toBe(MONEY_UNKNOWN)
  })
})

describe('chartNumber', () => {
  it('turns a Decimal into a number for a chart axis', () => {
    expect(chartNumber('12.5')).toBe(12.5)
    expect(chartNumber('0.000001')).toBe(0.000001)
    expect(chartNumber(null)).toBe(0)
    expect(chartNumber('x')).toBe(0)
  })
})
