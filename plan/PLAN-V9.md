# Lead Finder plan, version 9: Levi's improvements

This plan makes the changes Levi asked for after he used the Lead Finder on the live site. It finds bigger companies, looks in booming industries and at overseas companies coming to Australia, runs all 4 cities by itself, and emails Levi a list to review before anything goes to HubSpot. It also gets more good leads for the money.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code. Levi confirms the business rules marked **TBC** (to be confirmed).
- **Last updated:** 2026-11-09 (D4 built: limits for manual and automatic runs).
- **Progress:** 11 of 19 steps done. All the code is built on `plan-v9` (not merged, not pushed). C1, C3, D1, E2 and E3 are built and wait on one check each; A2, A3 and D3 wait on Al-khair.
- **Sources:** the meeting notes of 2 Nov and 5 Nov in `minutes of meeting/`.
- **Comes after:** [PLAN-V8.md](PLAN-V8.md). Its open steps (B1 to B4) stay there, but A2 below needs B3.

## In short

What Levi asked for, and how this plan does it:

| Levi asked (meeting) | This plan |
|---|---|
| Only companies with 75+ staff, or about 50 if growing (5 Nov) | B1: under 50 staff is a Drop, and 50 to 74 is a Watch unless growing. B2: we stop paying to research companies we already know are tiny. |
| Overseas companies opening an office in Australia (5 Nov) | B3: a new sign, "new to Australia", judged by the staff or office they announce here. |
| Booming industries: energy transition, defence, some mining (2 Nov) | B4: a new sign, "growing with a booming industry", with its own searches. |
| If one company is booming, check its competitors too (2 Nov) | B5: up to 5 rivals of a good lead are found and researched in the next run. |
| Runs for Perth, Adelaide, Melbourne and Sydney, every 2 weeks (5 Nov) | C4: one schedule per city, on different days. |
| An email to him when a run is done (5 Nov), with a link to review first (2 Nov) | C1 to C3: the email, then a review page where he approves or rejects. |
| More leads: about US$100 to 200 for about 100 good leads every 2 weeks is fine (5 Nov) | D2, D3, D4: show the cost per good lead, test a bigger run, then let the automatic runs aim for 100 good leads, with safety brakes. |
| Only Levi, Marcus and one other person see the Lead Finder (5 Nov) | E1: a Lead Finder tick on each person's account. |

Two extras of ours:

- **Reject reasons** (D1). When Levi rejects a lead, he picks why. The counts show which rule to tune.
- **No money on tiny companies** (B2). Free staff numbers are checked before the Claude searches.

**What it costs to build:** nothing but time, except D3, the volume test, at about US$20 to US$25 (**TBC**). It needs Al-khair's OK.

**What it costs to run:** about US$1.20 per good lead today. That figure comes from one run: 3 good leads (1 Pass and 2 Director review) for US$3.60. So 100 good leads would cost about US$120 every 2 weeks, inside Levi's range. D3 measures it properly.

## Words used here

- **Good lead:** a Pass or a Director review. Watch and Drop are not counted.
- **Sign:** what the code calls a trigger. It is a sign of an office change, like a lease ending.
- **Slice:** one discovery search, for one sign in one city.
- **Floor:** the new `staff_floor` (50). Below it, a company is too small unless it is growing.
- **Rival:** a competitor of a good lead, in the same city.
- **Review page:** Results for one run (`/results?run_id=...`, which exists today), with tick boxes to approve or reject.

## How to work this plan

- **At the start of a session:** read this section, run `git switch plan-v9`, find the first step that isn't ticked, and run `brain context`.
- **Ticking a step:** tick it when its "Done when" is true, with the date and the commit. Then update **Progress** and **Last updated**, and add a line to the Log.
- **One heavy thing at a time:** use `bash engine/scripts/heavy.sh <cmd>`, because the laptop is short of memory. Make small commits, and run `git branch --show-current` before each one.
- **Only on Al-khair's word:** anything that costs money, sends a real email, writes to HubSpot, deploys, merges or pushes.
- **Rules files:** don't edit them while the full test run is going (the tests read them from disk). After a rules change, run `uv run lead-finder rejudge` (read only, free) to see which saved leads would change.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain with brain-save. At 95%, start no new step.

## Part A: Get ready

