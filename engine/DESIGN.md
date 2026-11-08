# Design system

How the Lead Finder website looks and behaves. This file is the one to update. It started as a copy of the design system section in [PLAN-V1.md](../plan/PLAN-V1.md) (25 Oct 2026).

## Direction

- **Feel:** calm, precise and quietly premium, like Contour's own website. It's a tool for making decisions, not a showpiece.
- **Built on shadcn/ui,** with every part restyled through our tokens. Nothing ships with shadcn's default look.
- **Register:** Calm, from Khair's Brand DNA, because this is a professional data tool. We use the DNA's structure with Contour's colours. Its cut-corner signature stays out, because this is Contour's tool.
- **Dials:** design variance 3, motion 2, density 3. Density sits at the top of Calm, because tables are the content.
- **One exception:** the DNA's Calm layout is a single 960px column. A data tool needs a sidebar and wide tables, so content goes up to 1440px.

## Principles

1. **Show the work.** Every fact has a source link and a label. Every result says why, rule by rule.
2. **Always show status.** Runs show live progress and cost. Lists show when they were last updated.
3. **Prevent mistakes.** The cost shows before you run, and a preview shows before you send. Reject and Watch can be undone.
4. **Show less, reveal more.** The table comes first, then a side panel, then the full card. Advanced options stay folded away.
5. **Same thing, same look.** Each result has one badge, and each action has one place, on every page.

## Colour

Taken from Contour's website (checked 25 Oct 2026). Contour should confirm them (**TBC**).

| Role | Name | Hex | Used for |
|---|---|---|---|
| Light surface | Stone | `#E5E8DB` | The sidebar and hover. Lighter steps: `#F4F5EF` for the page, `#FBFBF8` for cards and inputs. |
| Dark surface | Ink | `#26231B` | All text, and the dark-mode background. `#5C584E` for quieter text. |
| Accent | Navy | `#233A56` | Only primary buttons, selected rows, the focus ring and live progress |
| Neutral | Sand | `#BBA087` | Chart neutrals and the Watch badge. Never text. |

| State | Name | Hex | Used for |
|---|---|---|---|
| Success | Olive | `#5F693A` | Pass |
| Warning | Ochre | `#A8742A` | Director review, and cost close to its cap |
| Danger | Terracotta | `#B4412D` | Errors, failed runs, and cost over its cap |

Olive and Terracotta come from Contour's site. Ochre is a muted step of Contour's orange.

**Rules**
- Surfaces do most of the work. Navy appears only where you act, or where something is live.
- Navy, Sand and the state colours are fills, never body text. A badge puts a dark step of its colour on a light tint of the same colour.
- Text is Ink on Stone, or Stone on Ink. All text passes 4.5:1 contrast: Ink on the page is about 14:1, quieter text about 6.5:1, and light text on Navy about 11:1.
- Form field borders use `#8F937F`, which passes 3:1, so fields are easy to see. Plain dividers can be lighter.
- One accent, Navy. No gradients.
- **Project colour:** each project may have one quiet tint, so a page shows which project it belongs to. The Lead Finder is Eucalyptus (`--lead` `#3E6E66`, tile `--lead-soft` `#E0ECE8` with `--lead-ink` `#2A4E47`). It goes only on the project's icon tiles (Home card, page titles), its icon in the menu and on its Home card. Never on buttons, text, links or status: Navy and the result colours keep those jobs. The Companies page (PLAN-V10) is Heath, a muted plum (`--companies` `#6E5470`, tile `--companies-soft` `#ECE4EC` with `--companies-ink` `#4E3A50`; **TBC**).
- **The sign-in page** (PLAN-V6) has a Navy brand panel with Contour's cream wordmark and fine contour lines. There Navy is the brand, not an action, so the panel stays Navy in dark mode too (`--brand`). In the form, Navy is still only the "Sign in" button.
- **The sign-in avatar** is an illustration of a person in a suit and glasses, in its own `--avatar-*` tokens. It is never text and never the only sign of a state.
- **Dark mode** is a choice. The site opens in light colours. The Ctrl+K menu switches to dark, or to follow your computer's setting, and the browser remembers it. In dark mode, Ink becomes the background and Stone the text. Navy steps up to `#8EA5C3`, so it stays visible.

**Results and labels**

| Result | Colour | Icon |
|---|---|---|
| Pass | Olive | Circle with a tick |
| Director review | Ochre | Person with a tick |
| Watch | Sand | Eye |
| Drop | Grey outline | Circle with a minus |

HubSpot labels (New, In HubSpot, Open deal, Dissolved deal, Possible match) use plain outline badges with an icon. Colour is saved for results.

Where a company came from (From HubSpot, Found, Typed) is a quiet mark, not a badge: an icon and a word in muted text, with a tooltip that says what it means. It sits under the name in the table and next to the result on the lead card.

## Type

