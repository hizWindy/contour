# Lead Finder refinement plan, version 11

This plan tunes the Lead Finder to what Levi asked for on 9 Nov. Today it finds too few leads, and it finds some too late: Budget Direct in his Adelaide run of Friday 6 Nov had already set up its new office. We loosen four rules and add a search for companies in an old office. Everything else stays the same.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code. Levi gave the green light for these changes after the 9 Nov meeting (as Al-khair reports). He confirms what is marked **TBC** (to be confirmed).
- **Last updated:** 2026-11-10 (written, nothing built yet).
- **Progress:** 0 of 14 steps done.
- **Sources:** the Monday meeting of 9 Nov (`minutes of meeting/Monday Meeting - 2026_11_09 05_00 PST - Notes by Gemini.pdf`, the transcript from 00:12:27 to 00:27:55), [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md), and the rules files in `engine/backend/apps/lead_finder/rules/`.
- **Comes after:** [PLAN-V10.md](PLAN-V10.md) (the Companies page and call prep). This plan touches only the Lead Finder.

## In short

| What Levi said (9 Nov) | This plan |
|---|---|
| The filters may be too narrow, so we miss leads. "About 100 more staff" was too specific. | B1 rewords two signs. B2 lets 50+ staff fit. |
| News after the fact is too late: "they've already set up their office" (Budget Direct). | B3 leaves out companies that moved in the last 12 months. B4 searches for plans, not openings. |
| Once a company shows a sign, check how long it has been at its office. | B5 gives years at the address more weight, and shows it first on the lead card. |
| A second search: right size and industry, 8+ years at the same address, no known office project. It doesn't have to tick all the boxes. | Part C: a new sign for an old office, and a lease and tenure run. |

**What stays the same:**
- the cities, with Sydney going to a Director;
- the office range of 1,000 to 6,000 m², and the other Director review rules;
- the other signs, the industry tiers, and the score parts out of 100;
- "never suggest" (open deals, already sent, do not contact);
- the sources, how a run works, the run limit and the goal of 100 good leads every 2 weeks.

**What it costs to build:** nothing but time, except these checks, each on Al-khair's word:
- **B6:** the test set (10 companies, about US$3.40 to US$4.20), and one Adelaide run (about US$7.70 for 20 companies, the Start a run estimate on 9 Nov; it stops at the US$20 run limit).
- **C4:** a tenure trial of 10 companies (about US$3.40 to US$4.20, **TBC**).

**What it costs to run:** looser rules don't find more companies. A run still researches at most 20, at about US$0.34 to US$0.42 each. More of those 20 will pass, so the cost per good lead should drop. More leads overall means more companies per run, which is not in this plan.

## Words used here

- **Sign:** a sign of an office change, like a lease ending or fast growth. A lead needs one to Pass. In the code it is a "trigger".
- **Label:** a sign's wording in `criteria.yaml`. Claude reads the labels when it judges a company (`prompts.py`), so the wording works as a rule.
- **Re-judge:** `uv run lead-finder rejudge` judges the saved leads again with the current rules, from their cards. It is free and saves nothing.
- **Watchlist:** the HubSpot companies in our cities and staff range, with no open deal (`watchlist.py`). A watchlist run researches them.

## How to work this plan

- **Work in your own copy of the repo.** Another session may work in the main folder. Run `git worktree add ../contour-v11 -b plan-v11 master` once, then work in `../contour-v11`.
- **At the start of a session:** read this section, go to `../contour-v11`, find the first step that isn't ticked, and run `brain context`.
- **Ticking a step:** tick it when its "Done when" is true, with the date and the commit. Then update **Progress** and **Last updated**, and add a line to the Log.
- **One rule at a time.** For each rule step, save the re-judge output before and after, and put the changed counts in the Log. Then you can tell which change moved which lead.
- **Rules files and the criteria doc change together:** `criteria.yaml` and `Criteria_v2.md`. Keep the Rules page's TBC list current.
- **One heavy thing at a time:** use `bash engine/scripts/heavy.sh <cmd>`, because the laptop is short of memory. Make small commits, and run `git branch --show-current` before each one.
- **Only on Al-khair's word:** anything that costs money, sends a real email, writes to HubSpot, deploys, merges or pushes.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## How we check

