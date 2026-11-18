# More leads, still good ones: plan, version 21

This plan makes the Lead Finder find, research and show many more companies, without loosening its evidence rules. A person who starts a run says how many companies they want, and the run keeps searching in new ways until it has them. Property Daily's own items come first, and a run that comes up short is topped up from the HubSpot watchlist. The score stops punishing what the tool can't see, every lead shows on Results, and the Start page works on a phone. One session builds it, in three parts, one after another.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms the rule numbers marked **TBC with Levi**.
- **Last updated:** 18 Nov 2026 (merged into `master` and pushed on Al-khair's word; not deployed).
- **Progress:** S0: 1 of 1. Part 1: 9 of 9. Part 2: 5 of 6. Part 3: 5 of 6. M1 to M4: 1 of 4. W1 and W2: 0 of 2.
- **Sources:**
  - Al-khair's asks in chat (18 Nov), with 3 screenshots of the Start page;
  - the audit in the same chat: the live site's runs, leads, settings, schedules and sources, read through Chrome (GET only);
  - the code on `master` (`4af47fd`);
  - [PLAN-V16.md](PLAN-V16.md) (Levi's notes, the score and the tiers) and [PLAN-V20.md](PLAN-V20.md) (its "Not done here, on purpose").
- **Comes after:** [PLAN-V20.md](PLAN-V20.md), deployed 17 Nov. The live database is at `0025_v19_roles_access`.

## Go signals

Say the line in the session. The same line starts the work, and continues it later from the first step that isn't ticked. Saying `implement v21` counts as Al-khair's word for S0.

| Say | What it does |
|---|---|
| `implement v21` | Builds Part 1 (the engine), then Part 2 (the score and the lists), then Part 3 (the website) |
| `merge v21` | Checks everything, then moves `master` to `plan-v21` |
| `deploy v21` | Pushes `master`, deploys to App Platform, and does the live steps in M3 |

You'll also answer things along the way:
- **Each screen waits for your look.** The session marks it "built, waiting for a look" and carries on.
- **The choices in "Choices made for you"** stand unless you change them before that step starts.
- **Paid checks (M2), live changes (M3) and the schedule switches (W1)** happen only on your own words in chat.

## In short

| You asked (18 Nov) | Steps |
|---|---|
| More companies and more leads, not narrow | T1-3 to T1-7 |
| Keep the quality, but don't be strict | T1-8, T2-2, T2-3, T2-5, M2 |
| Fix the score | T2-2, T2-3, W2 |
| Bring back the number of companies | T1-4, T3-3 |
| "What to do" on a phone | T3-1, T3-6 |
| "How far back" | T1-2, T3-2 |
| My leads went missing from Results | T2-1, T2-4, T3-5, M3 |

## What is wrong today

From the audit of 18 Nov, on the live site.

| What | The numbers |
|---|---|
| Hidden leads | The database holds 31 leads. Results always asks for a tier. Its default (A and B) matches 0 leads, and "every tier" matches 10. The other 21 were researched on 6 and 11 Nov, before tiers existed, so no view shows them. They include 5 Pass and 4 Director review leads. |
| Empty cards | The 9 leads researched on 16 and 17 Nov have `form_failed` (Claude refused the old form). Their refill (PLAN-V20 M3, about US$3) has not run. |
| Few companies | Run `f7182b66` (18 Nov, Adelaide, 10 signs): 9 search requests, 17 finds, 13 companies after merging, 10 chosen. Sydney on 17 Nov: 8 requests, 2 finds. Nothing searches more when a run comes up short. |
| Property Daily's items | The tool is on and signed in, and the research reads it (8 pages on 18 Nov). But discovery reads only our saved copy, and the two schedule jobs that fill it are switched off. The daily email job ran once (17 Nov). The lease endings job never ran. The copy holds 10 records, and run `f7182b66` took 0 companies from it. |
| Cost of a search | The live Settings are saved at effort `max`, 8 searches a discovery request, 5 a research request and 10 page reads (the defaults are `medium`, 6, 3 and 3). A discovery request now costs US$1.00 and writes about 16,000 tokens. From 6 to 17 Nov it cost US$0.11 to 0.16 and wrote about 1,000. A company costs about US$1.75 to research at `max`, and US$0.34 to 0.42 at `medium`. |
| Early drops | 12 of 31 leads are a Drop for "too small". Agon Environmental was dropped with no research, on one number: Signal Hire's 48 (its people on file, doubled, which is a guess). |
| Lost signs | None of the 10 newest cards shows the sign discovery found it with. A failed form, or the early size stop, saves no sign. |
| A strict score | A check the tool can't judge earns 0 points. A Pass needs 55, and the best possible score is 96. |
| The Start page | "What to do" is a sliding row of 4 long labels. It scrolls sideways with no scrollbar, so "Companies by na" is cut, even on a laptop. "How far back" offers only 7 and 30 days, and its track stretches across the card. |

## What this plan aims for

Measured in M2, on one city.

| | Today (run `f7182b66`) | After this plan |
|---|---|---|
| Companies found, after merging | 13 | 50 or more |
| Companies researched | 10 | 40 or more |
| Cost for each researched company | about US$2.65 (US$0.90 of search, about US$1.75 of research) | US$0.60 or less (**TBC**) |
| Leads shown on Results | 10 of 31 | every lead, with Discard one click away |
| Quality | not measured | the test set lands inside the ranges Al-khair confirms (T2-5), and Al-khair finds at least 7 of 10 sampled leads worth a call (**TBC**) |

## Words used here

- **Sweep:** one search request for each sign. Sweep 1 is today's search. Sweeps 2 to 4 search the same signs in new ways.
- **Target:** how many companies a run tries to research. It is not a goal of good leads. It never ends a run early; it only makes the run search more.
- **Top up:** when the sweeps come up short, the run adds companies from the HubSpot watchlist in its places.
- **Tier:** A (pursue now), B (nurture), C (watch) or Discard, set by the score (PLAN-V16).
- **Not known yet:** a check the tool can't judge for a lead, like a warm path in.
- **Rejudge:** `uv run lead-finder rejudge` judges the saved leads again with the current rules. It is free. With `--save` it saves the new verdict.

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts. The rule ones are **TBC with Levi**.

**Volume:**
1. **A target of companies, not a goal of good leads.** Start asks "How many companies", with 25, 50 and 100 to pick, and 50 picked (**TBC**). The run's company limit (70 on the live site) and its money limits still win. PLAN-V20's rule stays: nothing stops a run for want of good leads.
2. **At most four sweeps, in this order, stopping once the target is met:** the signs' own searches (today's), then Levi's source groups for those signs, then the signs by sector group, then the signs by area (the CBD, then the inner suburbs; for All of Australia, the priority cities by name). Property Daily's new items come before sweep 1, and cost nothing.
3. **A run that comes up short is topped up from the HubSpot watchlist** in its places, most likely first. It skips what a run skips today: a company researched in the last 30 days, sent, rejected or with an open deal. It is on by default (**TBC**), and each company is marked "From HubSpot". It needs `hubspot_names_to_claude_ok`, which is on live.
4. **Discovery runs at `medium` effort with 6 searches a request** (US$0.11 to 0.16, measured). The research effort is picked in M2 from the test set: `medium`, unless `high` finds clearly better facts.
5. **How far back: 7 days, 30 days, 90 days or 6 months, with 90 days picked** for a run a person starts (**TBC with Levi**). Levi's notes count a sign for 18 months, and the score already gives older news fewer points. Automatic runs keep 30 days.

**Quality, without being strict:**
6. **Not known yet counts half.** A check the tool can't judge earns half its points. A check that fails earns 0 (**TBC with Levi**). The confidence still says what wasn't checked, so a lead built on guesses reads as one.
7. **No drop before research on a guess.** Only HubSpot's own count, for a sure match, can stop a company before research. After research, an estimated 30 to 49 staff is a Watch with "check the size", not a Drop (**TBC with Levi**). A known count under 50 stays a Drop unless the company is growing (Levi, 5 and 9 Nov).
8. **Levi's tier cuts stay** (A 75, B 55, C 40) until the rejudge with half points is measured (T2-2). Then Al-khair and Levi decide whether B moves (W2).
9. **Results shows Tier A, B and C by default, plus leads with no tier yet.** Discard is one click away. A good lead for Levi's round goal is still Tier A or B.
10. **The results keep their names:** Pass, Director review, Watch and Drop.

**What stays the same:**
- Every sign still needs a link among the pages read, and passes the date check. No company comes from Claude's memory.
- Never suggest: open deals, already sent, rejected (unless a newer sign), do not contact.
- Levi's exclusions (with the override) and his dampeners.
- A company researched in the last 30 days is skipped, so nothing is paid for twice.
- HubSpot stays read only. No emails or phone numbers are stored or sent to Claude.
- The money limits. No limit rises by itself.

## What it costs

- **To build:** time only.
- **The paid checks (M2), on Al-khair's word:** the test set at `medium` and at `high` research effort (about US$5.51 each by the 11 Nov estimate, **TBC** at today's prices; `high` costs more), and one city run with a target of 50 and a US$30 cap.
- **To run, at `medium` (M2 measures it):**
  - a discovery request is about US$0.15, so a sweep of 8 signs is about US$1.20, and four sweeps about US$5;
  - a researched company is about US$0.34 to 0.42;
  - so a run of 50 companies is about US$22 to 27. At `max` the same run would cost about US$90, over the run limit.
