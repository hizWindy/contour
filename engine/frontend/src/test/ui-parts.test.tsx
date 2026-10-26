import { zodResolver } from '@hookform/resolvers/zod'
import { screen, waitFor, within } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { Bar, BarChart, XAxis } from 'recharts'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { renderWithProviders } from './render'

/*
  Every shadcn part is rendered once, and opened or used where it has a state. This proves the
  parts work under jsdom with the polyfills in setup.ts, and that nobody has to install anything
  or fix a generated part later.
*/

describe('cn', () => {
  it('joins classes and resolves Tailwind conflicts, including our own names', () => {
    expect(cn('p-2', false, 'p-4')).toBe('p-4')
    expect(cn('text-ui', 'text-title')).toBe('text-title')
    expect(cn('text-ui', 'text-muted-foreground')).toBe('text-ui text-muted-foreground')
    expect(cn('shadow-float', 'shadow-none')).toBe('shadow-none')
    expect(cn('rounded-lg', 'rounded-md')).toBe('rounded-md')
  })
})

describe('simple parts', () => {
  it('render with the right roles and states', async () => {
    const { user } = renderWithProviders(
      <div>
        <Button>Start run</Button>
        <Badge variant="pass">Pass</Badge>
        <Label htmlFor="name">Company name</Label>
        <Input id="name" placeholder="Sample Pty Ltd" />
        <Textarea aria-label="Reason" />
        <Checkbox aria-label="Include inner suburbs" />
        <Switch aria-label="Compact rows" />
        <Progress value={40} aria-label="Run progress" />
        <Skeleton data-testid="skeleton" />
        <Kbd>K</Kbd>
        <Separator />
        <Card>
          <CardHeader>
            <CardTitle>Lead card</CardTitle>
            <CardDescription>Why it passed.</CardDescription>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
        <ScrollArea className="h-10">
          <p>Scrollable</p>
        </ScrollArea>
      </div>,
    )

    expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled()
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.getByLabelText('Company name')).toHaveAttribute('placeholder', 'Sample Pty Ltd')
    expect(screen.getByRole('progressbar', { name: 'Run progress' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    )
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')

    const checkbox = screen.getByRole('checkbox', { name: 'Include inner suburbs' })
    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    const toggle = screen.getByRole('switch', { name: 'Compact rows' })
    await user.click(toggle)
    expect(toggle).toBeChecked()

    await user.type(screen.getByLabelText('Reason'), 'Too small')
    expect(screen.getByLabelText('Reason')).toHaveValue('Too small')
  })

  it('has no pulse on the skeleton and no pill on the badge, switch and progress', () => {
    renderWithProviders(
      <div>
        <Skeleton data-testid="skeleton" />
        <Badge data-testid="badge">New</Badge>
        <Switch data-testid="switch" />
        <Progress data-testid="progress" value={10} />
      </div>,
    )

    for (const id of ['skeleton', 'badge', 'switch', 'progress']) {
      const classes = screen.getByTestId(id).className
      expect(classes, id).not.toMatch(/animate-|rounded-full/)
    }
  })

  it('shows table rows with a compact density option', () => {
    renderWithProviders(
      <Table compact>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-state="selected">
            <TableCell>Sample Alpha</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    expect(screen.getByRole('table')).toHaveAttribute('data-density', 'compact')
    expect(screen.getByRole('columnheader', { name: 'Company' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'Sample Alpha' })).toHaveAttribute(
      'data-state',
      'selected',
    )
  })

  it('renders a breadcrumb with the current page marked', () => {
    renderWithProviders(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/results">Results</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Sample Beta</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )

    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sample Beta' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('parts with state', () => {
  it('Tabs switch panels', async () => {
    const { user } = renderWithProviders(
      <Tabs defaultValue="facts">
        <TabsList>
          <TabsTrigger value="facts">Facts</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="facts">Facts panel</TabsContent>
        <TabsContent value="rules">Rules panel</TabsContent>
      </Tabs>,
    )

    expect(screen.getByText('Facts panel')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Rules' }))
    expect(screen.getByText('Rules panel')).toBeVisible()
  })

  it('ToggleGroup selects several values', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <ToggleGroup type="multiple" onValueChange={onChange} aria-label="Result">
        <ToggleGroupItem value="pass">Pass</ToggleGroupItem>
        <ToggleGroupItem value="watch">Watch</ToggleGroupItem>
      </ToggleGroup>,
    )

    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.click(screen.getByRole('button', { name: 'Watch' }))

    expect(onChange).toHaveBeenLastCalledWith(['pass', 'watch'])
    expect(screen.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Collapsible shows and hides its content', async () => {
    const { user } = renderWithProviders(
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button>Rule 1</Button>
        </CollapsibleTrigger>
        <CollapsibleContent>100 or more staff.</CollapsibleContent>
      </Collapsible>,
    )

    expect(screen.queryByText('100 or more staff.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rule 1' }))
    expect(screen.getByText('100 or more staff.')).toBeInTheDocument()
  })

  it('Select opens and picks an option', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <Select onValueChange={onChange}>
        <SelectTrigger aria-label="Period">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7">Last 7 days</SelectItem>
          <SelectItem value="30">Last 30 days</SelectItem>
        </SelectContent>
      </Select>,
    )

    await user.click(screen.getByRole('combobox', { name: 'Period' }))
    await user.click(await screen.findByRole('option', { name: 'Last 30 days' }))

    expect(onChange).toHaveBeenCalledWith('30')
  })

  it('Dialog opens, shows its title and closes on Escape', async () => {
    const { user } = renderWithProviders(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Reject</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this lead</DialogTitle>
            <DialogDescription>Say why.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByRole('dialog', { name: 'Reject this lead' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('AlertDialog asks first, and its action and cancel work', async () => {
    const onSend = vi.fn()
    const { user } = renderWithProviders(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Send to HubSpot</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this company?</AlertDialogTitle>
            <AlertDialogDescription>One company and one deal.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSend}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    await user.click(screen.getByRole('button', { name: 'Send to HubSpot' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Send this company?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Sheet opens as a dialog panel', async () => {
    const { user } = renderWithProviders(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Open card</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Sample Beta</SheetTitle>
            <SheetDescription>Lead card</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    )

    await user.click(screen.getByRole('button', { name: 'Open card' }))

    expect(await screen.findByRole('dialog', { name: 'Sample Beta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('DropdownMenu and Popover open', async () => {
    const onWatch = vi.fn()
    const { user } = renderWithProviders(
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onWatch}>Watch</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Filters</Button>
          </PopoverTrigger>
          <PopoverContent>Filter body</PopoverContent>
        </Popover>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Watch' }))
    expect(onWatch).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByText('Filter body')).toBeInTheDocument()
  })

  it('Tooltip and HoverCard show on hover', async () => {
    const { user } = renderWithProviders(
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>Copy link</Button>
          </TooltipTrigger>
          <TooltipContent>Copies the link</TooltipContent>
        </Tooltip>
        <HoverCard openDelay={0}>
          <HoverCardTrigger asChild>
            <a href="https://example.com">Source</a>
          </HoverCardTrigger>
          <HoverCardContent>Source preview</HoverCardContent>
        </HoverCard>
      </div>,
    )

    await user.hover(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copies the link')

    await user.hover(screen.getByRole('link', { name: 'Source' }))
    expect(await screen.findByText('Source preview')).toBeInTheDocument()
  })

  it('Command filters its items', async () => {
    const { user } = renderWithProviders(
      <Command>
        <CommandInput placeholder="Jump to..." />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Pages">
            <CommandItem>Results</CommandItem>
            <CommandItem>Start a run</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    await user.type(screen.getByPlaceholderText('Jump to...'), 'start')

    expect(screen.getByText('Start a run')).toBeInTheDocument()
    expect(screen.queryByText('Results')).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('Jump to...'))
    await user.type(screen.getByPlaceholderText('Jump to...'), 'zzz')
    expect(await screen.findByText('No results.')).toBeInTheDocument()
  })

  it('Calendar shows a month and picks a day', async () => {
    const onSelect = vi.fn()
    const { user } = renderWithProviders(
      <Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} onSelect={onSelect} />,
    )

    expect(screen.getByRole('grid')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /October 15th, 2026/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('Sidebar renders its menu and collapses', async () => {
    const { user } = renderWithProviders(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Results">
                  <span>Results</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    )

    const sidebar = document.querySelector('[data-slot="sidebar"][data-state]')
    expect(sidebar).toHaveAttribute('data-state', 'expanded')
    expect(screen.getByRole('button', { name: 'Results' })).toHaveAttribute('data-active', 'true')

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  })

  it('Resizable renders a focusable divider', () => {
    renderWithProviders(
      <ResizablePanelGroup orientation="horizontal" style={{ width: 400, height: 100 }}>
        <ResizablePanel defaultSize={50}>List</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}>Map</ResizablePanel>
      </ResizablePanelGroup>,
    )

    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(screen.getByText('List')).toBeInTheDocument()
  })
})

describe('Sonner toasts', () => {
  it('shows a toast with an Undo button', async () => {
    const onUndo = vi.fn()
    const { user } = renderWithProviders(<p>Page</p>)

    toast('Lead rejected', { action: { label: 'Undo', onClick: onUndo } })

    expect(await screen.findByText('Lead rejected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})

describe('Chart', () => {
  it('writes one colour variable per series, as plain text, and renders without a size', () => {
    const config = {
      runs: { label: 'Runs', color: 'var(--chart-1)' },
      cost: { label: 'Cost', theme: { light: 'var(--chart-2)', dark: 'var(--chart-4)' } },
    } satisfies ChartConfig

    const { container } = renderWithProviders(
      <ChartContainer config={config} id="test">
        <BarChart data={[{ month: 'Jan', runs: 3 }]}>
          <XAxis dataKey="month" />
          <Bar dataKey="runs" fill="var(--color-runs)" />
        </BarChart>
      </ChartContainer>,
    )

    const style = container.querySelector('style')
    expect(style?.textContent).toContain('[data-chart=chart-test]')
    expect(style?.textContent).toContain('--color-runs: var(--chart-1);')
    expect(style?.textContent).toContain(
      '--color-cost: light-dark(var(--chart-2), var(--chart-4));',
    )
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument()
  })
})

describe('Field and Form with React Hook Form and zod', () => {
  it('Field shows a label, a description and an error', () => {
    renderWithProviders(
      <Field data-invalid="true">
        <FieldLabel htmlFor="staff">Staff</FieldLabel>
        <Input id="staff" aria-invalid="true" />
        <FieldDescription>How many people work there.</FieldDescription>
        <FieldError>Enter a number.</FieldError>
      </Field>,
    )

    expect(screen.getByLabelText('Staff')).toBeInvalid()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.')
  })

  const schema = z.object({ city: z.string().min(2, 'Enter a city.') })

  function CityForm({ onValid }: { onValid: (values: z.infer<typeof schema>) => void }) {
    const form = useForm<z.infer<typeof schema>>({
      resolver: zodResolver(schema),
      defaultValues: { city: '' },
    })
    return (
      <Form {...form}>
        <form onSubmit={(event) => void form.handleSubmit(onValid)(event)}>
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormDescription>Where to look.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Save</Button>
        </form>
      </Form>
    )
  }

  it('Form links label, description and error to the field, and validates with zod', async () => {
    const onValid = vi.fn()
    const { user } = renderWithProviders(<CityForm onValid={onValid} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const input = screen.getByLabelText('City')
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a city.')
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription(/Where to look\.\s*Enter a city\./)
    expect(onValid).not.toHaveBeenCalled()

    await user.type(input, 'Perth')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1))
    expect(onValid.mock.calls[0]?.[0]).toEqual({ city: 'Perth' })
    expect(within(document.body).queryByRole('alert')).not.toBeInTheDocument()
  })
})
