# 20 UI tips to send to Claude for better design

Last updated: 14 Nov 2026

![source](source.jpg)

| | |
|---|---|
| Source | A short video; the creator's name is not on the screenshot |
| Type | Screenshot of a video, one list of 20 tips, with a demo of item 20 |
| File | `source.jpg` |
| What it is for | Engineering-side polish: the behaviours that make an app feel fast and native, many of them invisible until they're missing. |

The caption on screen reads "Screenshot this list and paste it into Claude". The demo card shows item 20: a category menu (Electronics, Books, Home, Toys, Fashion) with a shaded triangle between the hovered item and its panel.

## Extracted

Names copied exactly from the screenshot; the rest is added. **TBC** (to be confirmed) means not checked against Contour yet.

| # | Tip | What it means | In Contour |
|---|---|---|---|
| 1 | Skeleton loaders | Grey shapes of the content while it loads. | **TBC** |
| 2 | Optimistic updates | Show the change at once, roll back if it fails. | **TBC** |
| 3 | Command menu | Ctrl+K to search and jump anywhere. | **Decided in DESIGN.md.** Ctrl+K opens the command menu (shadcn's Command). Code not checked. |
| 4 | Shortcut hints | Show the key next to the action ("/" to search). | **Decided in DESIGN.md.** Hints use Tooltip and Kbd; the search box shows Ctrl K. Code not checked. |
| 5 | Undo toasts | "Done. Undo" instead of "Are you sure?" for actions that can be undone. Actions that can't be undone still need a real confirmation. | **TBC** |
| 6 | Stale-while-revalidate | Show cached data at once, refresh it quietly. | **TBC** |
| 7 | Pre-rendering | Pages ready before you click. | **TBC** |
| 8 | BlurHash placeholders | A blurred preview while an image loads. | **TBC** |
| 9 | View transitions | Animated page changes. | **TBC** |
| 10 | Swipe-to-dismiss sheets | Drag a sheet down to close it. | **TBC** |
| 11 | Interruptible animations | Change course mid-way without snapping. | **TBC** |
| 12 | Predictive back | Android's back gesture previews where it goes. | **TBC** |
| 13 | Hit slop | Tappable area bigger than the visible element. | **TBC** |
| 14 | Safe area insets | Room for the notch and home bar. | **TBC** |
| 15 | One-time code autofill | The phone fills the SMS code by itself. | **TBC** |
| 16 | Tabular numbers | Same-width digits. | **TBC** |
| 17 | Balanced headlines | Even line lengths in headings. | **TBC** |
| 18 | Continuous corners | Smooth "squircle" corners like iOS icons. CSS `corner-shape: squircle` works in newer Chromium browsers; others keep plain rounded corners. | **TBC** |
| 19 | Idempotency keys | A retried request can't run twice, for example a charge. | **TBC** |
| 20 | Amazon safe triangle | Moving the pointer diagonally to a sub-menu doesn't close it. Only needed with fly-out sub-menus. | **TBC** |

## Takeaway

Most of these are invisible until they're missing. Check them after the visual review.
