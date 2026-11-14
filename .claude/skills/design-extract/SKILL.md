---
name: design-extract
description: Add a new design reference (a screenshot, a video or an article link) to the library in design/principles/. Use when asked to extract, add or catalogue a design reference, such as a TikTok list, a dashboard shot or an article, into the principles.
---

# Add a reference to design/principles

## Steps

1. **Read the whole source.** It is a file in `design/to-extract/` or a link.
   - An image: look at it.
   - A video: pull frames into a scratch folder (`ffmpeg -i source.mp4 -vf fps=1 frame-%02d.png`). Keep 1 to 3 frames that show the point.
   - A link: fetch the page.
2. **Make the next numbered folder:** `design/principles/NN-short-name/`. Copy the original in as `source.jpg` or `source.mp4`. A link needs no copy. Frames go in `frames/`.
3. **Write `notes.md`** in the same shape as the others (03 and 07 are good models):
   - the title, and "Last updated" with the date;
   - a table: Source (creator and link), Type, File, What it is for;
   - **Extracted:** names copied word for word, "What it means" in plain words with the source's own numbers, and an "In Contour" column set to **TBC** (to be confirmed);
   - **Read with care:** anything out of date, wrong, contradicting itself, or selling a product;
   - **Takeaway:** 1 to 3 sentences.
4. **Add a row** to the index in `design/principles/README.md`.
5. **Don't change DESIGN.md yet.** If the source suggests a new rule, propose it. DESIGN.md changes only after Al-khair agrees.

Write for Contour only, in plain words (the `plain` skill).
