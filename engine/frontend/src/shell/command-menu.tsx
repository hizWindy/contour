import { useCommandState } from 'cmdk'
import { Download, Moon, Monitor, PanelLeft, Search, Sun } from 'lucide-react'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
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
import { useMe } from '@/api/hooks'
import { isPlatformAdmin } from '@/auth/can'
import { PLANNED } from '@/modules'
import { install, INSTALL_STEPS, useInstallWay } from '@/pwa/install'
import { byBestMatch, pageValue } from './command-order'
import { useVisibleModules, visiblePages } from './visible-modules'
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
      value={pageValue(item)}
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
 * Each project's pages and its own actions, a group each, in the menu's order, or the best match
 * first while something is typed (`command-order.ts`). It reads what is typed from the menu itself,
 * so it is drawn inside the `Command`.
 */
function ProjectGroups({ go, run }: CommandsProps) {
  const me = useMe().data
  const modules = useVisibleModules()
  const search = useCommandState((state) => state.search)
  return byBestMatch(modules, me, search).map((app) => {
    const Commands = app.commands
    return (
      <CommandGroup key={app.id} heading={app.name}>
        {visiblePages(me, app.pages).map((item) => (
          <PageItem key={item.to} item={item} onSelect={go} />
        ))}
        {Commands ? (
          // A module's own entries may load late (the Assistant's do): nothing shows till then.
          <Suspense fallback={null}>
            <Commands go={go} run={run} />
          </Suspense>
        ) : null}
      </CommandGroup>
    )
  })
}

/**
 * Jump to any page, or run an action, from the keyboard: Ctrl+K (Cmd+K on a Mac) opens it from
 * anywhere, also while typing in a field. It lists Home, each project's pages and its own actions
 * (the Assistant's "Log a call", PLAN-V17 T3-7, PLAN-V22 T2-1), the projects still to be developed,
 * the Admin tabs, and a few actions. Only the projects this person may use are listed.
 */
export function CommandMenu(): ReactNode {
  const [open, setOpen] = useState(false)
  const me = useMe().data
  const showAdmin = isPlatformAdmin(me)
  const navigate = useNavigate()
  const { toggleSidebar } = useSidebar()
  // Install Contour as an app: the browser's own dialog, or the steps on an iPhone. Only while it
  // can still be done (Improvements 1, #9).
  const installWay = useInstallWay()

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
            <ProjectGroups go={go} run={run} />
            <CommandGroup heading="To be developed">
              {PLANNED.map(({ to, name, icon }) => (
                <PageItem key={to} item={{ to, label: name, icon }} onSelect={go} />
              ))}
            </CommandGroup>
            {showAdmin ? (
              <CommandGroup heading="Admin">
                {ADMIN_TABS.map((item) => (
                  <PageItem key={item.to} item={item} onSelect={go} />
                ))}
              </CommandGroup>
            ) : null}
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
              {installWay ? (
                <CommandItem
                  value="Install Contour as an app"
                  keywords={['app', 'home screen', 'phone', 'desktop']}
                  onSelect={() => {
                    run(() => {
                      void install()
                    })
                  }}
                >
                  <Download aria-hidden="true" />
                  <span>
                    {installWay === 'prompt' ? 'Install Contour on this device' : INSTALL_STEPS}
                  </span>
                </CommandItem>
              ) : null}
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