- **Levi's price:** US$100 to 200 for 100 good leads (8 Nov).
- **The live steps (M3):** the rejudge is free. The refill of the 9 empty leads is about US$3.
- **Time:** a run of 50 companies at 2 Claude requests at once may take 1 to 2 hours (**TBC**, M2 measures it).

## Who builds it

One session builds every step, in order: Part 1, then Part 2, then Part 3. The backend parts come first, so the website is built against the real API.

## How to work this plan

**The copy.**
- One branch, `plan-v21`, made from `master`, in its own copy: `git worktree add ../contour-v21 -b plan-v21 master` (see S0). The main folder stays on `master`.
- In the new copy: `uv sync --frozen` in `engine/backend`, `npm ci` in `engine/frontend`, and copy `projects/leads/research/COMPANIES.xlsx` from the main folder.

**Ports and database.**
- Backend `API_PORT=8081`. Website on port 5251, with its proxy to 8081. Database `leadfinder_v21`, a copy of the dev database migrated to `0025_v19_roles_access`. Test database suffix `LEADFINDER_TEST_DB_SUFFIX=_v21`.
- The copy's `engine/.env` holds the `POSTGRES_*` lines only. `API_PORT` and `CORS_ORIGINS` go on the command line.
- **No Claude key.** The copy's backend starts with none. `ANTHROPIC_API_KEY` is also a Windows user setting on this laptop, so blank it for that process, and check that `GET /api/v1/health/details` says "No Claude key is set".
- Leave ports 8000 and 5173 alone: the running app uses them.