1. **Unit tests** for every rule (`tests/lead_finder/test_rules.py`, `test_scoring.py`, `test_discover.py`).
2. **Re-judge** the saved leads before and after each change (free).
3. **The test set,** once all of Part B is in (costs money).
4. **An Adelaide run,** compared with Levi's run of 6 Nov: good leads, cost per good lead, and why each Watch is a Watch (costs money).
5. **Levi's reviews** of the next round (D3).

## Part A: Get ready

- [ ] **A1. Own copy and a baseline.**
  - Make the worktree on branch `plan-v11` (see "How to work this plan").
  - Run the backend and frontend tests once with `heavy.sh`, and note the counts.
  - Save the re-judge output as the baseline: the count of each result.
  - Note the free watchlist preview count (`GET /watchlist`) at `staff_min` 100.
  - Find Levi's Adelaide run of 6 Nov in Runs, and note its good leads and cost. He read out "833" in the meeting (not confirmed).
  - **Done when:** all of these numbers are in the Log.

## Part B: Loosen the rules (Levi, 9 Nov)

- [ ] **B1. Reword two signs.**
  - `triggers.main` in `criteria.yaml`:
    - `big_new_contract`: "Big new contract or project award, needing about 100 more office staff" becomes "Big new contract or project award that means a large increase in office staff".
    - `merger_or_takeover`: "Merger or acquisition, where one company has an old office" becomes "Merger or acquisition". Levi: even with an old office, a merger can still trigger a move.
  - The ids stay, so old leads keep their sign and show the new wording.
  - Update the signs table in `Criteria_v2.md` section 4.
  - **Files:** `criteria.yaml`, `Criteria_v2.md`, tests that quote the old labels.
  - **Done when:** the tests pass, the Rules page shows the new wording, and the re-judge counts are in the Log.
- [ ] **B2. 50+ staff fits.**
  - In `size`: `staff_hint_min` 75 → 50, and `staff_min` 100 → 50 (the watchlist starts here). `staff_floor` stays 50.
  - The "50 to 74 staff is a Watch, check the office size" band goes away, because the hint and the floor are now both 50. The rules check still holds: floor ≤ hint ≤ minimum.
  - No change: a known office under 1,000 m² is still judged on its size (800 to 1,000 m² goes to a Director). Under 50 staff is still a Drop unless the company is growing.
  - Update section 2, row 1 of `Criteria_v2.md`, and the `tbc` notes for `staff_hint_min` and `staff_floor` in `criteria.yaml`.
  - **TBC with Levi:** is a 50-staff company a lead even when it isn't growing? 50 staff at 10 m² each is about 500 m², half the 1,000 m² minimum, a fitout of about $750k against the $1.5M minimum.
  - **Files:** `criteria.yaml`, `scoring.py` (comments that say 75), `Criteria_v2.md`, tests.
  - **Done when:** the tests pass, and the re-judge counts and the new watchlist count are in the Log.
- [ ] **B3. Companies that just moved become a Watch.**
  - A new setting, `office_age.just_moved_months: 12`, in `criteria.yaml` and `rules.py`.
  - In `judge()` (`scoring.py`): a move or fitout in the last 12 months makes the result a Watch, even with a sign. The check reads, for example, "Moved in March 2026, so probably not in the market yet". A Drop stays a Drop.
  - News about an office already opened counts too. The research prompt (`prompts/extract.md`) says: when the news says the company has already moved into or opened the office, record that date as the move-in date. Then the same rule catches it. Budget Direct is the example.
  - No change: a move or fitout in the last 3 years still lowers the rank (`recent_move_years`).
  - **Files:** `criteria.yaml`, `rules.py`, `scoring.py`, `prompts/extract.md`, `Criteria_v2.md` sections 4 and 8, tests.
  - **Done when:** tests prove that a growth sign plus a move 4 months ago is a Watch, a move 14 months ago is not, and a Drop stays a Drop. The re-judge counts are in the Log.
- [ ] **B4. Search for plans, not openings.**
  - Rewrite the discovery searches in `queries.yaml` that find an office already opened. For example:
    - "international company opens first Australian office {city} {year}" becomes "international company plans to open Australian office {city} {year}";
    - "{city} defence contractor new office {year}" becomes "{city} defence contractor plans new office {year}";
    - "{city} company opens new engineering or manufacturing facility with offices {year}" becomes "plans new".
  - Add one search for plans to grow, like "{city} company plans to double staff {year}".
  - The discovery prompt (`prompts/discover.md`) prefers news about plans, and skips news about an office that is already open.
  - **Files:** `queries.yaml`, `prompts/discover.md`, tests.
  - **Done when:** every sign still has at least one search (the start-up check), and the tests pass.
