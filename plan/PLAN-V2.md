# Lead Finder plan, version 2: the new company criteria

This plan makes the Lead Finder follow the new company criteria in [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md). They come from Levi's three new documents, his 29 Oct email, his Gold customers and the recent meetings.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-10-30. **TBC** means not confirmed yet.
- **Progress:** 2 of 20 steps done.
- **Before this:** [PLAN-V1.md](PLAN-V1.md) built the engine and the website (Phases 0 to 4). They follow [Criteria_v1.md](../projects/leads/criteria/Criteria_v1.md). Phase 5, sending leads to HubSpot, is not started and stays in PLAN-V1.

## In short

- **What changes:** the engine moves from criteria version 1 to version 2. Staff counts become a hint. The office matters more than the industry. There are new triggers, an office-age check and a new 100-point score in 6 parts.
- **The gate:** version 2 is a draft, and every new rule is **TBC** with Levi. Criteria_v2.md says the live rules change only after he confirms. So the work stays on the branch `engine-criteria-v2`, and `master` doesn't change until E2.
- **Order:** get ready (A), change one rule at a time (B), update the website (C), test on real cases (D), go live after Levi confirms (E).
- **Cost:** everything is free except the test set in D2, which costs about US$12.

## How to work this plan

These rules are for Al-khair and for Claude. At the start of every session: read this section, find the first step that isn't ticked, and run `brain context`. The AI Brain is the local notes vault that the `brain` command searches.

### Mark progress as you go

- A step is done when its "Done when" is true. For code, that means the tests pass. For a website step, it also means you looked at the page in the browser.
- Tick the box in the same turn the step is done, before you start the next one. Add the date and the commit to the step's title line, like this: `- [x] **B1. Size.** Done 2026-11-03, abc1234.`
- Then update **Progress** and **Last updated** at the top, and add a line to the log at the bottom.
- Half done? Leave the box empty. Write "Done so far:" and "Left:" under the step.
- Blocked? Write "Blocked:" and why. Then take the next step that isn't blocked.
- Step changed or dropped? Say why in one line. Don't delete it.
- Ticked a step that turns out to be wrong? Untick it and say why.

### Watch the usage

Claude's usage is the main risk. A session that stops in the middle of a step leaves the next one starting cold.

- Check usage at the start of each step, and before anything long, like a paid test run. In the Claude desktop app, the `get_usage` tool shows the 5-hour limit, the weekly limit and how full this session is. The app's usage card shows the two limits too.
- At **80%** on either limit, or when the session is over 80% full: save now (below), then carry on in small steps.
- At **95%**: start no new step. Finish the small thing you are on, tick what is done, save, and write what comes next.
- Both numbers are our guess (**TBC**). Al-khair can change them. If you can't read the usage, save at the end of every Part instead.

**What to save**

1. **In this plan:** the ticks, any "Done so far" notes, and a line in the log.
2. **In the AI Brain:** run the `brain-save` skill. Give it the step you were on, the next step, the branch and last commit, the decisions with their reasons, anything surprising, and Levi's answers.
3. **Almost no room left?** Save one line and stop: `brain inbox "contour PLAN-V2 paused: done A1 to B3, next B4, branch engine-criteria-v2, last commit abc1234"`. `brain-save` sorts it later.
4. **Never save** API keys, passwords or contact names.

Leave the code passing the fast tests. If you can't, say in the log what is broken. When the limit resets, read this plan, run `brain context`, and carry on from the first unticked step.

### Other rules

- **In order, one step at a time.** Part C waits for Part B, because the website reads the API.
- **One test run at a time.** The backend tests and the website tests together run out of memory on this laptop.
- **Paid steps** say **Costs money**. They use the API key's money, not the Claude plan. Run them only when Al-khair says so.
- **Commits and pushes** happen when Al-khair asks. Keep commits small, one step each.
- **A choice still open with Levi** is not a hard rule. Build our recommendation, put the number in the rules file, and mark it **TBC**.
- **Words:** plain, as in [CLAUDE.md](../CLAUDE.md).