**What to expect.**
- **No migration is expected.** The new params live in the run's saved params, and the new settings in the settings table (**TBC** in S0). If one is needed, it is `0026_v21_...` after `0025_v19_roles_access`.
- **No new package.**
- The API contract and the website's types are made again after Part 2 (`uv run --no-sync engine openapi`, then `npm run types`), before Part 3 starts.

**Every working session.**
- **At the start:** read this section, go to `../contour-v21`, find the first step that isn't ticked, and run `brain context`.
- **Rule and score steps** follow the `rule-change` skill: one rule at a time, with the rejudge counts before and after in the Log.
- **API steps** follow the `api-change` skill. **Screens** follow the `ui-build` skill and `engine/DESIGN.md`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks.
- **Windows Application Control** blocks a new venv's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the Progress line and add a line to that part's Log.
- **Only on Al-khair's word:** merging, pushing, deploying, spending money, changing a live setting, or switching a schedule on.
- **Screens:** check each at 1440px, 1280px, 768px and 390px, in light and dark, with the keyboard. Screenshots go in `plan/shots/v21/`, which git ignores.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the build starts

- [x] **S0. The branch, the stubs and the settings.** Done 18 Nov 2026 (`efe47bd`, `3f8ea61`).
  - Make `plan-v21` from `master` in the worktree `../contour-v21`. Don't switch the main folder's branch.
  - Its first commit holds this plan and its lines in `CLAUDE.md`. Both were written in the main folder on 18 Nov and not committed. Copy them in. Then remove the main folder's copies, so `master` can move later: delete the untracked `plan/PLAN-V21.md`, and put `CLAUDE.md` back with `git checkout -- CLAUDE.md` only if it has no other uncommitted edit (if it has, leave it and say so in the Log).
  - Then the stubs: the new params and run options fields, the events and counts, the settings and the rule models in the contract below. Each has its default and does nothing yet.
  - **Done when:** `git branch --list plan-v21` shows it, it holds `plan/PLAN-V21.md`, and the backend tests pass on it.

## The contract

### 1. Run params and options (Part 1 builds, Part 3 reads)

- `POST /runs`, mode `discovery`, gains:
  - `target_companies` (a whole number, optional, from 5 to the run's company limit; the default comes from the run options): how many companies the run tries to research;
  - `top_up` (true or false, default true): fill a short run from the HubSpot watchlist;
  - `since_days` also takes 90 and 180 (7, 14 and 30 stay).
- `GET /lead-finder/run-options` gains `target_companies` (`default`, `min`, `max`, `presets`) and `top_up` (`default`, `allowed`). `allowed` is false while `hubspot_names_to_claude_ok` is off. `since_days.choices` becomes 7, 30, 90 and 180, with 90 the default (choice 5).
- `POST /runs/estimate`, for discovery, gains a cost range for the target, and one sentence when the target doesn't fit the money limits. S0 fixes the field names.

### 2. Run progress (Part 1 builds, Part 3 reads)

- New events: `sweep_started` (`sweep`, `of`, `label`), `sweep_done` (`sweep`, `found`, `companies`, `target`) and `topped_up` (`count`). `companies` is how many the run has chosen so far, after merging.
- `RunCounts` gains `target`, `sweeps`, `sweeps_done` and `topped_up`.
- The run merges after each sweep, so "companies after merging" is never 0 while searches still run.

### 3. Leads (Part 2 builds, Part 3 reads)

- `GET /lead-finder/leads`, its facets, the map and the CSV: `tier` also takes `none`, a lead with no tier yet. When `tier` is left out, it means A, B, C and none.
- Every lead discovery found carries its sign: `trigger_id` and `trigger_ids` on the row, and the sign on the card, even when the research failed or stopped early (Part 1 writes them).

### 4. Settings (S0 adds them)

- `claude_effort_discover` (default `medium`) and `claude_effort_research` (default `medium`, **TBC** in M2). `claude_effort` stays for every other request, like call prep and the meeting forms.
- `target_companies_default` (50) and `discovery_max_sweeps` (4).

### 5. Rules (S0 adds the models, the parts fill them)

- `queries.yaml` gains `sweeps` (Part 1): the wording of sweeps 2 to 4.
- `criteria.yaml` gains `score.unknown_share` (0.5) and `size.estimated_floor` (30) (Part 2).

## Part 1: the engine

- [x] **T1-1. Effort for each step.** Done 18 Nov 2026 (`8df4be3`). The discovery request uses `claude_effort_discover`. The research's requests (search notes, the two forms, Why now) use `claude_effort_research`. Every other project keeps `claude_effort`.
  - **Done when:** a FakeClaude test sees `medium` on the discovery request and the research's own effort on the rest, and the Settings page lists both settings.
- [x] **T1-2. How far back: 90 days and 6 months.** Done 18 Nov 2026 (`8df4be3`). `SinceDays` takes 90 and 180. The run options offer 7, 30, 90 and 180, with 90 the default for a run a person starts. The discovery request and its date check follow the choice. Automatic runs keep 30.
  - **Done when:** params and options tests pass, and the date check keeps a 60 day old event at 90 days and drops it at 30.
- [x] **T1-3. The sweeps' searches.** Done 18 Nov 2026 (`8df4be3`). `queries.yaml` `sweeps`:
  - sweep 2 is Levi's source groups for each sign. Today they share sweep 1's request, which makes it long;
  - sweep 3 is each sign by sector group: 3 groups of Levi's priority sectors;
  - sweep 4 is each sign by area: the CBD, then the inner suburbs. For All of Australia it is the priority cities by name.
  - Nothing one sweep finds goes into another sweep's request (the discovery safety rule: a page can't steer another search).
  - **Done when:** `make_slices` tests pass for each sweep, and the backend refuses to start when a sign that is searched has no sweep 2 wording.
