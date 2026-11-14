---
name: design-review
description: Review a screen, a component or a diff in Contour's Lead Finder website (engine/frontend) against engine/DESIGN.md and the principles in design/principles/. Use when asked to review, audit, polish or "unslop" the UI, or to fill the "In Contour" columns in design/principles/.
---

# Design review

## Steps

1. **Scope.** Name the files or the screen. For a diff, read `git diff` on `engine/frontend/`.
2. **Tests first.** From `engine/frontend/`: `npm test -- design-lint contrast screen-words icons fonts`. These prove the banned classes, contrast, the words on screen, icons and fonts. Don't re-check by eye what a test already proves.
3. **DESIGN.md's "Check before showing any screen":** go through every point.
4. **The principles,** in this order, skipping what DESIGN.md already decides:
   1. 03, unslop (the best list for screens);
   2. 02, the UX laws (13 to 20);
   3. 01, the design terms;
   4. 04, the UI tips;
   5. 05, the dashboard patterns;
   6. 07, speed (use the `speed-check` skill for measuring).
5. **Report** each finding with:
   - `file:line`;
   - what's wrong, in one sentence;
   - the rule it breaks: a DESIGN.md section or a principle, like "principles 03 #8";
   - the fix;
   - how serious it is: **Must fix** (breaks DESIGN.md or accessibility), **Should fix** (breaks a principle) or **Idea** (needs a decision, so TBC).
6. **Say what you couldn't check:** not seen in a browser, dark mode not seen, a width not tried.

## Filling the In Contour columns

- Use one status per point: **Done**, **Partly**, **To do**, **Open decision**, **Not applicable** or **TBC** (to be confirmed).
- Mark **Done** only with evidence: a `file:line`, or a DESIGN.md section plus the code that does it.
- A rule in DESIGN.md that you haven't found in the code is "**Decided in DESIGN.md.** Code not checked."
- Keep each cell short: the status, then one sentence of evidence.
- Change the notes' "Last updated" date, and the "First things to check" list in `design/principles/README.md`.

## When a principle and DESIGN.md disagree

DESIGN.md wins. Mark the point **Open decision** and say what would fit both. Example: item 05's "change pills" against DESIGN.md's "no pills". A change badge with the 10px radius fits both.