- [ ] **B5. Years at the address count more.**
  - In `score`: `years_at_address` 5 → 7, and `no_recent_move` 4 → 2, so Timing still adds up to 15 (**TBC**: the numbers). `no_recent_move` can give up points because B3 now handles a recent move.
  - On the lead card, the Overview's Summary starts with the office line, like "At this address since 2017 (9 years)", or "Not known yet" (`lead/card/tab-overview.tsx`).
  - **Files:** `criteria.yaml`, `Criteria_v2.md` section 6, `tab-overview.tsx`, tests.
  - **Done when:** the rules check passes (the parts add up to 100), the card shows the line first, and the re-judge counts are in the Log.
- [ ] **B6. Check the effect.** On Al-khair's word, because it costs money:
  - Run the test set (about US$3.40 to US$4.20), and compare it with the last test run.
  - Run Adelaide again with the same choices as Levi's 6 Nov run (about US$7.70).
  - Compare the good leads, the cost per good lead, and the reason for each Watch.
  - **Done when:** the comparison is in the Log, and Al-khair has shown it to Levi.

## Part C: The lease and tenure search (Levi, 9 Nov)

- [ ] **C1. A new sign: an old office.**
  - Id `long_tenure`, a main sign, labelled "At the same address for 8 or more years, with no known office project in that time".
  - Code adds it in `judge()` from the facts, not Claude. It applies when the company has been at its address for `office_age.tenure_years` (8) or more, and no move or fitout is known since then.
  - It has no discovery search. Like the rivals' sign, it is left out of the start-up check for searches, and Claude isn't asked to find it.
  - It works in every run. A company found with no news, but in an old office, can now Pass.
  - **TBC with Levi:** 8 years, and whether an old office alone is a Pass or a Director review.
  - **Files:** `criteria.yaml`, `rules.py`, `scoring.py`, `Criteria_v2.md` section 4, tests.
  - **Done when:** tests prove that 9 years with no fitout gets the sign, 9 years with a fitout in 2022 doesn't, and 6 years doesn't.