- [x] **T1-4. The target and the sweeps.** Done 18 Nov 2026 (`8df4be3`). `target_companies` goes into the params and the estimate. After each sweep the run merges and chooses. If it has fewer companies than its target, sweeps are left, and discovery's share of the money isn't used up, it starts the next sweep. Then comes the top up (T1-6), then the research. `check_discovery_size` counts sweep 1 only: later sweeps run only while money is left. A resume never repeats a sweep that was paid for.
  - **Done when:** FakeClaude tests show that a run that meets its target in sweep 1 makes no sweep 2; a thin run goes on to sweep 4 and stops; a run at its discovery money stops sweeping and says so in the feed; and a resume in the middle of sweep 3 starts at sweep 3.
- [x] **T1-5. Property Daily first.** Done 18 Nov 2026 (`26cd507`). Before sweep 1, the run's plan turns Property Daily's new items for its places and how far back into companies. That part is built (PLAN-V16 T1-8). New here: when Property Daily is ready and picked on Start, and our copy's last email is older than today, the plan reads the new emails first (about 1 page a day, free). So a run doesn't depend on the job, which is switched off.
  - **Done when:** with a fake reader, a run's plan reads the email once, saves its records, and its items with a sign become companies before sweep 1. With Property Daily off, paused or not picked, the run works as today.
- [x] **T1-6. The HubSpot top up.** Done 18 Nov 2026 (`8df4be3`). When the sweeps are done and the run is still short of its target, `choose` adds watchlist companies in the run's places, in the watchlist's own order (most likely first). It skips what `decide` skips. Each is researched like a HubSpot watchlist run. It is off when `top_up` is false or `hubspot_names_to_claude_ok` is off.
  - **Done when:** tests show that a run 12 short adds 12, that a run with `top_up` false adds none, and that `RunCounts.topped_up` and the row's origin (`hubspot`) say so.
- [x] **T1-7. No early drop on a guess.** Done 18 Nov 2026 (`a222bff`; the floor moved to 30 in T2-3, `734a3ea`). `research._too_small` stops a company before research only on HubSpot's own count, for a sure match. A Signal Hire count alone never stops it. The count still goes on the card.
  - **Done when:** tests show that a company with only Signal Hire's 48 is researched, and that one with HubSpot's 20 staff (a sure match) is still stopped at no cost.
- [x] **T1-8. Every card keeps its sign.** Done 18 Nov 2026 (`a222bff`). The signs discovery found go on the card and the row whatever happens next: a failed form, a failed second form, the early size stop or a research error. Each is marked "from the search, not checked by the research".
  - **Done when:** a test for each of the four paths passes, the row's `trigger_id` is set, and the card's "Why it fits" names the sign.
- [x] **T1-9. Check.** Done 18 Nov 2026 at M1: the full backend run, in four batches to spare the memory (see the M1 line in the Log). ruff, ruff format, mypy, the fast tests and the full backend run (`RUN_GATES=1`). The numbers go in the Log.

### Part 1 Log

