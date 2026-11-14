---
name: ui-build
description: Build or change a screen, card, form or component in Contour's Lead Finder website (engine/frontend) the way engine/DESIGN.md says. Use for any UI change there, such as a new page, a Home card, a form, a table, motion, or empty, loading and error states.
---

# Build a screen

The rules are in `engine/DESIGN.md`. This skill is the order to work in, and the principles that matter most while building. Don't copy DESIGN.md here; read it.

## Steps

1. **Read** the DESIGN.md sections the change touches, and the plan step if there is one.
2. **Copy a pattern.** Find the nearest screen that already does something similar (the "Map" in `engine/AGENTS.md`) and follow how it's built.
3. **Use what's there:**
   - shadcn parts in `src/components/ui/`. DESIGN.md "shadcn parts" says which part fits which need.
   - The motion kit in `src/components/motion/`: `Segmented`, `ChipGroup`, `Reveal`, `RollingNumber`, `TabIndicator`, `usePress` and the springs.
   - Skeletons in `src/components/skeletons.tsx`, the error box `ErrorState`, and the error words in `src/api/words.ts`.
4. **Tokens only:** colours from the CSS variables, the 10px radius, the 8-point spacing, and Titillium Web at 400 and 600.
5. **Every state:** loading (a still skeleton after 200ms, at the real size), empty (the serif voice), error (`ErrorState` and words from `words.ts`), and done.
6. **Words:** plain, sentence case, buttons say what happens, no em dash. The `screen-words` test checks the rest.
7. **Check it:** widths 1440, 1280 and 390px; light and dark; keyboard only; reduced motion.
8. **Run** from `engine/frontend/`: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. The `design-lint` test catches banned classes, like `rounded-full`, blur and looping animation.
9. **New rule?** If the change sets a new design rule, propose it. Add it to DESIGN.md only after Al-khair agrees.

## Principles to keep in mind while building

From `design/principles/`. Each one is already a rule in DESIGN.md.

- **Explain the numbers.** A count or a chart that needs reading gets one plain sentence: what it means and where to act (05).
- **The main thing is biggest, with one main button.** Group with space and 1px dividers before adding another card (03 #7, #8, #10; 02 #15).
- **Nested corners:** a rounded box inside another takes the outer radius minus the gap (03 #14).
- **Act at once, undo after.** Actions that can be undone show the result at once, with an Undo toast. Actions that can't be undone, or that leave Contour, get a real confirmation, like Send to HubSpot (01 #6; 04 #2, #5).
- **Fields forgive.** Accept any reasonable format and store one strict form: "$1.5M", "1,500,000" and "1.5m" are the same (02 #18).
- **Fast.** No layout shift, typed searches wait about 250ms after the last key, and heavy libraries stay out of the first visit (07). See the `speed-check` skill.