- [ ] **C2. A lease and tenure run.**
  - Reuse the watchlist run (`mode="watchlist"` in `runs.py`). Its list is already right: HubSpot companies in our cities and staff range, with no open deal.
  - Add a `focus` choice: `growth` (today's research) or `tenure`. Tenure asks the office questions first: the current address, since when, and any move or fitout since. For example: "{company} {city} office address", "{company} moved office {city}", "{company} office fitout".
  - Choices: the city, the industries (optional), and how many companies (the most staff first).
  - It needs Levi's OK to send HubSpot names to Claude (`hubspot_names_to_claude_ok` in `engine/.env`, off today). The watchlist run already refuses to start without it. Call prep's web check needs the same OK.
  - **Files:** `runs.py`, the watchlist params, `queries.yaml` (`company`), tests.
  - **Done when:** a test run with a fake Claude researches the tenure questions and gives the C1 sign, and the cost estimate shows on the start form.
- [ ] **C3. Start a run: the choice.**
  - Start a run gets a second choice next to "Find new leads": "Old offices (lease and tenure)".
  - It shows the free watchlist count for the city, the cost estimate, and a confirm before it spends.
  - On the lead card and in Results, the new sign reads like any other sign.
  - Follow `engine/DESIGN.md`.
  - **Done when:** it works in the browser on the laptop, and Al-khair has seen it.
- [ ] **C4. Try it on 10 companies.** On Al-khair's word, after Levi's OK on HubSpot names (about US$3.40 to US$4.20, **TBC**).
  - Check each card against its sources: is the move-in year right?
  - Note in the Log how often a move-in year was found, and the cost per company.
  - **Done when:** the results are in the Log, and Al-khair has shown Levi.

## Part D: Finish

- [ ] **D1. Docs.**
  - `Criteria_v2.md`: section 1 lists what changed on 9 and 10 Nov. Update the label in `criteria.yaml` to match.
  - Check [LEADS.md](../projects/leads/LEADS.md) for old numbers (75 staff, 100 more staff).
  - **Done when:** no doc says 75+ staff fits, or "about 100 more office staff".
- [ ] **D2. Tell Levi, then merge.**
  - A short email, written with `/plain` and sent on Al-khair's word: what changed, the B6 numbers, and the TBC questions (see "Waiting on").
  - Merge, push and deploy only on Al-khair's word.
  - **Done when:** the email is sent, and the branch is merged.
- [ ] **D3. Watch the next round.** After the first round of city runs with the new rules (Melbourne to Sydney, 2 weeks):
  - Count Levi's approvals, and his reject reasons. Admin, Runs and cost already counts the reasons.
  - If one reason stands out, that is the next rule to tune.
  - **Done when:** the counts are in the Log.

## Waiting on

- **Levi:**
  - OK to send HubSpot names to Claude (C2 and C4; call prep needs it too);
  - whether a 50-staff company is a lead when it isn't growing (B2);
  - the points for years at the address (B5);
  - 8 years, and whether an old office alone is a Pass or a Director review (C1).
- **Al-khair:**
  - the spend for B6 and C4;
  - showing Levi the results;
  - merging, pushing and deploying.

## Risks

- **More weak leads.** The score still ranks them, so the best stay on top. D3's reject reasons show if a rule went too far.
- **Move-in dates are often missing.** Then B3 and C1 can't fire, and the card says "Not known yet". C4 measures how often the research finds one.
- **"Plans" searches can find rumours.** The source ranking still applies: ASX and official news score higher than other news.
- **Cost.** Each company researched costs about US$0.34 to US$0.42. The US$20 run limit and the US$150 daily limit still apply.
- **Part C waits on Levi's OK** for HubSpot names. Part B doesn't need it.

## Not in this plan

- **Our own ideas, until Levi says yes:** past clients due again, "outgrown its office", an estimated lease end from the move-in year, a building that forces a move, and approvals counted per sign.
- **Levi's LinkedIn Sales Navigator list** of growing companies. No scraping. Whether he can export it is **TBC**.
- **The redesign** of Rules, Test set and Admin (Schedules as one control, the spend chart, Search log, Memory, Settings). A later plan.
- **More companies per run,** or a new goal.

## Log

Newest first.

- 2026-11-10: **B1** (rules `f3d61463c62a`): `merger_or_takeover` reads "Merger or acquisition", and `big_new_contract` "Big new contract or project award that means a large increase in office staff". Same ids. Re-judge: no change (Pass 1, Director review 2, Watch 27, Drop 22), as expected, because a label doesn't change a result. It changes the extract prompt's version, though: Claude reads the labels.
- 2026-11-10: **A1 tests:** backend 3,330 passed, 25 skipped (`RUN_GATES=1`, 10 min 46 s); website 913 passed.
- 2026-11-10: **A1 baseline** (rules version `b67ae2652a99`, commit `f3d949b`):
  - **Where the work is:** branch `plan-v11`, made in the `contour-v10` worktree instead of a new `contour-v11` one. That folder is the one the running preview serves, so Al-khair sees each change live (his ask, 10 Nov). The preview reads `leadfinder_v10`, a copy of the dev database from 9 Nov.
  - **Re-judge** (free, 52 saved leads, the same on `leadfinder` and `leadfinder_v10`): Pass 1, Director review 2, Watch 27, Drop 22. 24 leads already differ from their saved result, from rule changes before this plan (mostly HubSpot open deals). Budget Direct is one of the 52: a Watch today, 29 of 77 checked.
  - **Watchlist preview** at `staff_min` 100 (free, the 13,914 HubSpot companies in the copy): 1,481 Watch (993 likely, 488 unlikely: Melbourne 1,004, Perth 326, Adelaide 151), 594 Director, 1,165 left out for an open deal, 7,391 too small or big (2,630 with no staff number), 3,283 with no office in our cities.
  - **Levi's Adelaide run of 6 Nov:** not in the laptop's databases (their newest run is 2 Nov). It ran on the live site, so its good leads and cost need a look at live Runs (Al-khair). **TBC**.
- 2026-11-10: Plan written from the 9 Nov meeting and Levi's green light, as Al-khair reports it. Nothing built yet.
