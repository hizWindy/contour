# 20 Ways to Unslop AI Designs

Last updated: 14 Nov 2026

![source](source.jpg)

| | |
|---|---|
| Source | TikTok, Charles Liu (caption: "Helping unslop the internet one day at a time") |
| Type | Screenshot of a video, one list of 20 fixes |
| File | `source.jpg` |
| What it is for | A checklist for spotting and fixing the generic "AI-made" look. The most useful of these for reviewing screens. |

## Extracted

Names copied exactly from the screenshot; the rest is added. **TBC** (to be confirmed) means not checked against Contour yet. **Decided in DESIGN.md** means `engine/DESIGN.md` sets it, but the code is not checked yet.

| # | Fix | What it means | In Contour |
|---|---|---|---|
| 1 | Delete filler badges | Remove pills and tags that say nothing. | **TBC** |
| 2 | Drop redundant labels | Don't say the same thing twice. | **TBC** |
| 3 | Unitalicize random words | No italics for decoration. | **TBC** |
| 4 | Mono only where needed | Monospace for codes and references, not for style. | **TBC** |
| 5 | Use a design system | One set of tokens and components. | **TBC** |
| 6 | Show the actual product | Real screens, not stock photos or vague art. | **TBC** |
| 7 | Enlarge the main feature | Make the most important thing the biggest. | **TBC** |
| 8 | Group with spacing | Use space and hairlines, not a box around everything. | **TBC.** The Home draft image (`design/Home, bento@2x.png`) has a large gap in the Lead Finder card. DESIGN.md fills that space with "Start with these" (the three best new leads). Check the live page. |
| 9 | Make headlines specific | Say exactly what it is, not "Unlock your potential". | **TBC** |
| 10 | Emphasize the CTA | The one action you want is unmistakable. | **TBC** |
| 11 | Add an accent colour | One colour that marks what matters. | **TBC** |
| 12 | Keep icons consistent | One icon family, one stroke weight. | **Decided in DESIGN.md.** One family: Lucide, 1.5px line. The tile colours are on purpose: each project has its own tint (Eucalyptus for the Lead Finder, Heath for Companies, Stone for Runs and cost). |
| 13 | Remove embellishments | Drop decoration that adds nothing. | **Decided in DESIGN.md.** The faint contour lines behind Home's greeting are kept on purpose, from a tablet up, as the one decoration. |
| 14 | Inner radius = outer − padding | A rounded box inside a rounded box needs a smaller radius. | **TBC** |
| 15 | Improve text contrast | Small text must be readable. | **TBC** |
| 16 | Wrap headlines properly | No lone word on the last line. | **TBC** |
| 17 | Align by eye, not pixels | Optical alignment beats the grid when they disagree. | **TBC** |
| 18 | Use tabular nums | Same-width digits. | **TBC** |
| 19 | Add loading states | Never a blank screen while waiting. | **TBC** |
| 20 | Animate useful feedback | Motion that tells you something happened. | **TBC** |

## Takeaway

This is the best list for reviewing screens. Items 1, 2, 3, 7, 8, 9, 10 and 14 are now rules in `engine/DESIGN.md` (14 Nov 2026). The `design-review` skill checks them in the code.