- **Titillium Web** for all text, in two weights: Regular (400) and SemiBold (600). It has no 500 weight.
- **IBM Plex Serif** for three moments only: empty states, the first-run welcome, and quotes from sources (on the lead card, and the HubSpot call notes on the Companies page).
- Two typefaces in total. Fontsource serves both from the app, and text shows in a system font until they load.
- Contour's own website uses Yellix, a paid font. This tool uses Titillium Web, which is free.
- Titillium Web's digits are all the same width (checked 25 Oct 2026), so numbers line up in tables. Numbers are right-aligned and show their unit: m², $ or staff.

| Use | Size | Weight |
|---|---|---|
| Page title | 1.5rem (24px) | 600 |
| Section title | 1.125rem (18px) | 600 |
| Reading text, like the lead card summary | 1rem (16px) | 400 |
| Tables, forms and menus | 0.875rem (14px) | 400, and 600 for headers |
| Labels and captions | 0.8125rem (13px) | 400 |

Sizes are in rem, so browser zoom works. Nothing is smaller than 13px. Sentence case everywhere, with no all-caps labels.

## Space, shape and depth

- **Spacing** on an 8-point scale: 8, 16, 24, 32, 48 and 64px.
- **One radius:** 10px (shadcn's `--radius: 0.625rem`). Small parts use shadcn's smaller steps. No pills: buttons and badges are never fully round.
- **Flat surfaces,** separated by 1px borders. Only things that float, like menus and dialogs, get a soft shadow.
- **Table rows** are 48px, or 40px in compact mode, with a toggle in the table toolbar.

## Layout

- **App frame:** a left sidebar that folds to icons, a top bar with breadcrumbs, the command menu and the account menu (your initials and name, opening to your details and "Sign out"; it shows only where sign-in is on), then the page. The sidebar has Home at the top, one group per project (its name, then its pages), a "To be developed" group in quieter text (each opens a page saying what the project will do), and the shared Admin at the bottom. Folded to icons, the group names hide and the page icons stay.
- **Home:** one card per project, like a small table of contents: its name and what it does, where it stands now (for the Lead Finder: the last run with its status and cost, and the leads by result, each a link), then its pages as rows with one line on what you do there. No coloured stripes and no decorative icon tiles: colour on Home comes from the result badges, which carry meaning.
- **Width:** up to 1440px. Tables and the map can use the full width.
- **List and detail:** clicking a result opens its lead card in a side panel, so the list stays in view. Each card also has its own page and link.
- **Map page:** the map and the list sit side by side, with a divider you can drag.
- **Screens:** the site works at every width, from a phone (360px) to a wide laptop.
  - **Laptop (1024px and up):** the menu is open, and a page may use two columns.
  - **Tablet (640 to 1023px):** the menu starts folded to its icons so the page keeps the room. The cost card on Start moves under the form, with a bar at the bottom of the screen for the cost and the Start button.
  - **Phone (under 640px):** one column. The menu is a panel that slides in, and slides shut once you pick a page (a project's own row only opens or closes its list). The top bar is one line (a search icon, the breadcrumbs shorten with "..."). Admin tabs are one row that scrolls sideways. Tables show only the columns that tell rows apart (the rest are one tap away in the side panel). Results filters sit behind one Filters button that opens a sheet. The run page orders its cards: progress, cost, links, companies, events, setup.
  - **Nothing scrolls the whole page sideways at any width.** A wide table scrolls inside its own box.
- **Touch:** a phone, or any screen you tap with a finger, gets bigger controls (the `touch:` variant in `index.css`): buttons, toggles, fields and menu rows are 44px tall, and checkboxes have a larger hit area. Fields use 16px text so iPhones don't zoom in on focus. A mouse keeps the 36px sizes.

## shadcn parts

| Need | shadcn part |
|---|---|
| App frame | Sidebar, Breadcrumb |
| Jump anywhere, or run an action (Ctrl+K) | Command |
| Results table | Data Table, built on TanStack Table |
| Filters | Popover with Command for multi-select, Calendar for dates, Toggle Group |
| Lead card | Sheet, Tabs, Collapsible for the rule-by-rule reasons, Hover Card for source previews |
| Send to HubSpot | Alert Dialog, showing the preview |
| Feedback after an action | Sonner toasts, with Undo |
| Run progress | Progress, with a static live dot |
| Forms | Field, Input, Select and Checkbox, with React Hook Form and Zod |
| Charts | Chart, built on Recharts |
| Map and list split | Resizable |
| Hints | Tooltip, Kbd |

## Motion

- **One curve:** `cubic-bezier(0.4, 0, 0.2, 1)`. 150ms for small changes like hover, 250ms for panels and dialogs.
- **Leaving is quicker than arriving** (PLAN-V10, 9 Nov): a panel or dialog that closes fades (and a panel slides) out in 150ms, so closing feels instant. The call prep modal also rises 8px as it fades in, and a new person in it cross-fades in 150ms while the modal keeps its size.
- **Hover** changes the border, background or opacity. Never the size or the shadow.
- **Loading:** content fades in. No shimmer and no bouncing dots, so shadcn's Skeleton is used without its pulse. A page that is loading shows the shape of what is coming (the rows of a table, a card, a detail page, the menu and top bar of the app), still and grey, and only after 200 ms, so a quick answer never flashes grey blocks (`src/components/skeletons.tsx`, `src/shell/shell-skeleton.tsx`). The skeleton keeps the real content's size, so nothing jumps when it arrives, and a screen reader hears one line ("Loading the leads.") in a hidden status, never the grey blocks. A click on a page whose code is still on its way dims the page you are leaving after 200 ms (`aria-busy`, 150ms), the way a table dims while its next page loads.
- **A live run** shows a filling progress bar and a static dot. Nothing pulses or loops.
- **Reduced motion:** if your computer asks for it, motion turns off.
- **Second exception, waiting for an OK (TBC):** the sign-in avatar reacts to the form. Its eyes follow the login as it is typed (150ms), it shakes its head once after a wrong try (0.6s) and waves once after a sign-out (1.8s). Nothing loops, and reduced motion keeps it still (the face still changes).
- **One exception, waiting for an OK (TBC):** the sign-in page's contour lines draw once, over 1.6s, when the page opens. They never loop, and reduced motion turns them off.

## Icons

- Lucide, the set shadcn uses: outline, a 1.5px line, 16px in tables and buttons, 20px in the sidebar.
- An icon always has a label or a tooltip.

## Words on screen

- Plain words, sentence case, one idea per line. Buttons say what happens: "Start run", "Send to HubSpot", "Reject".
- Estimates look like estimates: "about 3,000 m²", with the label "estimated".
- Errors say what happened and what to do next: "HubSpot didn't answer. Nothing was sent. Try again in a minute."
- Empty states use the serif voice: "No leads yet. Start a run to see companies here."
- No em dashes, no hype, and no "AI-powered".

## Accessibility (WCAG 2.2 AA)

- Text contrast is at least 4.5:1, in light and dark mode.
- A visible 2px Navy focus ring, with a 2px gap, on everything you can tab to.
- Everything works by keyboard. Ctrl+K opens the command menu, J and K move through results, Enter opens one, and Esc closes it.
- Status is never shown by colour alone. Every badge has an icon and a word.
- Click targets are at least 24 × 24px, and buttons are 36px tall (44px on a touch screen).
- Icons and map pins have text for screen readers, and tables use real column headers.

## Banned (no AI slop)

- Gradients, glow, glassmorphism and blur.
- Pills: fully round buttons or badges.
- Sparkle icons, emoji, robot mascots, and words like "magic" or "AI-powered".
- shadcn's default look shipped as is: grey on white, the default font, untouched.
- Hover that grows or adds a shadow. Bouncing, pulsing or looping animation. Shimmer.
- A wall of big vanity numbers. Every number on screen helps a decision.
- Centred body text. Text is left-aligned, and numbers are right-aligned.
- A third typeface, or Navy as body text.
- Colour as the only signal.
- Lorem ipsum, or made-up data on real screens.

## Check before showing any screen

1. Only our tokens: the colours, Titillium Web, the 10px radius and 8-point spacing.
2. Navy only on primary actions, selection, focus and progress.
3. Every status has an icon and a word.
4. The focus ring shows, and the screen works by keyboard.
5. Text contrast is 4.5:1 or more, in light and dark mode.
6. Motion uses the one curve, and nothing loops.
7. No banned item, and no em dash anywhere, including tooltips and page titles.

## Tokens for shadcn

Phase 0 sets these as CSS variables (shadcn stores them in OKLCH). In shadcn, `--accent` means hover backgrounds, not our Navy.

| shadcn variable | Light | Dark |
|---|---|---|
| `--background` | `#F4F5EF` | `#26231B` |
| `--foreground` | `#26231B` | `#E5E8DB` |
| `--card`, `--popover` | `#FBFBF8` | `#322E25` |
| `--primary` | `#233A56` | `#8EA5C3` |
| `--primary-foreground` | `#FBFBF8` | `#26231B` |
| `--secondary`, `--muted`, `--accent` | `#E5E8DB` | `#3A362C` |
| `--muted-foreground` | `#5C584E` | `#B9BCAE` |
| `--border` | `#D3D7C6` | `#4A463B` |
| `--input` | `#8F937F` | `#7F7A6D` |
| `--ring` | `#233A56` | `#8EA5C3` |
| `--destructive` | `#B4412D` | `#D98471` |
| `--chart-1` to `--chart-5` | Navy, Olive, Sand, Ochre, Terracotta | Lighter steps of the same |
| `--sidebar` | `#E5E8DB` | `#1E1B15` |
| `--lead`, `--lead-soft`, `--lead-ink` (Lead Finder colour) | `#3E6E66`, `#E0ECE8`, `#2A4E47` | `#86B8AD`, `#263A35`, `#B5D9CF` |
| `--companies`, `--companies-soft`, `--companies-ink` (Companies colour) | `#6E5470`, `#ECE4EC`, `#4E3A50` | `#C2A8C4`, `#3A2E3B`, `#E2CFE3` |
| `--brand` (sign-in panel) | `#233A56` | `#1F344E` |
| `--brand-foreground`, `--brand-muted` | `#E5E8DB`, `#B4C0CF` | Same |
| `--radius` | `0.625rem` | Same |

