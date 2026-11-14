# Dashboard motion demo (uxerflow)

Last updated: 14 Nov 2026

| | |
|---|---|
| Source | TikTok, @uxerflow (the handle on the watermark and end card) |
| Type | Video, 18 seconds, 768 by 576, with sound |
| Files | `source.mp4`; three stills in `frames/` |
| What it is for | How a data-heavy dashboard can feel premium through motion and plain-language insight, not decoration. The closest of these to Contour's Home. |

## What happens, second by second

| Time | What you see |
|---|---|
| 0 to 1s | An empty card rises out of a soft green gradient. |
| 1 to 3s | The dashboard fills in: sidebar, KPI row, charts. |
| 3 to 5s | The camera moves in. The pointer hovers a bar in the Sales chart and a dark tooltip shows that month's value for each series. ![tooltip](frames/1-chart-tooltip.png) |
| 5 to 8s | The pointer clicks "Stage Pipeline". The bar chart turns into a flowing funnel (Prospecting, Qualification, Proposal, Negotiation), each stage with its value and average days. A green callout appears underneath in plain words: the proposal stage is where revenue leaks. ![pipeline](frames/2-stage-pipeline.png) |
| 8 to 11s | In the sidebar a folder opens into a tree (Programs, then Oil & Gas, then its items), with the chevrons turning. ![sidebar](frames/3-sidebar-tree.png) |
| 11 to 14s | The camera pulls back to the whole dashboard. |
| 14 to 18s | TikTok end card. |

## Patterns on screen

1. **KPI row with change pills.** Big number, small label, a green or red pill with the change "vs last 12M".
2. **Time range as a segmented control.** 1M, 6M, 12M, YTD on each chart.
3. **Two views of the same data in one card.** "Historical Overview" and "Stage Pipeline" toggle in place; the chart morphs instead of the page changing.
4. **A funnel with time per stage.** Where people drop off and how long they sit there.
5. **An insight in plain words under the chart.** It names the problem and the numbers, so nobody has to read the chart to know what to do.
6. **A gauge with reasons.** "Pipeline health 62%", a "Caution!" note, and "Driven by" chips naming the causes.
7. **A dark tooltip** listing each series for the hovered point.
8. **A collapsible nested sidebar** with section counts.
9. **An upgrade nudge** in the sidebar ("5 Days left!" with a progress line).

## Where it could fit in Contour

All of these are **TBC** (to be confirmed). They come from a first look at the Home screen image (`design/Home, bento@2x.png`), not from the code.

| Pattern | Where it could go | Note |
|---|---|---|
| Insight in plain words (5) | Home, lead cards | Home already has one sentence at the top: "9 leads are worth a look. Today's run checked 4 companies in Perth and added 1 to watch." The cards below don't have one. |
| "Driven by" chips (6) | Lead cards | Fits the "Why now" section in [PLAN-V12](../../../plan/PLAN-V12.md). |
| Change pills on KPIs (1) | Home numbers: leads, companies, cost | For example "+3 vs last run". |
| Time range control (2) | Home's "Runs and cost" chart | |
| Funnel with time per stage (4) | Lead Finder results | Only fits if leads move through stages over time, like found, called, meeting. Today Home shows one split of 59 found (2 pass, 7 director review, 44 watch, 6 drop) as a single bar. Whether stage dates are stored is TBC. |

The upgrade nudge (9) doesn't apply: Contour is an internal tool.

**Take the patterns, not the look:** their orange, purple and blue palette and their exact layout are their design. Contour keeps its own colours.

## Takeaway

What makes this feel premium isn't the charts. It's that the dashboard explains itself: one plain sentence under the data says what's wrong and where. That's the idea to bring into Contour first.
