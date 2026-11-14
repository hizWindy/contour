# Design principles

Last updated: 14 Nov 2026

The design principles and rules of thumb for Contour's UI and UX work, one folder per source. Each folder holds the original (`source.jpg` or `source.mp4`) and a `notes.md` with:

- where it came from;
- what was extracted from it, word for word where it's a list;
- what each point means;
- how it applies to Contour, in the **In Contour** column.

The **In Contour** column says **TBC** (to be confirmed) until Contour's screens are checked against it. After the check, each point gets a status: **Done**, **Partly**, **To do**, **Open decision** or **Not applicable**.

## Index

| # | Item | Type | What it's for |
|---|---|---|---|
| 01 | [20 Design Terms You Should Know](01-design-terms/notes.md) | Screenshot, list | A shared vocabulary for asking for and reviewing design work. |
| 02 | [20 Principles of UX & Animation](02-ux-and-animation-principles/notes.md) | Screenshot, list | How things should move, and the laws behind easy screens. |
| 03 | [20 Ways to Unslop AI Designs](03-unslop-ai-designs/notes.md) | Screenshot, list | A checklist for the generic "AI-made" look. The best list for reviewing screens. |
| 04 | [20 UI tips for better design](04-ui-tips-for-better-design/notes.md) | Screenshot, list | Engineering polish that makes an app feel fast and native. |
| 05 | [Dashboard motion demo](05-dashboard-motion-demo/notes.md) | Video, 18s | A dashboard that explains itself, with motion that means something. Closest to Contour's Home. |
| 06 | [Hero and landing pages](06-hero-and-landing-pages/notes.md) | 3 contact sheets | How a landing page earns attention and trust. |
| 07 | [22 Front-End Performance Optimization Tips](07-front-end-performance/notes.md) | Web article, list | Making pages load and respond fast, with Google's speed targets. |

## How this connects

- **`engine/DESIGN.md`** is Contour's design system. On 14 Nov 2026 it took rules from items 01, 02, 03, 04, 05 and 07; each one names its source, like "(principles 03 #14)". Where this library and DESIGN.md disagree, DESIGN.md wins.
- **The `frontend-agent`** (`.claude/agents/frontend-agent.md`) builds and reviews the website from both. Its skills: `ui-build`, `design-review`, `speed-check` and `design-extract`.

## First things to check in Contour

1. **Fill the In Contour columns** from the code, with the `design-review` skill. Many points are decided in DESIGN.md but not checked in the code.
2. **Measure speed once** (07), with the `speed-check` skill, to get starting numbers.
3. **One plain sentence under the data** (05). Home has one at the top; the cards below don't.
4. **The ideas waiting for a decision** at the end of DESIGN.md: change badges, "Driven by" chips for "Why now" ([PLAN-V12](../../plan/PLAN-V12.md)), a range control, a funnel, a shared element move.

## Other images in `design/`

Not catalogued in this library yet:

- `Home, bento@2x.png`: Contour's own Home screen. This is the starting point.
- 8 dashboard shots from other products: AlignIQ (a CRM with an AI chat panel), Clinova (a hospital dashboard), SaasAble, SalesFoo, LoopAI, Pixel Mags and Financia (both dark), and a pink report dashboard with no visible name.

## Adding more

Drop new screenshots or videos into `design/to-extract/`, or share a link, and ask for them to be extracted (the `design-extract` skill). Each gets its own numbered folder here and a line in this index.