- 18 Nov, S0: the worktree `../contour-v21` on `plan-v21`, its own `.venv`, `node_modules` and `COMPANIES.xlsx`, and the database `leadfinder_v21` (a `TEMPLATE` copy of `leadfinder`, 52 leads, none with a tier, migrated from `0024` to `0025_v19_roles_access`). The main folder's `CLAUDE.md` had only this plan's line, so it was put back with `git checkout`, and its untracked `plan/PLAN-V21.md` was deleted (both are on the branch). No migration was needed: the new params are in the run's saved params and the new settings in the settings table. Checks on S0: fast tests 3,452 passed; integration 1,295 passed and 1 failed: the Companies speed gate (`test_a_page_and_the_prep_box_are_fast_on_a_full_copy`), a timing test this plan doesn't touch, known to fail under load (17 Nov). Rerun alone at T1-9.
- 18 Nov, the contract as built (S0 left field names to fix): the estimate gains `target_companies`, `target_cost_usd_low`, `target_cost_usd_high` and `target_note`. Two small additions beyond the contract, for T3-4: `topped_up` also carries `names`, and `company_started` and `company_done` carry the company's `origin` (web, hubspot, typed or test). The run options' `top_up` also carries a `message` for Start when it isn't allowed.
- 18 Nov, T1-1: the rivals search (a search for new companies after a booming company's research) uses the discovery effort too, since it is a discovery of companies. A FakeClaude test sees `medium` on discovery and `high` on the searches, both forms and Why now when `claude_effort` is `max`.
- 18 Nov, T1-2: `round.look_back()` no longer means "the longest a run may": it is 30 for automatic runs. A schedule with no `since_days` saved gets 30 (`jobs.scheduled_params`), not the person's 90.
- 18 Nov, T1-3: 10 of the 18 searched signs have no source group, so `sweeps.sources` gives them their own sweep 2 searches (AusTender, ASX announcements, Austrade, AFR Commercial Real Estate, The Urban Developer, planning approvals; first drafts, TBC). The sector groups: energy, defence and engineering; technology, finance and professional services; resources. Sweep 1's request is now the sign's own searches only.
- 18 Nov, T1-4 (choices made while building, Al-khair can change them): sweeps, the target and the top up apply only to a run a person starts; an automatic run makes one sweep, as the plan says. A target above the run's company limit is a 422 (`target_above_limit`) on `target_companies`, so Start must keep the two together; a run with no target of its own gets `target_companies_default` pulled down to the limit. Discovery's share is a budget of its own in the run (`RunCtx.discovery_budget`, rebuilt from the search log on a resume): a slice of any sweep needs room in it, and the run sweeps again only while one more slice's hold (`slice_reserve_usd`) fits. A run with no web search has no sweeps, and its estimate is as before.
- 18 Nov, T1-6: the top up skips names the research would refuse: the export's watchlist has "The Conversation Australia + NZ", whose "+" fails the name check, so its research failed. A watchlist run would fail on it the same way today (not changed here).
- 18 Nov, tests after T1-6: the Lead Finder folder, `tests/e2e`, the run manager and the contract: 2,197 passed, 25 skipped. Old tests that count one sweep now pass `target_companies: 5`, and the default run's test expects 4 sweeps (32 searches) and still ends under its limit.
- 18 Nov, T1-5: the run's plan reads the new emails through `get_sources().feed` only when Property Daily is picked, ready (on, a login, not paused) and our copy's last email is older than today in Melbourne. Every Lead Finder test now has a quiet reader (`tests/lead_finder/conftest.py`), so no test opens a browser for it. Found, not changed: a research lookup in a test with Property Daily switched on still asks the real reader (`core.sources.reader._live`), which may try to open Chrome. TBC: give those tests a fake too.
- 18 Nov, T1-7: Signal Hire is asked before the search only to check a HubSpot count under the floor, so a research makes one Signal Hire client fewer when HubSpot has no number.
- 18 Nov, T1-8 (a choice Al-khair can change): a sign from the search counts in the score like any sign, labelled "estimated", because its link was among the pages discovery read and it passed the date check. It is added only when the research didn't find the same sign itself. A research error now still saves the lead (summary "The research failed, so only the sign the search found is known") and the run still reports the failure. The mark is `TriggerScore.from_search`, kept by a judge again (rejudge, override).
- 18 Nov, T1-9: ruff, ruff format and mypy pass; the fast tests pass in the pre-commit hook of every commit; the Lead Finder folder and `tests/e2e` passed (2,073) after T1-8, and the contract gate passed after the contract was made again. The full backend run with `RUN_GATES=1` was stopped by Claude Code at about 01:10 because the laptop was low on memory (1.4 GB free of 15.6 GB afterwards). It isn't run again without Al-khair's word (see T2-6).

## Part 2: the score and the lists

- [x] **T2-1. No hidden leads.** Done 18 Nov 2026 (`734a3ea`). `tier` takes `none`. When `tier` is left out, it means A, B, C and none. The facets count `none`.
  - **Done when:** store and API tests with 21 untiered leads out of 31 show the untiered ones in the default view, and `tier=discard` alone shows only Discard.
- [x] **T2-2. Not known yet counts half.** Done 18 Nov 2026 (`734a3ea`). `score.unknown_share` is 0.5: a check that is "not known yet" earns half its points, rounded down. A failed check earns 0. The card and the Rules page say "half points: not known yet". The confidence is unchanged.
  - **Done when:** the scoring tests pass, and the rejudge tables (the dev leads and the test set) before and after, by tier, are in the Log.
- [x] **T2-3. The size band.** Done 18 Nov 2026 (`734a3ea`). After research, a size worked out from an estimated staff number between `size.estimated_floor` (30) and `staff_floor` (50) is a Watch with "check the size". A known count under 50 stays a Drop unless the company is growing.
  - **Done when:** the scoring tests pass, and the rejudge counts are in the Log.
- [x] **T2-4. Results' default view.** Done 18 Nov 2026 (`734a3ea`). The API's default is Tier A, B and C plus no tier. Discard and the excluded leads stay one filter away. Home's and the run page's counts of good leads stay A and B.
  - **Done when:** an API test checks the default.
- [ ] **T2-5. The quality bar.** Built (`734a3ea`), waiting for Al-khair's yes to the ranges. The test set has no expected results today (since PLAN-V16 T1-2). Propose a tier range for each test set company from its last saved result, like "C or better" or "Discard or C". Al-khair confirms them before M2. The test set report shows each company's tier, and whether it is inside its range.
  - **Done when:** the ranges are in `testset.yaml`, Al-khair has said yes in chat, and a free report on the saved results shows them.
- [x] **T2-6. Check.** Done 18 Nov 2026: the contract and the types made again (`305c78c`), and the full backend run at M1. ruff, mypy, the fast tests and the full backend run. Make the API contract and the website's types again for Part 3. The rejudge tables go in the Log.

### Part 2 Log

- 18 Nov, T2-1 and T2-4: `tier=none` is a lead with no tier yet. With no tier asked, the list, facets, map and CSV show A, B, C and none. `excluded=true` alone shows every excluded lead (they are Discards), so they stay one filter away too. The facets gain a `tier` count that leaves its own filter out. The store's own default (no tier: every lead) is unchanged, so the run email and the good-lead counts (Tier A and B) are untouched.
- 18 Nov, T2-2: `score.unknown_share: 0.5` in criteria.yaml. A "not known yet" check earns half its points, rounded down (warm path 2 of 4, local staff 6 of 12, the office's state 4 of 9, no lock-in 5 of 10). The sample lead in the tests goes from 72 to 74; a lead with no sign and a middling fit goes from 38 (Discard) to 44 (Tier C, a Watch).
- 18 Nov, T2-3: `size.estimated_floor: 30`. HubSpot's count before research is its LinkedIn count doubled, an estimate, so the early stop of T1-7 is now under 30, not 50: a company HubSpot puts at 30 to 49 is researched, as it would be a Watch after. A known count (confirmed, not LinkedIn) under 50 stays a Drop.
- 18 Nov, the rejudge tables (free; the rules with `0`/`50`, then `0.5`/`50`, then `0.5`/`30`), on the 52 dev leads in `leadfinder_v21`:

  | Rules | A | B | C | Discard | Results |
  |---|---|---|---|---|---|
  | Before Part 2 | 0 | 0 | 3 | 49 | Drop 22, Watch 30 |
  | Half points (T2-2) | 0 | 6 | 8 | 38 | Drop 22, Pass 1, Watch 29 |
  | And the size band (T2-3) | 0 | 6 | 8 | 38 | Drop 22, Pass 1, Watch 29 |

  The size band moved none of these 52 (none has an estimated 30 to 49 staff). The test set has no saved leads in any database on this laptop, so its table is empty: it needs the live site, or the M2 test set run.
- 18 Nov, T2-5: since there is no saved test set result here, the ranges in `testset.yaml` are proposed from what each company is: Culture Amp, Seek, Beach Energy, Mineral Resources and Canva "C or better" (C to A); Kogan.com, Elders, Maptek and Perenti "no better than B" (Discard to B); Bankwest "no better than C" (a bank: premium banks are left out). The report (`GET /lead-finder/testset/runs/{id}`) shows each company's tier, its range and whether it is inside; the summary counts them. Waiting for Al-khair's yes before M2.
- 18 Nov, T2-6: the contract (`openapi.json`) and the website's types (`schema.d.ts`) are made again (`305c78c`); the gates pass (3). Every Lead Finder test passes, run in batches to spare the memory: the fast ones (1,680) and every integration file, and `tests/e2e` with the contract routes (115). The full backend run is not done, for the reason in the Part 1 Log.

## Part 3: the website

- [x] **T3-1. "What to do" as cards.** Built 18 Nov 2026 (`b7223c3`), waiting for a look. Four option cards in a radio group, each with its title and its one line. Two columns from 640px, one below. Arrow keys move and Space picks. No sideways scroll. `Segmented` stays for 2 or 3 short choices, as `engine/DESIGN.md` says.
  - **Done when:** tests check the radio group and the arrow keys, and the screenshots at 1440, 1280, 768 and 390px, light and dark, show no label cut.
- [x] **T3-2. "How far back".** Built 18 Nov 2026 (`c2113a1`), waiting for a look. 7 days, 30 days, 90 days and 6 months, from the run options. The control hugs its labels (find out why `w-fit` doesn't hold today) and fits on one line at 390px.
  - **Done when:** tests pass, and the screenshots show it.
- [x] **T3-3. "How many companies".** Built 18 Nov 2026 (`7e23dff`, `c5f9e2a`, `1ae209a`), waiting for a look. Under the signs: 25, 50 and 100, a number field, and the cost range from the estimate. A "Top up from the HubSpot watchlist" switch with one line on what it does, greyed with the reason when it isn't allowed. "Most companies to research" stays in Limits, as the ceiling.
  - **Done when:** the form sends `target_companies` and `top_up`, the tests pass, and the screenshots show it.
- [x] **T3-4. The run page shows the sweeps.** Built 18 Nov 2026 (`c28ada3`), waiting for a look. "Sweep 2 of 4: 31 of 50 companies", with a bar. Companies from the top up are marked "From HubSpot". "Companies after merging" updates after each sweep.
  - **Done when:** tests with fake events pass, and a screenshot shows a run in the middle of a sweep.
- [x] **T3-5. Results shows every lead.** Built 18 Nov 2026 (`8949888`, `bbd87b2`, `0b63fee`, `b7d1ff1`), waiting for a look. The default view is A, B, C and "No tier yet". The Tier filter offers "No tier yet". A lead with no tier shows its result instead.
  - **Done when:** the tests pass, and a screenshot shows old and new leads together.
- [ ] **T3-6. The phone pass and the check.** Built and checked 18 Nov 2026 (`1ae209a`, `bbd87b2`, `b7d1ff1`); waiting for Al-khair's look. Start, the run page and Results at 390px: no sideways scroll, 44px controls and nothing cut, in light and dark. Then the website's lint, types, tests and build.
  - **Done when:** the screenshots are in `plan/shots/v21/`, the website checks pass, and Al-khair has looked.

### Part 3 Log

- 18 Nov: built by a website session (the `frontend-agent`) from one brief, in the same worktree. Its T3-1 files landed in `b7223c3` (the tier facet fix), because both sessions committed from one staging area at the same moment; nothing was lost, and the history wasn't rewritten. From T3-2 on, each commit holds only its own files.
- 18 Nov, T3-1: `OptionCards` in the motion kit (four cards, the picked one tinted with a tick; Tab lands on the picked card, the arrows move the focus, Space or Enter picks, as the plan says; most radio groups pick on the arrows, TBC with Al-khair). Two columns from 640px when the cards' own box is 480px or wider, so they stay in one column beside the cost card at 1024 to 1279px. A DESIGN.md line for `OptionCards` is proposed, not added.
- 18 Nov, T3-2: why `w-fit` didn't hold: the vertical `Field` gives every direct child `w-full`. The control now sits in its own wrapper and hugs its labels (296px, one line in the 308px a phone gives it). The run page says "Last 6 months".
- 18 Nov, T3-3 (choices for Al-khair): when "Most companies to research" is lowered under the target, the run aims for the lower number and a line says so (the typed target is kept, and the server never gets one it would refuse). A single preset (the laptop's limit of 20 leaves only [20]) is hidden. The switch is the app's on/off `Switch`, laid out like People's "Can sign in"; its whole row is the tap target.
- 18 Nov, T3-4: the bar reads "Sweep 2 of 4: 31 of 50 companies", from `sweep_done` (the backend sets `chosen` last). Topped-up companies read "Researching ABC Logistics, from HubSpot" and carry "From HubSpot" in a discovery run. The setup card shows "How many companies" and "Top up from HubSpot".
- 18 Nov, T3-5: "No tier yet" everywhere (it was "Not ranked yet"). On wide screens a row with no tier says "No tier yet" and keeps its result in the Result column (say it once); on a phone, where the Result column hides, the Tier column shows the result.
- 18 Nov, the parts left by Parts 1 and 2: the card says "From the search, not checked by the research" beside such a sign (Signs tab, quick view, profile); the Rules page explains half points and the estimated 30 to 49 band, and its Size note now says only HubSpot's own count can stop a company before research; the Test set page shows each company's range, its newest tier and whether it is inside.
- 18 Nov, T3-6: at 390px nothing scrolls sideways on Start, Results or the run page. Still under 44px on a phone, all older shared parts: the top bar's two buttons and small buttons (40px), "Show every tier" (32px), checkboxes (16px with a 40px tap area). Whether the shared sizes should grow is TBC. Checks on `b7d1ff1`: lint 0, typecheck 0 (there were 22), 2,022 tests in 139 files, build passes (first visit 241 kB gzip JS in 39 files, plus 24 kB CSS; 236 kB on 17 Nov before PLAN-V19 to V21). Rechecked by the main session: lint and typecheck clean, and the 14 test files of the changed parts pass (211 tests).
- 18 Nov, screenshots in `plan/shots/v21/` (git ignores it; Results shows real company names): Start at 1440, 1280, 768 and 390px in light and dark, close-ups of How far back and How many companies, the run page mid-sweep, Results with old and new leads, and `checks.txt`. Not confirmed yet: the run page shots use a made-up run served to the page (the page code is real); the top-up feed line and the "From HubSpot" marks were checked by tests only; keyboard by hand, motion (shots with reduced motion), Safari and a real phone weren't tried.
- 18 Nov: the app runs for Al-khair from this worktree: backend on 8081 with the Claude key (from the Windows setting) and `HUBSPOT_NAMES_TO_CLAUDE_OK=true`, website on http://localhost:5251. No HubSpot or Signal Hire key and no Property Daily login in this copy, and every schedule is off, so nothing spends money until a run is started by hand.

## Merge, checks and going live

- [x] **M1. Merge** (`merge v21`). Done 18 Nov 2026 on Al-khair's word: `master` fast-forwarded to `plan-v21` and pushed to GitHub (he asked for both). Not deployed. Make the contract and the website types again. Run the full backend and website checks, the `merge-check` skill and the `review-agent`. Then move `master` to `plan-v21`.
  - **Done when:** everything passes and `master` has moved.
- [ ] **M2. The paid checks**, only on Al-khair's word in chat:
  1. the test set at `medium` and at `high` research effort, to pick `claude_effort_research`;
  2. one city run: Melbourne, the 8 main signs, 90 days, a target of 50 and a US$30 cap. Record the companies found and researched, the tiers, the cost for each company and the time taken;
  3. Al-khair looks at 10 of its leads and marks each one Useful or not.
  - **Done when:** the numbers are in the Log, set against "What this plan aims for".
- [ ] **M3. Deploy** (`deploy v21`). Push `master` and deploy. Then, on the live site:
  1. `lead-finder rejudge --save` in the DigitalOcean console (free), so the 21 old leads get a tier;
  2. check that Results shows every lead;
  3. set the live Settings to M2's choice: discovery `medium`, research as picked, and the searches back to their defaults. Claude requests at once go to 4 if the key's limits allow it (**TBC**);
  4. refill the 9 empty leads (`lead-finder refill --yes`, about US$3), on Al-khair's word.
- [ ] **M4. The docs.** `CLAUDE.md` (this plan's line), the map in `engine/AGENTS.md`, `projects/leads/LEADS.md` (the sweeps, the target and the top up), `projects/leads/criteria/Criteria_v3.md` (half points and the size band, TBC with Levi), and a save to the AI Brain.

## Waiting on people

- [ ] **W1. Property Daily's two jobs** (Al-khair, in Admin, Schedules): "Read Property Daily's daily email" (working days, 6:15 am) and "Read Property Daily's leases that end in 12 to 36 months" (Mondays, 6:45 am, for all of Australia). Both are free and switched off today. A lease ending is one of Levi's two strongest signs (very high), and these come with the floor area and the date. Levi's green light of 15 Nov covers the tool. The vendor email in PLAN-V16 W1 is still recommended, because Property Daily's terms ask for written approval to store its material.
- [ ] **W2. Levi confirms:** half points for "not known yet", the 30 to 49 Watch band, 90 days on Start, and whether B moves after T2-2's rejudge.

## Not in this plan

- Arealytics. It refused automated access, and waits on an API or written approval.
- New signs or new sources.
- The automatic runs. They keep 30 days and Levi's goal of 100 good leads. They get the sweeps and the top up only if Al-khair says so after M2.
- Any limit rising by itself.

## Log

- 18 Nov 2026, M1 (`merge v21`, Al-khair's word, with "push it to the github"): the checks on `plan-v21`. Backend: ruff, ruff format and mypy clean; every test with `RUN_GATES=1`, in four batches because the laptop was short of memory: 4,823 passed, 25 skipped, 0 failed (core 1,098 + 1,165 with the gates, companies and e2e 477, the Lead Finder 2,083; the Companies speed test that failed under load passed). Website: lint 0, typecheck 0, 2,023 tests in 139 files, build passes (all JavaScript 765 kB gzip). Joins: one migration head (`0025_v19_roles_access`), and the contract and types match a fresh run. `scripts/schema_map.py --check` fails on 3 to 4 check constraints (`ck_leads_status`, `ck_leads_origin`, `ck_rivals_status`, `ck_users_hubspot_owner_matched_by`), the same on `master`'s code against a freshly migrated database, so it is older than V21 (PLAN-V19's `SCHEMA-0025.md`); V21 changed no table. To fix later: draw the map again. The independent review (`review-agent`): Not ready at first: the run page hid a run's Discards and excluded leads, and T1-9 and T2-6 were unticked; with three should-fix items (the sweep bar switching to research mid-sweep, a run with no web search topped up past its estimate, Home's results bar leaving Discards out). All fixed in dda3472, then rechecked: the Lead Finder and the gates 2,087 passed, the website 2,025 tests, lint, typecheck and the build. So Ready with notes (below). Then `master` moved from `4af47fd` by fast-forward and was pushed; `origin/master` was `4af47fd` before. Pushing doesn't deploy: `deploy v21` is still to come, with M3's rejudge, settings and refill.
- 18 Nov 2026, the review's notes, for later: (1) a lead with no researched facts (a failed form or a research error) and one sign from the search can score 58 with half points, Tier B but a Watch with low confidence; good-lead counts go by result, so they are safe, but such leads sit among Tier B on Results. Decide before M2, for example cap a lead with no researched facts at Tier C (TBC with Al-khair and Levi, with W2). (2) Rare edges: a company limit under 5 makes Start send a target the API refuses (5 is the least it takes); a run whose target is above a limit an admin lowered later can't be resumed (`check_target` runs again on resume); `add_search_signs` can put a switched-off tool's item on the card (Why now still filters it). (3) M4 must cover, in `engine/AGENTS.md`: `steps/top_up.py`, `next_sweep` and `settle` in the graph; only HubSpot's own count under 30 stops a company early, and a failed research keeps its sign; Start's 90 days and the automatic runs' 30; Property Daily's new emails first (its "stays off" line is old); the top up as another way HubSpot names reach Claude, behind the same flag; the four new settings. In DESIGN.md, the `OptionCards` line (proposed). And draw the schema map again. (4) The worktree's two untracked logs (`engine/.dev-logs-v21-*.log`) aren't committed.
- 18 Nov 2026, after Al-khair's test: the run page didn't reconnect after Resume (it kept the old "failed" status, the red box and the Resume button, so the run looked stuck); fixed in `2d5dbe9`. The resumed Brisbane run finished: 20 researched, US$12.79 in all (discovery 24 requests US$3.40, research searches 100 requests US$7.61, the forms 46 requests US$1.71, rivals 1 request US$0.07), so about US$0.64 a company. Tiers: A 2, B 7, C 5, Discard 6 (results: Pass 1, Director review 1, Watch 12, Drop 6).
- 18 Nov 2026: written from Al-khair's asks and the audit of the same day. No step started.
- 18 Nov 2026, Al-khair's test on the laptop (real Claude key, worktree app on 8081 and 5251): run `7f523e98`, Brisbane, the 8 main signs, 90 days, target 20 (the laptop's company limit). The sweeps worked: 3 sweeps, 24 searches, 38 finds, 24 companies after merging, 20 chosen, so no fourth sweep. It researched 1 (Mulga, a Watch at 54, US$0.48), then the rivals search for Anglo American got a 400 from Claude ("web_fetch max_uses: Input should be greater than 0": the rivals search allows 0 page reads, and the client always sent the page tool), and the refusal stopped the run at US$4.65. Fixed in `a190dc4` (no page tool when no page may be read). Afterwards Claude Code stopped both app servers because the laptop was critically low on memory; they wait for Al-khair's word to start again.
- 18 Nov 2026: Al-khair chose one implementation instead of three tracks. The tracks became Parts 1 to 3, built in order by one session, with one go signal (`implement v21`). The steps and choices are unchanged.
