import * as React from "react"

import { cn } from "@/lib/utils"

/*
  Rows are 48px, or 40px in compact mode (<Table compact />). Headers are 14px semibold, cells
  14px regular. Numbers go right-aligned: add `text-right` to the head and the cells.
*/
function Table({
  className,
  compact = false,
  ...props
}: React.ComponentProps<"table"> & { compact?: boolean }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-density={compact ? "compact" : "comfortable"}
        className={cn("group/table w-full caption-bottom text-ui", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-semibold [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

/* A selected row gets the Navy tint and a Navy marker on its first cell. */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "h-(--row-height) border-b transition-colors group-data-[density=compact]/table:h-(--row-height-compact) hover:bg-muted/60 has-aria-expanded:bg-muted/60 data-[state=selected]:bg-selected data-[state=selected]:text-selected-foreground data-[state=selected]:[&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle text-ui font-semibold whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-caption text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
