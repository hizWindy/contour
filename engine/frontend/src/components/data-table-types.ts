import '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // The names must match TanStack's own declaration, so the unused type parameters stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Numbers are right-aligned, in the header and in every cell. Everything else is left. */
    align?: 'left' | 'right'
    /** Extra classes for the header cell and for the cells of this column, like a width. */
    className?: string
    /** Stays in view on the left while the rest of the table scrolls sideways (the name). */
    sticky?: boolean
  }
}