## What changes

| Rule | Version 1 (the engine today) | Version 2 (all **TBC**) | Step |
|---|---|---|---|
| Staff | 100 to 600 in the city, used when the office size is unknown | A hint (75+), never a Drop | B1 |
| Small companies | Not covered | One that will soon grow into the range counts | B1 |
| Industry | Site-heavy industries get a "check office size" flag | Judge the office, not the industry. Tiers add points. | B2 |
| Triggers | 4 main, 3 other, 2 weak | 3 new ones. A leadership change counts only when strategy changes. | B3 |
| Office history | "Office is due" booster at 6+ years | 5 to 8 years at the address. A move or fitout in the last 3 years lowers the rank. | B4, B5 |
| Score | Our own weights and 6 boosters | The Profile's 100 points in 6 parts, shown as "48 of 60 checked" | B5 |
| Results | Pass, Director review, Watch, Drop | Same, with the Profile's stage beside each | B6 |
| Staff and office numbers | The AI's web research | HubSpot, then a headcount tool, then LinkedIn × 2, then web research | B7 |
| Lead card | One opening line | Talking points, office history, past contractors | B4, C2 |

**No change:** the 1,000 to 6,000 m² range, Sydney as a Director decision, the local team and healthy rules, the Director sectors, and never suggest.

## Part A: Get ready

Nothing changes in the engine yet.

- [x] **A1. Make the branch and take a baseline.** Done 2026-10-30, 6dce0d3.
  - Make `engine-criteria-v2` from `master`, once this plan is merged into it. It was made from `docs/plan-folder` instead, because the plan is not in `master` yet.
  - From `engine/backend/`, run `uv run pytest`. From `engine/frontend/`, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, one at a time.
  - If a test can't run because Windows App Control blocks files in `.venv`, don't work around it. That happened on 29 Oct (AI Brain note), and tests ran fine again on 30 Oct. Tell Al-khair.
  - Write the numbers in the log.
  - **Done when:** everything passes and the numbers are in the log.
- [ ] **A2. Send Levi the questions.**
  - One short email. It holds the 5 questions in [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md) section 12, plus 3 new ones.
  - New 1: a fresh HubSpot export with office size, lease expiry, last moved and manual headcount per city. Ours has a lease expiry for 1 of 185 offices, no last-moved dates, and no office size or manual headcount ([EXPORT.md](../projects/leads/research/EXPORT.md)).
  - New 2: the Signal Hire account. New 3: his OK to send the Gold customers' company names to Claude.
  - **Done when:** it is sent. Write his answers in Criteria_v2.md as they come. Work goes on with our recommended numbers meanwhile.
- [ ] **A3. Test Signal Hire by hand.**
  - Compare its headcount with LinkedIn × 2 for 5 companies from `testset.yaml`. Write the result in Criteria_v2.md section 2.
  - Building a connector is Levi's call (**TBC**). Until then Signal Hire, Lusha and Apollo stay on the blocked list.
  - **Blocked:** until Levi sends the account.
  - **Done when:** the result is written.

## Part B: Change the rules, one at a time

Each step changes the rules file, the code and Claude's instructions together, and adds tests. No step needs a paid search. The rules files are in `engine/backend/apps/lead_finder/rules/`. New facts get default values, so the 16 old lead cards still open.

**Part B is done when:** every change in Criteria_v2 sections 1 to 8 is in the rules and the code, and `uv run pytest` passes.

- [x] **B1. Size: staff as a hint, and growing companies.** Done 2026-10-30, af92afa.
  - Staff becomes a hint, not a Drop. Start the hint at 75 office staff (the Profile). Levi's brief says 100 in one office, so he picks (**TBC**).
  - A size worked out from staff gives "check office size" below the hint, and never a Drop. A known office under 800 m² still Drops, as in version 1.
  - Add the growing-into-range rule from Levi's email: big funding or a big announcement, plus a plan to hire. The office it will need is what counts. Start at "within 24 months" (our guess, **TBC**).
  - Change: `size` in `criteria.yaml` and `rules.py`, `_size` in `scoring.py`, new facts `growth_plan` and `size_needed_m2` in `fields.py`, `extract.md`, and the tests.
  - **Done when:** tests pass for 74 and 75 staff and for 799 and 800 m². A Southern Launch sample (30 to 40 staff, funding for 150) passes the size rule.
