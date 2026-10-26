import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { formatMoney, type Currency } from '@/lib/money'

// `about` is the HTML (RDFa) attribute too; here it means an estimate, so the HTML one is left out.
export interface MoneyProps extends Omit<ComponentProps<'span'>, 'children' | 'about'> {
  /** A Decimal string from the backend, like "12.345600". Never a number. */
  value: string | null | undefined
  /** `USD` (default) shows `US$`. `AUD` shows `A$`. */
  currency?: Currency
  /** Decimals to show, 0 to 6. Default 2. */
  decimals?: number
  /** Puts "at least" in front. For a cost that may miss a request that was cut off. */
  atLeast?: boolean
  /** Puts "about" in front. For an estimate: an estimate has to look like one. */
  about?: boolean
}

/**
 * An amount of money with its currency: `US$12.30`, `A$1,250.00`. The digits are all one width,
 * so amounts line up in a table. Read the amount as text only. Right-align it in a table cell by
 * adding `text-right`.
 */
export function Money({
  value,
  currency = 'USD',
  decimals = 2,
  atLeast = false,
  about = false,
  className,
  ...rest
}: MoneyProps) {
  const amount = formatMoney(value, { currency, decimals })
  const prefix = atLeast ? 'at least ' : about ? 'about ' : ''
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)} {...rest}>
      {prefix}
      {amount}
    </span>
  )
}