- [x] **A1. The branch and the baseline.** (2026-11-08, `9ce0d99`) Make `plan-v9` from `master`. Run the full backend suite (`RUN_GATES=1`) and the website checks, and write the numbers in the Log. **Done when:** both pass and the numbers are in the Log.
- [ ] **A2. Deploy what's waiting, and watch the memory.** **Al-khair's call.** Deploy `master`: the take-over change `83b9659` is pushed but not live. During one live run, read the backend's peak memory in DigitalOcean's Insights. Move to a bigger size only if the peak is above about 80% (that costs money, **TBC**). **Done when:** PLAN-V8 B3 is ticked, and the peak memory is in the Log.
- [ ] **A3. Ask Levi.** Put these in the 5 Nov requirements email:
  - the staff numbers (50 and 75);
  - who gets the run email;
  - who reviews;
  - the booming industries, including which kinds of mining;
  - whether rivals with no news of their own are wanted.

  **Done when:** the email is sent. Build with the proposals below until he answers.

## Part B: Better leads (the rules)

- [x] **B1. The size rule.** (2026-11-08, `5a3e8c5`) This only changes a size worked out from staff. A known office size keeps today's rule.

  | Staff in the city | Today | New |
  |---|---|---|
  | Under 50 (`staff_floor`) | flag, can still Pass | Drop, "too small" |
  | 50 to 74 | flag, can still Pass | Watch, with the "check office size" flag |
  | 75+ | ok | ok (no change) |

  A growing company still fits, as today: a plan to hire, needing 1,000 m² or more within 24 months (`_growing`). That's why a 4-person company showed as a Pass: a size "flag" never stopped a Pass (`judge` in `scoring.py`).
  - **Files:** `rules/criteria.yaml` (`staff_floor: 50`), `rules.py` (floor ≤ hint ≤ `staff_min`), `scoring.py` (`_size`, `judge`), `tests/lead_finder/test_scoring.py`, `test_rules.py`, `Criteria_v2.md`.
  - **Done when:**
    - the tests cover all three rows and a growing company of 30 staff;
    - `rejudge` lists the dev leads that change;
    - the numbers say **TBC** until Levi's team confirms them.
- [x] **B2. Don't pay to research tiny companies.** (2026-11-08, `281dfac`) Today the staff numbers from HubSpot and Signal Hire are read at the end (step 5 in `research.py`), after the Claude searches. Read them first instead.
  - If every known number is under the floor, and the discovery sign isn't a growth sign (`fast_growth`, `big_new_contract`, `new_to_australia`, `hot_industry_growth`), stop.
  - Save a short Drop, "too small: 12 staff (HubSpot)", with no Claude request.
  - The next run skips it, as it does any fresh lead (`memory_fresh_days`, 30 days).
  - This saves about US$0.34 to US$0.42 per tiny company. Signal Hire's count uses its daily search quota, not credits, and it is asked anyway today.
  - **Files:** `research.py`, `headcount.py`, `office_numbers.py`, tests.
  - **Done when:** a test with a fake Signal Hire saying 4 staff makes no Claude request, and the card says why.
- [x] **B3. New sign: new to Australia.** (2026-11-08, `af8f80c`) Add the sign `new_to_australia`: "An overseas company opening its first or a much bigger office in an Australian city".
  - Add it to `main` in `criteria.yaml`, so the schedules use it (**TBC** with Levi).
  - Add 2 or 3 discovery searches in `rules/queries.yaml`. Examples: "international company opens first Australian office {city}", "{city} global firm Australian headquarters {year}".
  - **Size:** the extract prompt fills `growth_plan`, `size_needed_m2` and `growth_by` from the staff or office they announce in Australia. The existing growing rule then judges it, so there's no new size code. Today's headcount here is near zero, so the size rule alone would drop them.
  - It still needs a named Australian city (30 Oct decision).
  - **Done when:**
    - a test company, "Sample Nordic Energy, 120 staff in Adelaide by 2027", passes as growing;
    - one with no Australian city goes to a Director;
    - the Start page shows the sign.
- [x] **B4. New sign: growing with a booming industry.** (2026-11-08, `af8f80c`) Add the sign `hot_industry_growth`: "Growing because its industry is booming". Add it to `main` (**TBC**).
  - Its searches in `queries.yaml` name the industries, one search each. Examples: "{city} energy transition company expansion {year}", "{city} defence contractor new office {year}", "{city} critical minerals company expansion {year}".
  - **To add an industry later:** add a line to that list. No code changes.
  - Energy and mining are tier 1 and defence is tier 2 already, so these leads also score higher.
  - **Done when:**
    - the rules check passes (every sign needs a search);
    - a test shows the sign on a lead;
    - the Rules page lists it.