- [ ] **B2. Industry: judge the office, not the industry.**
  - Replace the industry flag with a new fact, `office_matters`: does the office matter to how they work (growth, culture, collaboration, talent)? A miner's head office counts. A warehouse, plant or shop doesn't. If unsure, the company gets "check office size".
  - Add the industry tiers from Criteria_v2 section 3 as lists in `criteria.yaml`. They only add points (B5) and never decide fit. Defence stays in Tier 2 until Levi answers question 1.
  - Keep the Director sectors. Re-check `not_office_based` in `watchlist.yaml`: a miner's corporate office now counts, so some HubSpot industries may stop being skipped (**TBC** with Levi).
  - Change: `_industry` in `scoring.py`, `extract.md`, and the tests.
  - **Done when:** tests show a Perth mining head office isn't flagged for its industry, and a warehouse-only company is.
- [ ] **B3. Triggers.**
  - Add 3 to the Other group: a new facility with a big office part, a new business unit, and an underperforming workplace (or a major business or industry change).
  - Move the leadership change up from Weak to Other. It counts only when the strategy changes. Add "culture change" to Weak. Keep the ids `new_ceo` and `hiring_push`, so old leads keep their labels.
  - Match the wording to Criteria_v2 section 4. Add a search template for each new trigger in `queries.yaml`, because the backend won't start without one.
  - **Done when:** the rules load, each trigger has a template, the Start page lists the new triggers, and tests cover each new id.
