import { Moon, Monitor, PanelLeft, Search, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { useSidebar } from '@/components/ui/sidebar'
import { PLANNED } from '@/modules'
import { useVisibleModules } from './visible-modules'
import { ADMIN_TABS, HOME, type CommandsProps, type NavItem } from './nav'
import { applyTheme, type ThemeChoice } from './theme'

/** True for Ctrl+K, or Cmd+K on a Mac. */
function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
}

interface ThemeAction {
  choice: ThemeChoice
  label: string
  icon: typeof Sun
}

const THEME_ACTIONS: readonly ThemeAction[] = [
  { choice: 'light', label: 'Use light colours', icon: Sun },
  { choice: 'dark', label: 'Use dark colours', icon: Moon },
  { choice: 'system', label: "Follow the computer's colours", icon: Monitor },
]

function PageItem({ item, onSelect }: { item: NavItem; onSelect: (to: string) => void }) {
  const Icon = item.icon
  return (
    <CommandItem
      value={`${item.label} ${item.to}`}
      keywords={item.keywords}
      onSelect={() => {
        onSelect(item.to)
      }}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </CommandItem>
  )
}

/**
 * Jump to any page, or run an action, from the keyboard: Ctrl+K (Cmd+K on a Mac) opens it from
 * anywhere, also while typing in a field. It lists Home, each project's pages and its own actions
 * (Companies' "Log a call", PLAN-V17 T3-7), the projects still to be developed, the Admin tabs, and
 * a few actions. Only the projects this person may use are listed.
 */
export function CommandMenu(): ReactNode {
  const [open, setOpen] = useState(false)
  const modules = useVisibleModules()
  const navigate = useNavigate()
  const { toggleSidebar } = useSidebar()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isOpenShortcut(event)) {
        event.preventDefault() // the browser's own Ctrl+K (a search box) stays out of the way
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const run = (action: () => void): void => {
    setOpen(false)
    action()
  }
  // As it closes, the menu puts the focus back nowhere (Radix's dialog returns it only to its own
  // trigger, and this one has none), so a page that takes the focus keeps it: Log a call's picker.
  const go: CommandsProps['go'] = (to) => {
    run(() => {
      void navigate(to)
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        // On a phone it is a search icon: the words and the keys would crowd the bar. A touch
        // screen has no Ctrl key, so the keys go there too.
        className="gap-2 text-muted-foreground max-sm:w-10 max-sm:px-0"
        onClick={() => {
          setOpen(true)
        }}
      >
        <Search aria-hidden="true" />
        <span className="max-sm:sr-only">Go to a page</span>
        <KbdGroup className="ml-2 touch:hidden" aria-hidden="true">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Go to a page"
        description="Type a page name or an action, then press Enter."
      >
        {/* This CommandDialog does not add the <Command> that holds cmdk's state, so it is here. */}
        <Command>
          <CommandInput placeholder="Type a page or an action" />
          <CommandList>
            <CommandEmpty>Nothing matches. Try another word.</CommandEmpty>
            <CommandGroup heading="Pages">
              <PageItem item={HOME} onSelect={go} />
            </CommandGroup>
            {modules.map((app) => {
              const Commands = app.commands
              return (
                <CommandGroup key={app.id} heading={app.name}>
                  {app.pages.map((item) => (
                    <PageItem key={item.to} item={item} onSelect={go} />
                  ))}
                  {Commands ? <Commands go={go} /> : null}
                </CommandGroup>
              )
            })}
            <CommandGroup heading="To be developed">
              {PLANNED.map(({ to, name, icon }) => (
                <PageItem key={to} item={{ to, label: name, icon }} onSelect={go} />
              ))}
            </CommandGroup>
            <CommandGroup heading="Admin">
              {ADMIN_TABS.map((item) => (
                <PageItem key={item.to} item={item} onSelect={go} />
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                value="Show or hide the menu"
                keywords={['sidebar']}
                onSelect={() => {
                  run(toggleSidebar)
                }}
              >
                <PanelLeft aria-hidden="true" />
                <span>Show or hide the menu</span>
              </CommandItem>
              {THEME_ACTIONS.map(({ choice, label, icon: Icon }) => (
                <CommandItem
                  key={choice}
                  value={label}
                  keywords={['theme', 'dark mode', 'light mode']}
                  onSelect={() => {
                    run(() => {
                      applyTheme(choice)
                    })
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