- [x] **B5. Rivals of a booming company.** (2026-11-08, `a059570`, card `2c4040c`) When a lead in a tier 1 or tier 2 industry is a good lead, one cheap Claude web search names up to 5 Australian rivals with an office in the same city.
  - Save them in a new table `lead_finder.rivals`: name, website, city, which lead, the date, and pending, used or skipped. One migration, the next free number (0013 today).
  - The lead card shows "Rivals to check".
  - The next discovery run for that city adds up to 5 pending rivals to its list, with the weak sign `rival_growth`: "A rival of a booming company". A weak sign earns few points, so real news still ranks first.
  - Rivals already researched, or with an open deal in HubSpot, are skipped by the rules that exist today.
  - **Cost:** one search per good lead in those industries, about US$0.05 to US$0.10 (**TBC**), plus the normal research of each rival.
  - **Files:** new `rivals.py`, `tables.py` and the migration, `steps/graph.py` (`plan` adds the rivals), `criteria.yaml`, the card's Research tab.
  - **Done when:** in a fake run where "Sample Energy" passes, 3 rivals are saved. The next fake run researches them first, with the sign "rival of Sample Energy", and they show on the card.

## Part C: Runs by themselves, and Levi reviews

- [ ] **C1. Sending email, in the core.** (Built 2026-11-08, `4cd37d3`. Left: one real email to Al-khair, on his word, once Resend's key and sender are set.) Add `core/email/` with one `send(to, subject, text, html)` and two kinds of sender:
  - `resend`: Resend's web API, with the HTTP client we already use. Contour already pays for Resend (Levi, 2 Nov). Access to that account is **TBC**.
  - `log`: writes the email to the log, for the laptop and the tests.

  Settings: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `APP_URL` (the live site's address, for links). A command, `engine email-test --to <address>`, sends one test email.
  - **Done when:** the tests pass with the log sender, and one real email reaches Al-khair (on his word).
  - **Not confirmed:** sending from a contourinteriors.com.au address needs DNS records on Contour's domain (Dawn or IT). Outlook through Microsoft's API can come later, when Levi gives Outlook admin.
- [x] **C2. The run email.** (2026-11-08, `c79e39b`) When a scheduled run ends, email the addresses in a new setting, `lead_finder.notify_emails` (Levi, **TBC**). Hand-started runs don't email, so tests don't spam Levi.
  - **What it shows:**
    - the city and the number of good leads, Watch and Drop;
    - the cost, and the cost per good lead;
    - the top 5 good leads, each with one line on why it fits;
    - a **Review the leads** button that opens the review page.
  - A run that stops or fails sends a short email saying why.
  - **Done when:** a fake scheduled run sends one email (log sender) with the right numbers and link, and a stopped run sends the "why" email.
- [ ] **C3. The review page.** (Built 2026-11-08, `5a391bb`, `2c4040c`. Left: the check in the browser, laptop and phone, light and dark.) Results for one run gets tick boxes and a bar with three actions:
  - **Approve and send to HubSpot:** a new endpoint sends each ticked lead with the existing writer, which already has the once-only key and the write log. It reports any lead that failed, one by one.
  - **Reject:** asks why (D1).
  - **Watch.**

  While HubSpot writing is off (PLAN-V5 F1 to F3), the send button is greyed out with "HubSpot writing is off", and Reject and Watch still work.
  - **Done when:** the tests pass on the fake HubSpot (including one failed lead in a batch), and it is checked in the browser on a laptop and a phone, light and dark.
- [x] **C4. Four cities on a schedule.** (2026-11-08, `af8f80c`, migration 0013 in `a059570`) Swap the one default schedule (Mondays, 3 cities, off) for four, one per city, on different days of the same fortnight, at 7:00 am Melbourne time (**TBC**):

  | City | Day |
  |---|---|
  | Melbourne | Monday |
  | Adelaide | Tuesday |
  | Perth | Wednesday |
  | Sydney | Thursday (still goes to Director review) |

  Each saves its city, the main signs including B3 and B4, and 14 days of look-back. Built with its own company limit of 20; D4 replaces that limit with a goal. All stay off until Al-khair switches them on.
  - **Why separate days:**
    - only one run goes at a time;
    - the daily limit is US$50;
    - the server's memory is small;
    - each email stays short.
  - **Files:** `jobs.py` (`DEFAULT_CADENCE`, `DEFAULT_SETTINGS`), a one-off change for the live database's existing schedule, and tests.
  - **Done when:** the tests show the four schedules, and the Schedules tab lists them, all off.

## Part D: More good leads for the money

- [ ] **D1. Reject reasons.** (Built 2026-11-08, `a059570`, `2c4040c`. Left: the check in the browser.) Rejecting a lead asks why:
  - too small;
  - wrong industry;
  - already talking to them;
  - bad timing;
  - not a real sign;
  - other, with a note.

  Save it on the lead (`reject_reason`, `reject_note`, in the same migration as B5). Admin's Runs tab shows the count by reason for the last 90 days.
  - **Why:** it tells us which rule to change, with numbers.
  - **Done when:** the tests cover saving and counting, and it is checked in the browser.
- [x] **D2. Cost per good lead.** (2026-11-08, `2c4040c`) Show the number of good leads and the cost per good lead on the run page, the Runs list and the Home card. It's free: the run already keeps its counts by result and its cost.
  - **Done when:** the tests cover a run with none (shown as "no good leads yet") and one with 3.
- [ ] **D3. The volume test.** **Costs money: about US$20 to US$25 (TBC), only on Al-khair's word.** Run Melbourne once with the new rules at 50 companies.
  - Write in the Log: good leads, cost per good lead, minutes taken and peak memory.
  - Then set each city's company limit so the 4 cities give about 100 good leads per fortnight within US$100 to US$200.
  - One run can't go over US$50 (`hard_run_cap_usd`), so the limit per city stays at or under that.
  - **Done when:** the numbers are in the Log and the four schedules have their limits.
- [x] **D4. Limits for manual and automatic runs.** (2026-11-09) Agreed with Al-khair on 9 Nov. Built before D3, at his word; D3's numbers can still change the limits on the Settings page.

  **The idea.** Manual runs keep low limits, because a person can start one as often as they like. Automatic runs have no working limit: they aim for a goal, with high safety brakes. A safety brake is like a fuse: it never trips unless something goes wrong, like Claude repeating a search.

  | Limit | Manual run (Start page) | Automatic run (the 4 schedules) |
  |---|---|---|
  | One company | US$2.50, as today | US$2.50, the same |
  | How many companies | 20, as today. Al-khair changes it in Settings (up to 100) | No set number. It goes on until its goal, or until no company is left (about 60 at most in one city) |
  | One run | US$20, as today. Al-khair changes it in Settings (up to US$50) | US$150 (Al-khair, 9 Nov). On the Settings page, up to US$200 |
  | One day, all runs together | US$150 (was US$50). On the Settings page, up to US$300 | (the same) |

  **An automatic run stops at whichever comes first:**
  1. its goal: 25 good leads for its city, so 100 across the 4 cities;
  2. no company left to research;
  3. the run's money limit, US$150;
  4. the day's limit, US$150.

  **The goal carries over.** The run counts the good leads of the fortnight so far. A city that falls short leaves more for the cities after it. Example: Melbourne finds 18 on Monday, so Adelaide, Perth and Sydney share the other 82.

  **What it should cost** (from one real run, **TBC** until D3): a company about US$0.40, a city run about US$25 to US$30, a fortnight about US$100 to US$120 for about 100 good leads. That is inside Levi's US$100 to US$200.

  **Who controls what:**
  - The Settings page (Al-khair): the manual run's money limit and company count, as today; the automatic run's limit (US$150); the day's limit (US$150); and the goal (100 good leads a round).
  - `engine/.env` (on App Platform, its variables): the ceilings the page can't pass, to stop a typo: US$200 for an automatic run (`HARD_SCHEDULED_RUN_CAP_USD`) and US$300 a day (`HARD_DAILY_CAP_USD`), **TBC**. They change only with a restart.
  - A round is the city runs of the last 7 days: Monday to Thursday sit inside one week, and the next round starts 2 weeks on. If the schedules' days are spread over more than a week, the carry-over counts less than it should.

  **The run email** says how far the fortnight is, like "62 of 100 good leads so far, US$80 spent". The tool can't promise 100: it finds only companies with news. A quiet fortnight may give about 70, and the email says so. Then Al-khair can widen the search (more signs, a longer look-back).

  **Unchanged:** up to 12 web searches for one company, 6 searches per city to find companies (one per sign), one run at a time, each city every 2 weeks.

  - **Files:** `core/config.py` and `core/prefs/service.py` (the new settings), `core/runs` (an automatic run's limits, its estimate and its resume), `goal.py` (the share of the goal), `jobs.py` (no company limit of its own), `steps/graph.py` and `steps/company.py` (stop at the goal), `run_email.py` (the round so far), `tests/lead_finder/test_goal.py`.
  - **Done when:**
    - a test shows a scheduled run that stops at its goal, and one that stops when no company is left;
    - a test shows a manual run still stopping at its company count and money limit;
    - a test shows the goal carrying over from one city to the next;
    - the run email shows the fortnight so far.
  - **Waiting on Levi (TBC):** whether the goal is 100 or 90 good leads a fortnight.

## Part E: Access, check and merge

- [x] **E1. Lead Finder access.** (2026-11-08, `497a74e`, `2c4040c`) Add a Lead Finder tick to each account. An Admin sees everything. A `staff` user without the tick doesn't see the Lead Finder in the sidebar, and gets a 403 on every Lead Finder route.
  - Admin gets a People tab: add a person (name, email, role, the tick, a starting password under today's rules).
  - Changing your own password is PLAN-V6 C4, still open.
  - **Files:**
    - `core/auth` (the user's app list, in the B5 migration);
    - a `require_app("lead_finder")` check in `core/api`;
    - the Lead Finder routers;
    - `src/modules.ts` and the sidebar;
    - the new Admin tab.

    Call prep will use the same tick ([projects/prep/PREP.md](../projects/prep/PREP.md)).
  - **Done when:**
    - a test walks every Lead Finder route as a user without the tick and gets 403 each time;
    - with the tick, it gets 200;
    - the sidebar hides it.
  - Levi's two other people get accounts once he names them.
- [ ] **E2. The full check.** (Suites, lint, types, build and openapi.json done 2026-11-08. Left: the browser check.)
  - Run the backend suite with `RUN_GATES=1`, then the website tests, lint, types and build, and regenerate `openapi.json`.
  - In the browser, on the fake backend, check the Start page (new signs), a lead card (rivals), the review page, Schedules, People and the run email in the log. Check a laptop and a phone, light and dark.
  - **Done when:** all pass, with the numbers in the Log.
- [ ] **E3. Docs, merge and switch on.** (Docs done 2026-11-08. Left: merge, push and deploy on Al-khair's word, then D3, then switching on.)
  - Update the docs: `engine/AGENTS.md`, `Criteria_v2.md` (size rule, new signs, rivals), the run book (email settings) and the Rules page text.
  - Merge into `master` and push, both on Al-khair's word, then deploy.
  - Switch on the four schedules after D3 and D4.
  - **Done when:** the first scheduled run's email reaches Levi.

## Waiting on

- **Levi:**
  - the staff numbers;
  - who gets the email, and who reviews;
  - which industries and kinds of mining;
  - whether rivals with no news are wanted;
  - whether the new signs are main signs;
  - the names of the two other people;
  - the HubSpot admin adding write access (PLAN-V5 F1).
- **Al-khair:**
  - the deploy (A2) and a bigger server if needed;
  - access to Contour's Resend account and the sender address;
  - the spend for D3;
  - switching on the schedules.
- **Dawn or IT:** the domain, and DNS records so email can come from a Contour address.

## Risks

- **Email may land in spam, or not send,** without a sender address on a domain we control. Until then, test with Al-khair's own address.
- **A stale HubSpot staff number could stop a good company** in B2. The card says which number stopped it. A recheck run ignores fresh leads, and B2 only stops when every known number is under the floor.
- **Rivals may bring weak leads.** At most 5 per run, ranked below real news. D1's reasons will show whether they help.
- **The new size rule drops leads that show as Pass today.** `rejudge` shows which ones before the merge.
- **A missed route in E1 would show Lead Finder data** to people without the tick. That's why a test walks every route.
- **Bigger runs need more memory.** Separate days and the A2 check keep this in view.

## Not in this plan

- Turning on HubSpot writing: PLAN-V5 F1 to F3. Until then, C3 can't send.
- The paid checks still open in [PLAN-V4.md](PLAN-V4.md): B5, D1 and D2.
- Call prep: [projects/prep/PREP.md](../projects/prep/PREP.md). It is the next project, and reuses E1.
- Editing the rules from the website. When Levi's team decides a number, we change the rules file. It takes minutes.
- Sending through Outlook. It comes later, when Levi gives Outlook admin.

## Log

Newest first.

- 2026-11-09: **Merged into `master`** by fast-forward, at Al-khair's word. Not pushed, not deployed (E3 left: push and deploy on his word, D3, then switching the schedules on).

- 2026-11-09: **D4 built.** An automatic run gets US$150 and up to 100 companies (`make_caps(scheduled=True)`, also in its estimate and its resume), aims for its share of the round's 100 good leads (`goal.py`), and skips the companies left once it has it ("the run reached its goal of N good leads"). A run a person starts keeps US$20 and 20 companies. The day's limit is US$150 and is on the Settings page now; the ceilings are US$200 a run and US$300 a day in .env. A run now gives the shared Claude the Settings page's values when it starts, so a schedule after a restart uses them too. The run email says how far the round is. Tests: `test_goal.py` (14), including the real scheduler loop starting a run with these limits and waiting 14 days. Backend `RUN_GATES=1`: 3,270 passed, 1 failed, 25 skipped; the one failure (`test_cancel_mid_run_keeps_what_finished_and_marks_it_cancelled`) is a timing test that passed 5 times in a row on its own, with about 800 MB free during the full run.

- 2026-11-09: **D4 added, not built.** Al-khair stopped a change that raised the defaults to US$50 and 50 companies (nothing was changed). Agreed instead: manual runs keep their limits in Settings; automatic runs aim for 100 good leads a fortnight, 25 per city, with safety brakes of US$100 a run and US$150 a day. Build after D3.

- 2026-11-08: **The local system, real (not the fake backend).** `python -m core.cli serve` on the dev database (it migrated to 0013) and `npm run dev`. Checked through the API the pages use: the Start page starts with Melbourne and the 6 main signs, and doesn't offer `rival_growth`; Schedules lists the four cities, all off, each about US$7.71 a run at past prices; the last real run (Perth and Sydney) shows 8 good leads for US$6.36, US$0.79 each, with sending greyed out ("HubSpot writing is off"); People lists the laptop Admin. Not checked: the pages in a browser (the Chrome extension wasn't connected). No run was started, so nothing was spent.
- 2026-11-08: **E2 checks.** Backend `RUN_GATES=1`: 3,253 passed, 25 skipped (5 min). Website: 885 tests, lint, types, build. `openapi.json` and `schema/SCHEMA-0013.md` match.
- 2026-11-08: **Decisions while building** (for Al-khair to look at):
  - The Start page starts with **Melbourne only**: the 6 main signs in the 3 pass cities make 18 searches, and the default limits allow 13. The flow test still runs 3 cities with the first 4 signs.
  - Each city schedule saves a **company limit of 20** until D3 sets it. At today's placeholder prices (a new database) a run looks like US$22.40, over the US$20 run limit, so a schedule on a new database waits until there are past prices.
  - **Old reject reasons** (free text) moved to the new note, with the reason "other" (migration 0013).
  - **B2 applies to every research**, not only runs: a typed company with tiny HubSpot or Signal Hire numbers is a Drop too. A growth sign from discovery always goes ahead.
  - **E1 also guards the core routes** that show Lead Finder data: runs, the search log and memory. A list with no project named needs every project.
  - **The run email** is sent by a new `finished` hook on the run kind, after the run's last write; it never changes the run. An interrupted run sends none (it carries on later).
  - The sign-in log gained `account_changed`, for a change on the People tab.
- 2026-11-08: **App Control** blocked `engine.exe` and `mypy.exe` (os error 4551). On Al-khair's word: `uv run --no-sync python -m core.cli <command>` and `python -m mypy`; the commit hook now runs `python -m mypy`.
- 2026-11-08: **B1 `rejudge`** on the 52 dev leads: 24 change. 3 from the new size rule: Acendre (28 staff, Pass to Drop), Euroz Hartleys Group (14, Director review to Drop), Razilio (22, Director review to Drop). Budget Direct (50) and JOEST Australia (66) are Watch. The other 19 changed because the HubSpot copy changed since they were saved (open deals now on record).
- 2026-11-08: **A1 baseline** on `plan-v9`: backend `RUN_GATES=1` 3,168 passed, 25 skipped (6 min); website 875 tests in 60 files, lint, types and build.

- 2026-11-08: Plan written from the 2 Nov and 5 Nov meetings. No code changed yet.