- [ ] **B4. Office history and the lead card's new facts.**
  - New facts in `fields.py` and `extract.md`: `office_since` (the year they moved in), `last_fitout` (the date of the last move or fitout), `fitout_contractors` (past design and fitout firms) and `talking_points` (2 or 3 short points tied to the trigger).
  - Add `office_age` to `criteria.yaml`: due after 5 years (the low end of Levi's 5 to 8, **TBC**), and a move or fitout in the last 3 years counts as recent.
  - Add the 18-month consultant window. The card shows it as text, because the tool can't see it.
  - **Done when:** tests read the new facts from a saved sample answer, and a card without them still loads.
- [ ] **B5. Score.**
  - Replace the version 1 weights and boosters with the Profile's 6 parts: trigger 25, project size 20, timing 15, decision-maker access 15, strategic fit 15, competitive opportunity 10.
  - Split each part into small scoring checks with points in `criteria.yaml`. These are our proposal (**TBC**) until Levi fills in the Importance column. Timing uses the office age from B4. Strategic fit uses the tiers from B2.
  - For each check, record the points earned, or "not known yet". The score is the points earned. "Checked" is the most the tool could judge for that lead, like "48 of 60 checked".
  - Show the Profile's band: 75 to 100 research first, 50 to 74 investigate, under 50 nurture. Recommendation (**TBC**): scale to 100 to pick the band, so 48 of 60 counts as 80. Keep "can pay" as a tie-breaker only.
  - Change: `Score` in `rules.py`, `_score` in `scoring.py`, `signal_points` in `choose.py` (ranking uses the trigger and timing parts), `research.py`, and one migration that adds `score_checked`. Old leads stay empty there.
  - **Done when:** a lead with every check known scores out of 100, and one with some unknown shows "x of y checked". The rules loader refuses a score that can go over 100. The migration runs up and down.
- [ ] **B6. Results and stages.**
  - Results don't change. Add the Profile's stage beside each in `criteria.yaml`: Pass and Director review are "Active prospect", Watch is "Target account", Drop is "Not a target".
  - The API returns the stage for every lead.
  - **Done when:** tests cover all four results.
- [ ] **B7. Where staff and office numbers come from.**
  - Write the order in `criteria.yaml`: (1) HubSpot's office size, lease expiry and manual headcount, (2) a headcount tool, only if A3 and Levi say yes, (3) LinkedIn × 2, because a LinkedIn count is about half the real staff, (4) the AI's web research.
  - Our export has none of (1) yet. Lease expiry is filled for 1 of 185 offices and last moved for 0. It has no office size or manual headcount. It does hold a LinkedIn staff number for 178 of 185 offices. Use that for a company already in HubSpot until Levi sends a fresh export (A2).
  - The card says where each number came from.
  - **Done when:** a test company in HubSpot gets its staff from HubSpot, and the card names the source. This step stays small unless Levi sends more data.

## Part C: Update the website

Start after Part B, because the website reads the API. Follow [DESIGN.md](../engine/DESIGN.md). Check every page in light and dark mode and at phone width.

- [ ] **C1. API and types.**
  - The lead endpoints return the score parts, "checked", the band, the stage and the new card facts (`schemas.py`, `api_leads.py`, `lead_store.py`).
  - From `engine/backend/`, run `uv run engine openapi`. From `engine/frontend/`, run `npm run types`.
  - **Done when:** the contract tests pass and the website's types match the API.
- [ ] **C2. Lead card.**
  - Show the 6 score parts with "x of y checked", and "not known yet" for what the tool couldn't judge. Show the stage, the talking points, the office history and the past contractors (`lead/lead-card-view.tsx`).
  - A card made under version 1 says "Scored under version 1".
  - **Done when:** a version 2 lead and a version 1 lead both open, checked in the browser.
- [ ] **C3. Results, Start and Admin pages.**
  - Results: the score shows as "x of y", there is a stage filter, and the CSV has the new columns (`results/columns.tsx`, `results/filter-bar.tsx`, `results/params.ts`).
  - Start: the new triggers show under the right group. Admin: the Rules tab shows version 2 and its **TBC** notes (`admin/rules.tsx`).
  - **Done when:** lint, typecheck, tests and build pass, and the three pages are checked in the browser.

## Part D: Test on real cases

- [ ] **D1. Free dry run.**
  - Add a `lead-finder rejudge` command. It runs the version 2 rules over the facts already saved in each lead's card. It makes no searches and costs nothing.
  - Run it on the 16 leads in the dev database. Today they are 13 Watch, 2 Drop, 1 Director review and no Pass. Facts that version 2 needs but the card lacks show "not known yet".
  - **Done when:** a before-and-after list is written, with the reason for each change.
- [ ] **D2. Paid test set. Costs money.**
  - Add the Gold customers (company names only) and Southern Launch to `testset.yaml`, next to the 10 companies already there. Contact names never go in the file or to Claude.
  - Cost: about US$12 for 34 companies. The number is measured, not guessed: the 16 real leads so far cost US$5.48, or US$0.34 each. The cap is US$2.50 a company, so US$85 at worst.
  - Needs: Levi's OK to send the Gold names to Claude, and the full name list. Criteria_v2 names most of them. The full list was pasted in chat on 29 Oct and isn't saved. Run it from the host with `uv run lead-finder testset --yes`, which reads the key from `engine/.env`. The `contour-backend` container has its key blanked, so it can't run paid steps. Ask Al-khair before you run it.
  - Keep a prompt or rule change only if the test set score holds ([AGENTS.md](../engine/AGENTS.md)).
  - **Done when:** every company has a result and a score, and each Drop has a reason we agree with. Target (**TBC** with Levi): at least 20 of the 23 Gold customers are not Dropped. 4 of their projects were under US$1.5M, so some may fail the size rule. That is evidence for Levi, not a bug.
- [ ] **D3. Write it up for Levi.**
  - In Criteria_v2.md section 11, add a version 1 against version 2 table for the 16 leads and the test set.
  - Add a one-page list of every rule marked **TBC**, with our number and what the test showed. Use the `plain` skill.
  - **Done when:** it is ready to send.

## Part E: Go live (after Levi confirms)

- [ ] **E1. Levi confirms.**
  - He confirms Criteria_v2, or sends changes. Put his numbers in `criteria.yaml` and Criteria_v2.md. Remove the **TBC** notes he settled.
  - **Done when:** the **TBC** list in `criteria.yaml` holds only what is still open.
- [ ] **E2. Merge.**
  - Merge `engine-criteria-v2` into `master`, fast-forward, as for earlier phases. Do it when Al-khair asks. Push only when asked.
  - **Done when:** `master` follows version 2, and a new run saves the new rules version.
- [ ] **E3. Update the documents.**
  - Criteria_v2.md says "confirmed: the engine follows this version". Criteria_v1.md stays as history.
  - Update [LEADS.md](../projects/leads/LEADS.md), [PARAMETERS.md](../projects/leads/research/PARAMETERS.md), [engine/README.md](../engine/README.md) and [engine/AGENTS.md](../engine/AGENTS.md) (the "rules it applies" line). Fix the notes in `criteria.yaml`, `scoring.py` and `test_rules.py` that still say `COMPANY.md`.
  - **Done when:** no file says the engine follows version 1, and `COMPANY.md` appears nowhere.
- [ ] **E4. Save to the AI Brain.**
  - Run `brain-save`: update the project overview and its status, add the decisions with reasons, update the code map, and write the conversation summary.
  - **Done when:** `brain search "criteria v2" --project contour` finds the new notes.

## Not in this plan

- **Levi's brief, jobs 1, 2 and 4:** the monthly HubSpot ranking, the HubSpot data check, and the search for companies linked to current customers. Also the Prep Call and Post Call tools. Each needs its own plan after Levi answers (Criteria_v2 section 10).
- **Phase 5, send to HubSpot:** stays in PLAN-V1. When we get there, add the stage, the score and "checked" to its HubSpot field list.
- **Customer links:** the score check "link to a current customer" shows "not known yet" until Levi sends the full client list.
- **Property Daily** stays off. **LinkedIn scraping** is not done, because of the risk of IP bans (27 Oct meeting).
- **The calendar scheduling tool** is the next project after lead finding.

## Waiting on Levi

- **To confirm the rules (E1):** the Profile (tiers, the 75+ hint, the 100-point score), the Importance column, and the missing documents, including whether the 23 Gold customers are the full client list (Criteria_v2 section 12, questions 1, 2 and 5). The Importance column also sets the final weights in B5.
- **For the later jobs:** monthly or weekly lists, and HubSpot contact edits (questions 3 and 4).
- **Data and access (A3, B7):** a fresh HubSpot export, and the Signal Hire account.
- **OK on data (D2):** sending the Gold customers' company names to Claude.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-10-30: B1 done (af92afa). Backend lint, types and 1,099 lead finder tests pass. The API file (`openapi.json`) and the website types are not refreshed yet. C1 does that, and the website test card needs the new facts then.
- 2026-10-30: A1 done. Baseline before any change: backend 2,227 passed and 28 skipped (3 min). Website: lint 0 warnings, typecheck clean, 667 tests in 39 files, build OK. Windows App Control did not block anything.
- 2026-10-30: Plan written. `PLAN.md` moved to `plan/PLAN-V1.md`. No steps started.

## Sources

- The rules we are building: [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md). The rules the engine follows today: [Criteria_v1.md](../projects/leads/criteria/Criteria_v1.md) and [DEAL.md](../projects/leads/criteria/DEAL.md).
- Levi's documents: [documents/lead-finder-docs/](../documents/lead-finder-docs/).
- Checked on 2026-10-30: the 185 HubSpot offices in the dev database (lease expiry for 1, last moved for 0, LinkedIn staff for 178), the 16 real leads (US$5.48 in total), and the usage limits (`get_usage`). See also [EXPORT.md](../projects/leads/research/EXPORT.md).
- The engine: [engine/AGENTS.md](../engine/AGENTS.md) and [engine/README.md](../engine/README.md).
