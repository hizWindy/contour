# New leads only: plan, version 27

This plan makes the Lead Finder about new companies only. The Run tab keeps one run, Find new leads. A company already in HubSpot is left out, unless nobody has worked it for 12 months. The number of new leads a run finds must never go down: the places HubSpot companies used go to new ones. Property Daily stops finding companies: it only adds a sign to a company the news search found. Researching one named company moves to the Assistant ("Research Northwind"), which answers at once from what we already know and never slows anyone else. Results gets a button to add many leads to HubSpot at once. And a new way to research, a breadth × depth search loop ("Quick Deep Research"), must be deep, fast and informative. It is tested against today's research before anyone uses it. One session builds it, in five parts, after PLAN-V25 and PLAN-V26 are merged.

**TBC** means to be confirmed.

- **Status:** drafted on 23 Nov 2026 from Al-khair's chat. Approved by Al-khair on 24 Nov (`implement v27`), and being built on `plan-v27` in `../contour-v27`.
- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 25 Nov 2026.
- **Progress:** S0, T1-1, T1-2, T1-4, T2-2, T2-3, T3-1, T4-1, T4-3 and T5-1 done (24 Nov), and T3-3, T4-4 and T5-4 (25 Nov). Built and waiting: T1-3, T3-2 and T4-2 (Al-khair's look), T2-1 (S2's numbers). T5-2 (paid) and T5-3 wait for Al-khair.
- **Sources:**
  - Al-khair's chat on 23 Nov 2026: his six asks, then his note that Property Daily is one of the triggers, not a source of leads;
  - the code on `master` (`ff0f658`), read on 23 Nov;
  - the laptop's database, read on 23 Nov: the 52 companies the web found from 27 Oct to 2 Nov (counts only, no names);
  - PLAN-V21's cost estimates ("What it costs") and PLAN-V18's call prep cost;
  - Anthropic's models page, read on 23 Nov: Sonnet 5.5 is rated "Fast" and Opus 5.5 "Moderate", and Sonnet 5.5 costs half as much per token.
- **Comes after:** [PLAN-V25.md](PLAN-V25.md) (A smarter Assistant) and [PLAN-V26.md](PLAN-V26.md) (Admin tools and no more waiting), both being built now. This plan starts after both are merged. Part 4 builds on PLAN-V25's Assistant, and Part 5's Claude requests run in PLAN-V26's lanes.

## Why

The Lead Finder is meant to find new companies. Today it also brings back companies the team already has.

- **HubSpot companies come back.** A run leaves out a HubSpot company only if it has an open deal, or a deal dissolved in the last 12 months (`steps/choose.py`). Every other HubSpot company is researched and shown. On the laptop's runs (27 Oct to 2 Nov), only 17 of the 52 companies the web found were new to HubSpot. 29 were in it (24 of them with a deal), and 6 were maybes. So Results shows more leads than there are new ones.
- **HubSpot companies use up a run's target.** A run keeps searching until it has kept as many companies as its target (`_end_of_sweep` in `steps/graph.py`). HubSpot companies count toward it today, so a run can stop searching before it has found enough new ones.
- **Three of the four run types aren't about new companies.** Old offices and HubSpot watchlist research HubSpot companies. Companies by name researches the names a person types. And a Find new leads run that comes up short is topped up from the HubSpot watchlist (PLAN-V21 T1-6).
- **Property Daily finds companies.** Its new items become companies found, before the web search (PLAN-V21 T1-5). Al-khair's view: it is one of the triggers, not a source of leads.
- **Adding leads to HubSpot is one at a time.** Each lead has its own preview and Send (PLAN-V5 D4).
- **Research asks a fixed set of questions.** Each company gets one request per angle (property, people, money, dampeners), then one pass to fill gaps. It never asks a follow-up question from what it just found.

## Go signals

| Say | What it does |
|---|---|
| `implement v27` | Builds S0 to S3, Part 1 (new leads only), Part 2 (Property Daily as a trigger), Part 3 (add to HubSpot in bulk), Part 4 (research in the Assistant), then Part 5 (Quick Deep Research, a test) |
| `merge v27` | Checks everything, then moves `master` to `plan-v27` |
| `deploy v27` | Pushes `master`, deploys, and does the live check (M3) |

- `implement v27` starts only after `merge v25` and `merge v26`.
- Each screen waits for your look. Pushes, deploys, HubSpot writes and paid checks happen only on your own word in chat.

## Decided in chat (23 Nov)

These are Al-khair's asks. They are fixed for this plan.

1. **The Run tab is for new leads only.** Only "Find new leads" stays. Old offices, HubSpot watchlist and Companies by name leave it.
2. **No old leads.** A company already in HubSpot doesn't show in the Lead Finder, because "the essence of lead finder is for new lead".
3. **Property Daily is one of the triggers, not a source of leads.** It complements the news search. It never brings a company into a run.
4. **Researching one company moves to the Assistant.**
5. **Try a breadth × depth search loop** ("Quick Deep Research"). It must be deep, fast and informative: it finds more than today's research, it's no slower, and it shows what it finds as it goes.
6. **A button to add leads to HubSpot in bulk.**
7. **The number of new leads must never go down, or be put at risk.** Every change here is checked against it (choices 26 and 27, and M3).
8. **The Assistant is fast, with no fluff.** Speed is everything, without risking quality, and it never slows the rest of the system (choices 17 to 22 and 25).

## Words used here

- **New lead:** a company that isn't in HubSpot, or a quiet one (choice 3).
- **Quiet:** in HubSpot, but its last activity (the newest call, email, meeting, note or task) is more than 12 months old (**TBC with Levi**).
- **Maybe:** the matcher isn't sure. A name or profile is close to a HubSpot company, but the domain and the exact name don't match (`possible_match`).
- **Trigger:** a sign that a company may change office, like a lease ending or fast growth. "Trigger events" is Contour's own word.
- **Breadth × depth loop:** a search that goes N questions wide and D rounds deep. Each round's questions come from what the last round found. Example: breadth 3 and depth 2 asks 3 questions, then 2 follow-ups for each, so 9 in all.
- **Quick Deep Research:** this plan's name for that loop, at breadth 3 and depth 2, built to be fast (choice 21).

## What exists already (so nothing is built twice)

- **Run types** (`apps/lead-finder/start/`, `params.py`): `discovery` (Find new leads), `tenure` (Old offices), `watchlist` and `company` (Companies by name). `company` also serves the lead card's Re-check, and takes 1 to 25 companies. The city schedules (`round.py`) are Find new leads runs.
- **The HubSpot match** (`core/hubspot/matching.py`): each company is new, in HubSpot, open deal, dissolved deal, or a maybe with up to 3 candidates. The lead card's HubSpot tab lists a maybe's candidates and says "A person confirms", but has no button to confirm.
- **The skip rules** (`steps/choose.py`, `never_suggest` in `criteria.yaml`): an open deal; a deal dissolved in the last 12 months; a lead made in the last 30 days; a lead sent or rejected.
- **The top up** from the HubSpot watchlist (`steps/top_up.py`).
- **Property Daily, in two places:**
  - finding companies (`run_sources.py`): the feed, reading new emails first, and the Start page's "where to look";
  - research (`property.py`, `core/sources/reader.lookup_company`): up to 60 live pages a run. Its office size, lease end and move-in date come first (`data_sources` in `criteria.yaml`).
- **Send one lead to HubSpot** (`api_hubspot.py`, `hubspot_send.py`, `core/hubspot/writer.py`, `lead/send-lead.tsx`): a preview, then it makes the company (or fills its empty fields), adds a note and puts it in a list. It needs `HUBSPOT_WRITE_ENABLED`, which is off by default.
- **The Assistant** (`apps/companies/api_assistant.py`): pre-read, log a call, task, email, open a page, change, send and cancel. It has no research. Call prep (`api_preps.py`) researches a HubSpot company for a call: up to US$0.25, and free if it was prepped in the last 7 days (PLAN-V18).
- **Our HubSpot copy** keeps each company's last activity date (`last_activity` in `core/hubspot/models.py`, PLAN-V18 T1-3).
- **The test set:** 10 public companies (`testset.yaml`).

## Choices made for you

**Part 1: new leads only**

1. **The Run tab shows Find new leads only.** It opens straight on its form, with no run type to pick.
2. **Old offices and HubSpot watchlist are switched off, not deleted** (recommended; Al-khair confirms, A3). The website doesn't offer them, and the API answers 409 "This run type is switched off". Their code and tests stay, so they can come back. Old offices was Levi's ask (9 Nov), so he is told (S1).
3. **A HubSpot company is left out before research,** so it costs nothing. It's left out if it has an open deal, a deal dissolved in the last 12 months, or any activity in the last 12 months (**TBC with Levi**). A quiet one stays in, and its card says "In HubSpot, quiet since March 2025".
   - The 12 is a setting, `hubspot_quiet_months`. 0 leaves out every HubSpot company, as in Al-khair's first ask (A2).
4. **A maybe stays,** with its candidates. The HubSpot tab gets two buttons: "Same company" and "It's new". "Same company" links the lead to that HubSpot company, and choice 3 then decides if it stays.
5. **The top up from the HubSpot watchlist goes.** A run that comes up short says so: "Found 31 of 50. Try a longer look-back or more places."
6. **Results shows new leads by default.** Leads from older runs that are in HubSpot hide behind a chip, "In HubSpot (8)".
7. **Each run says what it left out,** in one line of its feed: "Left out 12 companies already in HubSpot."

**Part 2: Property Daily as a trigger**

8. **Companies are found on the web only.** The feed step and the new-emails-first step go, and so does the Start page's "where to look". A saved choice is ignored. This ships only if it costs no new lead (choice 27). If S2 shows Property Daily's items alone found new companies, they keep coming in, as triggers, until Al-khair decides (A6).
9. **The research still checks Property Daily** for each company the web found:
   - a lease ending in 12 to 36 months, a search for space or a move still to come adds a sign;
   - a fitout already done, or given to a firm, counts against the company.

   Each shows on the card with "Property Daily" as its source.
10. **Its facts stay as they are.** When Property Daily and the web disagree on a lease end, size or move-in date, Property Daily still wins (Levi's order, PLAN-V16), because a lease record beats a web guess.
11. **Its two schedule jobs stay as they are.** They fill our copy, which the research reads first.

**Part 3: add to HubSpot in bulk**

12. **Tick boxes on Results,** with "Select all on this page". A bar shows "3 selected" and "Add to HubSpot".
13. **One preview for the batch:** each lead, with "New company" or "Fills 2 empty fields in Northwind", the owner and the list. At most 25 a batch (**TBC**).
14. **A 5-second hold after Send,** with Undo, as the Assistant's send has. Then each lead goes through the same writer as a single send, one at a time, with its own result.
15. **The owner** is the person who presses Send, if they have a HubSpot user (PLAN-V23). Otherwise there is no owner (**TBC with Levi**, A4).
16. **Who may:** the same people who may send one lead today.

**Part 4: research in the Assistant**

17. **"Research Northwind",** said or typed. The Assistant answers at once from what we already know, before any Claude request and for free: the HubSpot status, the last lead card, and Property Daily's lease end and size from our copy, each with its date (**TBC**: under 1 second).
18. **What happens next:**
    - **A lead card from the last 30 days:** it opens at once. No new research, and no cost.
    - **In HubSpot and not quiet:** it opens the company's call prep, as Companies does.
    - **New or quiet:** under what we know, the card asks "Research Northwind? About US$0.40." Enter, "yes" or a tap starts a run of one company. It's the only question the Assistant asks, because it spends money.
    - **A maybe:** the card shows its best guess first, with PLAN-V25's suggestion part.
19. **It runs in the background.** The Assistant takes the next command at once. Each finding shows as it arrives, as one line with its source. At the end: "Done: Northwind is a B lead.", with "Open the lead card" and "Add to HubSpot".
20. **A new company needs the Lead Finder tick** (PLAN-V19). Without it: "Researching a new company needs the Lead Finder. Ask your Platform admin." Each research counts against the company cap, the run cap and the daily limit, as a run does.
    - **It never slows anyone else.** A research started by a person uses at most 2 Claude places at once (**TBC**), so others' call prep and commands still get through in PLAN-V26's People lane. A command or a call note waiting for a place goes ahead of research questions. Lead Finder runs keep their own lane.

**Part 5: Quick Deep Research (a test)**

21. **The loop, built to be fast:** breadth 3 and depth 2. Each question is one Claude request with web search, at most 3 searches each (**TBC**). After each request, Claude notes what it learned and the next questions.
    - **No waiting for a whole round,** and at most 2 at once (choice 20). Each follow-up starts as soon as its own answer arrives and a place is free. So the 9 questions take about 5 answers in a row, on the faster Sonnet 5.5. Today's research, also 2 at once (`claude_concurrency`), takes about 3 in a row on Opus 5.5: its 4 angles, then a gap search. The test checks which is faster (choice 25).
    - **Nothing asked twice.** The first questions come from what memory, Signal Hire, the Property Daily lookup and our HubSpot copy didn't answer. A follow-up that asks what's already known is dropped.
    - **A faster model for the questions:** Sonnet 5.5 (a new setting, `model_deep`), which call prep already uses. Anthropic rates it "Fast", against "Moderate" for Opus 5.5, at half the price per token. The last step, which fills the facts, stays on Opus 5.5 at `medium`, as today.
22. **The same output, shown as it's found.** Only the search changes. Memory, Signal Hire, the Property Daily lookup (its facts still win), the HubSpot match and the score stay as they are. The loop's last step fills the same facts form today's research fills, with a source link for every fact. So the score and the card don't change.
    - Each finding shows in the Assistant as it arrives (choice 19), with the question asked next. Example: "Found: Northwind hired 40 staff this year (news.example.com). Now checking: a second office?" The findings are saved as the research's notes, as today's are.
23. **The same guards:** the company cap, the cleaning of web pages (`sanitize.py`) and the rules on names.
24. **A test before any use.** Both kinds of research run on the 10 test companies. A person checks each fact against its source.
25. **The keep rule** (**TBC**, A5): the Assistant's research uses the loop only if, on the 10 test companies, it:
    - finds at least 20% more right facts;
    - is no slower than today's research (the middle time of the 10), and shows its first finding within 1 minute (**TBC**);
    - costs at most 3 times as much.

    Using it in every run is a later plan.

**New-lead volume (every part)**

26. **A sure match only.** A company is left out only when the match is sure: the HubSpot id, the domain, or the exact name in the same city. The exact name in another city is treated as a maybe, so a different company with the same name is never left out.
27. **The replay check** (free, no AI). Before Part 1 and Part 2 ship, the step that picks which companies to research (`choose`) runs again on the companies S2's live runs found, with today's rules and with the new ones. The new rules must keep at least as many companies that aren't in HubSpot. (**TBC**: if a run's found companies aren't saved, a made-up set shaped like them.)

## Words on screen

- **Run tab and Results:** "Find new leads: search the news for companies with a sign of an office change. Companies already in HubSpot are left out." Then "Left out 12 companies already in HubSpot.", "In HubSpot (8)" and "In HubSpot, quiet since March 2025".
- **A maybe:** "Same company" and "It's new".
- **Bulk add:** "3 selected", "Add to HubSpot", "Sending in 5 s. Undo" and "2 added. 1 failed: HubSpot refused the website."
- **The Assistant:** "Northwind: not in HubSpot. Property Daily, 3 Oct: lease ends March 2028.", "Research Northwind? About US$0.40.", "Northwind is in HubSpot. Opening its call prep.", "Found: Northwind hired 40 staff this year (news.example.com).", "Now checking: a second office?" and "Researching a new company needs the Lead Finder. Ask your Platform admin."

## What it costs

- **To build:** time only.
- **To run, Part 1:** HubSpot companies are no longer researched, which saves about US$0.34 to 0.42 each (PLAN-V21's estimate at `medium`). But a run may need more search sweeps to reach its target, at about US$1.20 a sweep. The run cap doesn't change.
- **The Assistant's research:** about US$0.34 to 0.42 for a new company, or at most 3 times that if the loop is kept (choice 25). A HubSpot company's call prep is up to US$0.25, and free if it was prepped in the last 7 days.
- **The test (T5-2), on Al-khair's word:** about US$14 (**TBC**): the 10 test companies with today's research (about US$4) and with the loop (about US$10, estimated at 2 to 3 times today's). With its questions on Sonnet 5.5, at half Opus 5.5's price per token, it should cost less than that; the test measures it. It is capped at US$20.
- **Bulk add and new packages:** no AI cost (HubSpot calls only), and no new packages.

## Who builds it

One session builds every step, in order: S0 to S3, then Parts 1 to 5. Parts 1 and 3 share Results, and Parts 4 and 5 share the research, so two sessions would wait on each other.

- **Lead Finder rules** (`choose.py`, `criteria.yaml`, `run_sources.py`): the `rule-change` skill, with its free checks.
- **Backend and website steps:** `backend-agent` with the `api-change` skill; `frontend-agent` with the `ui-build` and `design-review` skills.
- **Cross-layer checks:** the `flow-trace` skill on the bulk add and the Assistant's research, and the `security-check` skill on the HubSpot write.
- **No migration expected** (**TBC**): "quiet" is a new value in the lead's existing HubSpot status. If one is needed after all, it follows PLAN-V26's.
- **M1's independent check:** a fresh `review-agent` with the `merge-check` skill, and the `simulator-agent` on the new flows.

## How to work this plan

As [PLAN-V25](PLAN-V25.md)'s "How to work this plan", with these changes:

- **The copy:** `git worktree add ../contour-v27 -b plan-v27 master`, after `merge v25` and `merge v26`.
- **Ports and database:** backend `API_PORT=8141`, website 5311 (**TBC**: check they're free), database `leadfinder_v27` (a copy of the dev database at `master`'s newest migration), test suffix `_v27`. Leave older plans' ports alone.
- **One copy only.** No helper copies. Agents work in this copy one at a time.
- **No Claude key and no HubSpot key** in the copy. The one exception is T5-2's paid test, on Al-khair's word.
- **Made-up names only,** like "Northwind" and "Jo Sample". Check any new example name against our copy before a commit (the `github` skill, "Never on GitHub").

## Before the build starts

- [x] **S0. The branch and the copy** (after `merge v25` and `merge v26`). Done 24 Nov 2026 (this plan's first commit on `plan-v27`). The plan list line waits for M4 (see the Log).
  - Make `plan-v27` from `master` in `../contour-v27`. Its first commit holds this plan.
  - Add the plan's line to the plan list. If Al-khair's move of the list from `CLAUDE.md` to `AGENTS.md` is still uncommitted, ask first.
  - Make the database `leadfinder_v27`, and check the newest migration.
  - **Done when:** `plan-v27` holds this plan, and the fast backend tests and the website tests pass on it.
- [ ] **S1. Levi** (**TBC with Levi**), about 10 minutes:
  - Old offices and HubSpot watchlist leave the Run tab (he asked for Old offices on 9 Nov).
  - A quiet HubSpot company (no activity in 12 months) counts as new (choice 3).
  - Who owns the companies added in bulk (choice 15).
  - He is told that Property Daily no longer finds companies. It only adds signs.
  - **Done when:** the Log has his answers, and choices 2, 3 and 15 match them.
- [ ] **S2. The live numbers** (free, read-only), before Part 1.
  - For the last 30 days of runs on live, count the companies found by HubSpot status (new, in HubSpot, maybe, open deal, dissolved deal). Count how many of those in HubSpot were quiet for 12 months, and how many new companies came only from Property Daily items (the web didn't find them).
  - Read them through the live API or a read-only query (the `digitalocean` skill). No names in the Log.
  - Save the companies found, for the replay check (choice 27), in the copy's database only, never in git.
  - **Done when:** the Log has the counts, and the replay check has its companies.
- [ ] **S3. HubSpot write on live** (Al-khair, about 5 minutes, before M2). Is `HUBSPOT_WRITE_ENABLED` on, and may the HubSpot private app write companies, notes and lists?
  - **Done when:** the Log says yes, or what is missing.

## Part 1: new leads only

- [x] **T1-1. One run type.** Done 24 Nov 2026 (see the Log for the commit). (`apps/lead-finder/start/`, `home-words.ts`, `lib/labels.ts`, the run options route, `params.py`). Choices 1 and 2.
  - **Done when:** tests pass: the Start page opens on Find new leads, with no type to pick; the run options list only `discovery`; starting `tenure` or `watchlist` answers 409 while they're off; Re-check (mode `company`) works as before; and a city round runs as before. The contract and the website's types are made again.
- [x] **T1-2. Leave out HubSpot companies.** Done 24 Nov 2026, with the replay check on a made-up set until S2 (see the Log). (`steps/choose.py`, `never_suggest` in `criteria.yaml`, the settings, `steps/top_up.py` and where it's called). Choices 3, 5 and 7.
  - **Done when:** tests with a made-up HubSpot copy pass: a HubSpot company with activity 2 months ago is left out before research; one quiet for 14 months is researched and labelled; `hubspot_quiet_months` 0 leaves out both; an open deal is left out as today; a maybe is researched; the top up never runs; the run's feed has the "Left out" line with the right count; the exact name in another city stays as a maybe (choice 26); the replay check keeps at least as many new companies (choice 27); and the `rule-change` skill's free checks pass.
- [ ] **T1-3. Results and the maybe buttons.** Built 24 Nov 2026; waits for Al-khair's look (see the Log). (`apps/lead-finder/results/`, `lead/card/tab-hubspot.tsx`, a route to confirm a match). Choices 4 and 6.
  - **Done when:** tests at 1440 and 390 px pass: Results hides in-HubSpot leads behind the chip, with the right count; the quiet label shows; "Same company" links the lead and hides it unless it's quiet; "It's new" keeps it; the choice stays after a reload; and Al-khair has looked.
- [x] **T1-4. Part 1 check.** Done 24 Nov 2026 (see the Log; 10 core tests need a data file the copy doesn't have). Website: lint, types, tests, build, `node scripts/bundle-report.js`. Backend: ruff, mypy, the fast tests and the Lead Finder tests.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 2: Property Daily as a trigger

- [ ] **T2-1. Find companies on the web only.** Built 24 Nov 2026 behind a switch; waits for S2 (see the Log). (`run_sources.py`, the run's plan step, `apps/lead-finder/start/discovery.tsx`, the run options). Choice 8.
  - **Done when:** tests pass: a run never turns a Property Daily item into a company found; it never reads new emails at the start; the Start page has no "where to look"; an old saved `sources` value is ignored; the replay check keeps at least as many new companies, or A6 is decided; and the contract is made again.
- [x] **T2-2. Property Daily adds signs.** Done 24 Nov 2026: no change, and the existing tests cover it (see the Log). (`property.py`, `research.py`: no change expected, so tests only). Choices 9 to 11.
  - **Done when:** tests pass: a company the web found, whose Property Daily record has a lease ending in 20 months, gets the lease ending sign with Property Daily as its source; a fitout given to a firm counts against it; and the lookup still stops at 60 live pages a run.
- [x] **T2-3. Part 2 check.** Done 24 Nov 2026, with T1-4 (see the Log). As T1-4, plus the run tests.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 3: add to HubSpot in bulk

- [x] **T3-1. The batch routes.** Done 24 Nov 2026 (`efd33a3`). (`api_hubspot.py`, beside the single send). Choices 13 to 16.
  - `POST /lead-finder/leads/hubspot/preview-many` takes up to 25 lead ids and previews each with the existing writer.
  - `POST /lead-finder/leads/hubspot/send-many` sends the previewed ones, one at a time.
  - **Done when:** tests with the fake HubSpot pass: each lead has its own result (sent, failed with words, or already sent); one failure doesn't stop the rest; a second call sends nothing twice (the writer's once-only key); the owner follows choice 15; 26 ids are refused; and someone who can't send one lead gets 403. The contract is made again.
- [ ] **T3-2. Tick, preview, send.** Built 24 Nov 2026; waits for Al-khair's look (see the Log). (`apps/lead-finder/results/`, a dialog, and the Assistant's 5-second hold, `hold.tsx`). Choices 12 to 14.
  - **Done when:** tests at 1440 and 390 px pass: ticking shows the bar; the preview lists each lead; Send waits 5 seconds with Undo; each row shows its result; the keyboard alone works; a screen reader hears the result once; and Al-khair has looked.
- [x] **T3-3. Part 3 check.** Done 25 Nov 2026 (see the Log). As T1-4, plus the contract gate (`RUN_GATES=1`), the `flow-trace` skill, and the `security-check` skill on the HubSpot write.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 4: research in the Assistant

- [x] **T4-1. The research command.** Done 24 Nov 2026 (see the Log). (`apps/companies/assistant_schemas.py`, `api_assistant.py`, the command prompt). Choices 17 and 18.
  - **Done when:** tests pass: "Research Northwind" becomes the `research` action; what we know shows before any Claude request; a lead card from the last 30 days opens with no Claude request; a HubSpot company with recent activity opens its call prep; a new or quiet one asks first; a maybe asks which company; "research" with no name asks for one; and Claude gets no more than the words said and the names found.
- [ ] **T4-2. The card and the progress.** Built 24 Nov 2026; waits for Al-khair's look (see the Log). (`apps/assistant/card/`). Choices 18 and 19.
  - **Done when:** tests at 1440 and 390 px pass: the card shows the cost line; Enter, "yes" or a tap starts a run of one company; the Assistant takes a new command while it runs; each finding shows as it arrives; the end shows the result with "Open the lead card" and "Add to HubSpot"; and Al-khair has looked.
- [x] **T4-3. Access and limits.** Done 24 Nov 2026 (see the Log). Choice 20.
  - **Done when:** tests pass: without the Lead Finder tick, the card says so and starts nothing; the caps and the daily limit stop it as they stop a run; a research never holds more than 2 Claude places; while one runs, another person's command starts at once; a waiting command goes ahead of waiting research questions; and a Viewer can't start it.
- [x] **T4-4. Part 4 check.** Done 25 Nov 2026, with T3-3. As T1-4, plus the `flow-trace` skill.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 5: Quick Deep Research (a test)

- [x] **T5-1. The loop.** Done 24 Nov 2026 (see the Log); `standard` stays on until T5-3. (a new `apps/lead_finder/deep.py` beside `research.py`; a setting `assistant_research_style`: `standard` or `deep`, `standard` by default; and a setting `model_deep`, Sonnet 5.5). Choices 21 to 23.
  - **Done when:** tests with saved sample answers pass: 3 questions, then 2 follow-ups for each; a follow-up starts as soon as its own answer arrives, not after the round; no more than 2 run at once; a follow-up that asks what's known is dropped; each finding reaches the Assistant as it's found; the questions use `model_deep` and the facts step Opus 5.5; it stops at the company cap; every fact has a source link; a web page that tries to give Claude orders changes nothing; and the facts form is the same as today's.
- [ ] **T5-2. The comparison** (paid, on Al-khair's word). A command, `lead-finder compare-research`, runs both kinds of research on the 10 test companies. Choice 24.
  - **Done when:** the Log has, for each company and each kind: facts found, facts right (a person checks each against its source), signs found, cost, the time to the first finding, and the time to the finished card. The total stays under US$20.
- [ ] **T5-3. The decision** (Al-khair). Choice 25.
  - **Done when:** the Log says keep or drop, with the numbers. Keep sets `assistant_research_style` to `deep`. If the loop misses only the facts bar, one more paid try runs the questions on Opus 5.5 (`model_deep`), on Al-khair's word, before it's dropped. Drop leaves it on `standard`, and the code stays for later.
- [x] **T5-4. Part 5 check.** Done 25 Nov 2026, with T3-3. As T1-4.
  - **Done when:** all pass, and the numbers are in the Log.

## Merge, checks and going live

- [ ] **M1. Merge** (`merge v27`, on Al-khair's word). Full checks, the `merge-check` skill, a fresh `review-agent`, and the `simulator-agent` on the new flows. Then `git merge --ff-only plan-v27` in the main folder.
- [ ] **M2. Deploy** (`deploy v27`), after S3. Push `master` and deploy.
- [ ] **M3. The live check:**
  1. The Run tab shows only Find new leads.
  2. A Find new leads run with a target of 25 and a US$15 cap (paid, on Al-khair's word): Results has no HubSpot company with recent activity, and the feed has the "Left out" line.
  3. In the Assistant, research a company that is new to HubSpot (about US$0.40): the lead card opens at the end.
  4. Add 2 leads to HubSpot in bulk: each is in HubSpot with its owner, note and list.
  5. A week later: new companies per run, against S2's numbers. Fewer is a blocker: it's fixed before this plan closes.
- [ ] **M4. The docs.** The plan list, `engine/AGENTS.md` (or its topic files after PLAN-V26), `engine/DESIGN.md` (the bulk bar), `projects/leads/criteria/` (the HubSpot rule and Property Daily), and a short team note written with `/plain`, sent on Al-khair's word.

## Waiting on

- **Al-khair:**
  - ~~**A1.** Approve this plan, or change it.~~ Approved 24 Nov (`implement v27`).
  - **A2.** The quiet rule (12 months), or leave out every HubSpot company (`hubspot_quiet_months` 0). Quiet companies share a run's places with new ones. 0 gives every place to companies not in HubSpot.
  - **A3.** Switch off Old offices and HubSpot watchlist (recommended), or delete their code.
  - **A4.** The owner of companies added in bulk (choice 15), with Levi.
  - **A5.** The paid test (T5-2), and the keep rule (choice 25).
  - **A6.** Only if S2 shows Property Daily's items alone found new companies: keep them coming in as triggers (recommended, so no new lead is lost), or drop them.
- **Levi:** S1's answers.

## Risks

- **Fewer rows on Results, but not fewer new leads.** HubSpot companies leave Results, so the count shown drops. The places they used go to new companies, so new leads should rise. A run may search more, which costs more, but it stays inside the run cap. M3 checks the count.
- **A wrong match hides a new company.** Only a sure match leaves a company out (choice 26). A maybe stays.
- **A wrong lead goes to HubSpot in bulk.** The preview, the 5-second Undo and the limit of 25 reduce it. The write log says what was made, and a wrong company is deleted in HubSpot by hand.
- **The loop costs more, is slow, or finds less on Sonnet 5.5.** It's built to be fast (choice 21), and it's kept only if it finds more and is no slower than today's research (choice 25). A miss on facts alone gets one try on Opus 5.5 (T5-3). The test is capped at US$20, and the loop stays off unless it wins.
- **Property Daily's own finds.** If its items alone found new companies, Part 2 would lose them. S2 counts them, and they keep coming in until A6 is decided.

## Not in this plan

- A "may move" view of HubSpot companies on Companies (the Old offices idea), if Levi wants it. That's a later plan.
- The loop in every run. That comes only after T5-3, in a later plan.
- Adding people (contacts) in bulk. Bulk adds companies, with the note and the list, as a single send does.
- Changing which source wins a fact (`data_sources`).
- Deleting the Old offices and HubSpot watchlist code, unless A3 says so.

## Log

- 23 Nov 2026: drafted from Al-khair's chat: his six asks, then his note that Property Daily is one of the triggers, not a source of leads, and complements the search. The recommendations given in chat are the choices here: the quiet rule (choice 3), switch off rather than delete (choice 2), the owner (choice 15) and the loop as a test first (choice 24). He didn't answer them one by one, so A2 to A5 stay open. Nothing built yet. Not in the plan list yet: S0 adds it, so PLAN-V25's and PLAN-V26's sessions aren't disturbed.
- 23 Nov 2026, later: Al-khair's rule: the number of new leads must never go down or be put at risk (decision 7). The old risk "Fewer leads a run" was wrong. Leaving out HubSpot companies costs no new lead, and a run's target counts only the companies it keeps, so the freed places go to new ones. Added the sure-match rule (choice 26), the replay check (choice 27), A6 for Property Daily, and M3's blocker.
- 23 Nov 2026, later: Al-khair: Quick Deep Research must be fast and informative, not only deep. Choice 21 now starts each follow-up as soon as its answer arrives, runs up to 4 at once, and puts the questions on Sonnet 5.5. Choices 19 and 22 show each finding as it arrives. The keep rule (choice 25) adds "no slower than today's research".
- 23 Nov 2026, later: Al-khair: the Assistant's essence is speed, with no fluff, without risking quality, and without slowing the rest of the system (decision 8). Part 4 now answers at once from what we know, opens a lead card from the last 30 days with no research, runs research in the background and asks only before spending money. A research uses at most 2 Claude places, and commands go ahead of it (choice 20). So the loop runs 2 at once, not 4 (choice 21).
- 24 Nov 2026: Al-khair said `implement v27` (A1). He didn't answer A2 or A3, so the build follows the recommendations: the quiet rule at 12 months (choice 3), and Old offices and HubSpot watchlist switched off, not deleted (choice 2). Both stay easy to change.
- 24 Nov 2026, S0: `plan-v27` made from `master` (`d32ff3f`, PLAN-V25 and PLAN-V26 joined) in `../contour-v27`. Database `leadfinder_v27`: a copy of the dev database (at `0024`), migrated to `0029_v26_activity`, the newest on `master` (there is no `0028`). Fast backend tests: 3,655 passed, 45 skipped. Website tests: 3,197 of 3,198 passed. The one failure (`useRunEvents.test.tsx`, "waits longer each time the backend cannot be reached") is a timing test that passes on its own and fails only under the full parallel run. It is already on `master`, so it's not this plan's. The plan list line is not added: Al-khair's move of the list from `CLAUDE.md` to `AGENTS.md` is still uncommitted in the main folder, so the line waits for M4 rather than touching that work.
- 24 Nov 2026, T1-1 and T1-2 (one commit, "PLAN-V27 T1-1, T1-2"):
  - **One run type.** The run options list only `discovery`, and the Start page opens on its form with "Find new leads: search the news for companies with a sign of an office change. Companies already in HubSpot are left out." under the title. A `watchlist` run (and so Old offices, which is a watchlist run with the office questions first) answers 409 `run_type_off`, "This run type is switched off", and its estimate is blocked with the same words. The switch is `WATCHLIST_RUNS_ON` in `runs.py`: one line brings both back. Their backend code and tests stay; the Start page's watchlist, Old offices and Companies by name parts are gone from `index.tsx` (`tenure.tsx` and `form.ts` keep their code). Re-check (`company`) and the city rounds run as before.
  - **The top up goes.** `steps/top_up.py` is deleted, `top_up` leaves the run options, and the `top_up` param is still accepted but no longer used (its default is now `false`, so a new run's details don't say "Top up from HubSpot"; an old run that asked still does). A short run a person started says "Found 31 of 50. Try a longer look-back or more places." in its feed.
  - **Leave out HubSpot companies.** In a discovery run, `choose.decide(new_only=True)` leaves out a company HubSpot surely has (HubSpot id, domain, or the exact name in the same city) with an open deal, a deal dissolved in the last 12 months, or activity in the last `hubspot_quiet_months` (a new setting, 12, editable in Admin settings, 0 leaves out every HubSpot company). They are counted, not listed: one feed line, "Left out 12 companies already in HubSpot." They don't take a place, so the run searches on until it has its target of others.
  - **Quiet.** `quiet.py`. A HubSpot company with no activity date counts as quiet: nobody has worked it. This matters: the laptop's HubSpot copy has an activity date for only 145 of its 13,921 companies, so on that copy almost every HubSpot company without a deal stays in. **TBC (S2):** the live copy's count. A quiet lead's HubSpot status is `quiet` (a new value of the existing column, no migration), and its card's HubSpot part has `last_activity`. `relabel` keeps both rules.
  - **A sure match only (choice 26).** `match_company(name_needs_city=True)`, used by the run's choose step, the research and `relabel`: the exact name with every known office in another city is a maybe, with the reason `same_name` ("same name, another city"). An unknown city, or a company with no office in a known city, never says "elsewhere".
  - **The replay check (choice 27)** runs as a test (`test_quiet.py`) on a made-up set shaped like the laptop's 52 companies of 27 Oct to 2 Nov (17 new, 29 in HubSpot, 6 maybes), at limits of 10 to 100: the new rules keep at least as many companies not in HubSpot every time. **TBC:** the same check on S2's live companies.
  - **Free checks (`rule-change`):** `lead-finder rejudge` on `leadfinder_v27` gives the same output with `master`'s code and this branch's: 52 leads, 26 with a different result, all from older rule versions, none from this change (it doesn't change how a researched card is judged). Backend: ruff and mypy clean; the Lead Finder, matcher, settings and contract tests pass. Website: types, lint, and the Lead Finder, hooks, lib and component tests pass.
- 24 Nov 2026, T1-3 (backend `efd33a3`, website in the next commit):
  - **The maybe buttons.** `POST /lead-finder/leads/{id}/hubspot-match` (`hubspot_pick.py`): "Same company" with one candidate's HubSpot id links the lead to it (its own status, or `quiet`), "It's new" marks it new. The card is judged again with its saved facts (an open deal fails the HubSpot rule, as at research), its candidates clear, and `confirmed_by` says who did it. `relabel` leaves a settled lead alone. 409 `not_a_maybe` for a second click, 422 `not_a_candidate`, 409 `hubspot_company_gone`. Free.
  - **A dissolved deal is work on the company:** its day counts as activity (`quiet.last_worked`), so a deal dissolved last month is never quiet, whatever HubSpot's activity date says.
  - **Website** (built by the `frontend-agent`): the HubSpot tab's "Same company" on each candidate and one "It's new", for people who may change leads; "Settled by Jo Sample."; the badge reads "In HubSpot, quiet since March 2025" (or "In HubSpot, never worked") on the quick view and the tab. Results sends `hubspot_status` new, quiet and possible match by default, and the "In HubSpot (8)" chip (a toggle, kept in the address as `show_in_hubspot=true`) shows the others; a HubSpot pick in the filter wins. The count comes from the facets. When every lead is hidden: "No new leads yet. 8 leads already in HubSpot are hidden." with "Show them". Tests at 1440 and 390 px, keyboard alone, a Viewer, a reload, a refusal.
  - **For Al-khair's look (TBC):** (1) the two buttons act at once, with no confirm and no Undo, though "Same company" can hide the lead from Results; DESIGN.md's "act at once, undo after" suggests an Undo. (2) Home's counts still include leads in HubSpot, so they can be higher than Results' default list. (3) The chip shows even at "In HubSpot (0)", so nothing jumps. (4) A run's own review page (`?run_id=`) hides HubSpot leads the same way.
- 24 Nov 2026, Part 2:
  - **T2-1, behind a switch (decision 7).** A new Admin setting, `tool_feeds_find_companies`, off by default: a run reads no tool's feed and no new email at its start, and a saved `sources` is ignored (`run_sources.web_only`, at the start, the estimate and a resume), so it finds companies on the web only. The Start page has no "Sources" part any more. On, the feed works as before (its tests now run with it on). This keeps A6 one click away: **don't deploy (M2) before S2.** If S2 shows Property Daily's items alone found new companies, the switch goes on until Al-khair decides A6. Tests: a ready Property Daily named by the run reads no email and adds no company; an old saved choice of Property Daily alone, not ready, starts and searches the web; the estimate too.
  - **T2-2: no change.** The research doesn't read the switch (`property.py` and `research.py` untouched). The existing tests cover the done-when: a lease end 12 to 36 months out is the lease sign with Property Daily's link (`test_a_tools_lease_end_is_a_sign_only_12_to_36_months_out`), a fitout given to a firm is the `recent_fitout` dampener (`test_a_fitout_record_is_the_last_fitout_and_the_dampener`), and the run's live-page limit (`test_the_run_limit_counts_one_runs_pages_only`, 60 by default in `test_config.py`).
- 24 Nov 2026, T3-1 (`efd33a3`): `POST /lead-finder/leads/hubspot/preview-many` and `send-many` (`hubspot_batch.py`), 1 to 25 leads, each through the single send's writer, one at a time, in the order given. Each item has its own result: `sent`, `already_sent` (the once-only key: a second call writes nothing) or `failed` with HubSpot's plain words; one failure never stops the rest; a write id from another lead fails that lead only. Writing switched off refuses the whole batch (409 `hubspot_write_off`) before anything is written. The owner (choice 15) is the sender's HubSpot user (`hubspot_owner_id`, not when marked "No HubSpot user"), as HubSpot's `hubspot_owner_id` field, so it fills only a company with no owner; without one, none. 26 are refused (422). Who may: `lead_finder.send_to_hubspot` with write, and `test_access.py` checks every Lead Finder route gives 403 without the tick. Tests with the fake HubSpot: 5. The contract and the website's types are made again.
- 24 Nov 2026, the lanes for T4-3 (`efd33a3`): `Work` has `behind` and `most`. A run kind's `in_background(params)` puts a person's run in the People lane behind the lane's other requests, with at most 2 places (`BACKGROUND_PLACES`), and a blocked request never holds up the line. Gate tests: a later command goes first; a research holds 2 places with 4 free and someone else's request starts at once.
- 24 Nov 2026, T1-4 and T2-3 (the checks of Parts 1 and 2): backend, the full set in three parts (memory is tight on this laptop): the Lead Finder 2,106 passed, 29 skipped; core 2,445 passed, 40 skipped, 10 failed, all `test_profiles.py`, which reads `projects/leads/research/COMPANIES.xlsx`, a git-ignored data file only the main folder has (not a v27 change); Companies 777 passed, and its 5 failures were Part 4's files half-written at the time (all pass now, below). Ruff and mypy clean. Website: eslint clean, `tsc -b` clean, `npm run build` passes; the full vitest set 3,217 passed, with 5 load timeouts (`app-sidebar`, `assistant/links`, `voice-files`) that pass alone (34 of 34). `node scripts/bundle-report.js`: first visit 244 kB gzip JavaScript and 25 kB CSS, the same as before Part 3.
- 24 Nov 2026, T3-2 (website, built by the `frontend-agent`): people who may send a lead (`lead_finder.send_to_hubspot` with write) get tick boxes on Results, with "Select all on this page" in the Company header. A lead already sent can't be ticked, and says so. A bar shows "3 selected", "Clear selection" and "Add to HubSpot": above the table on a laptop, always there so nothing jumps, and fixed at the bottom on a phone. Beyond 25 the button is off: "You can add at most 25 at a time. Untick 1 to go on." (**TBC**, choice 13). "Add to HubSpot" opens one preview from `preview-many`: each lead with "New company" or "Fills 2 empty fields in Northwind", the owner once ("Jo Sample", or "No owner"), the list once, and per-lead problems and "Already in HubSpot. Left out." on their rows; those are left out of the send. Send waits 5 seconds in the dialog ("Sending in 5 s." and Undo, or Esc), on the Assistant's clock, now shared (`lib/hold.ts`, `components/countdown.tsx`). Undo sends nothing. Then `send-many` goes with the previewed writes, each row shows "Added.", "Already in HubSpot." or "Failed: ...", and one live region says the batch once: "2 added. 1 failed: HubSpot refused the website." The leads are read again, the ones that went are unticked, and a 409 `hubspot_write_off` shows HubSpot's plain words with "Nothing was sent." Fixed on the way: ticking redrew the table's cells and lost the keyboard focus, on the review page too. Tests: 19 (`send-many.test.tsx`), at 1440 and 390 px, keyboard alone, a Viewer and Staff without the tick; related suites 903 passed. Seen in jsdom only, not yet in a real browser. **For Al-khair's look (TBC):** (1) a full page has 50 rows, so "Select all on this page" always passes 25 and turns the button off; (2) the bar always shows on a laptop (a new pattern); (3) the hold is in the dialog, not a toast, so its Undo is reachable by keyboard; (4) a run's review page (`?run_id=`) keeps its own "Approve and send to HubSpot", with no preview and no hold; (5) ticks stay while paging or filtering, and failed or left-out leads stay ticked after a send.
- 24 Nov 2026, Part 4 backend (T4-1, the backend of T4-2, T4-3; built by the `backend-agent`): "Research Northwind" is the command action `research`. Plainly "research" and a name, or "research" alone, needs no Claude request; other words go to Claude with only the scrubbed words (`assistant-4`). Its `research` block is free, from our copies: HubSpot's view with the quiet rule (moved to `core/hubspot/quiet.py`, shared with the Lead Finder) and, for people with a Lead Finder tick, the lead card from the last 30 days and Property Daily's lease end and size, each with its day and source. `next` is `open_lead`, `open_prep`, `ask` ("Research Northwind? About US$0.38.", the cost from the run estimate within 1 s, else US$0.40), `choose` (PLAN-V25's choices, then `GET /companies/assistant/research` for the one picked, or for "It's new") or `needs_name`. `POST /companies/assistant/research` starts a Lead Finder `company` run of one company with `from_assistant`, through the run manager, so the run's caps, the run limit (409) and the daily limit apply; it needs `lead_finder.start_run` (403 "Researching a new company needs the Lead Finder. Ask your Platform admin."), never a Viewer. Such a run asks Claude in the People lane behind people's requests with at most 2 places, sends a `finding` event for the first 3 notes of each angle as they arrive (TBC), and `company_done` has the `tier`. The Companies project reaches the Lead Finder only through `CompanyLeads.research`. **HubSpot names stay out of Claude:** while `hubspot_names_to_claude_ok` is off, a company found in our HubSpot copy is researched under the words as said, never our copy's name (`run_name`), and "research it" on a HubSpot company's page asks for the name ("Say the company's name to research it.") and starts nothing. Tests: 22 fast, 16 API, 5 run and 2 lane tests; the fast set 3,718 passed. **TBC:** under 1 s when HubSpot's own search runs (up to 8 s); the shortcut while the AI sort is off (409 `assistant_off` today); `open_prep` comes back even to someone without the Call prep tick (the website then says so).
- 24 Nov 2026, T5-1 (Quick Deep Research, `apps/lead_finder/deep.py`): breadth 3 and depth 2. The first questions come from what memory, Signal Hire's staff count and the property tools' lease end didn't answer (`first_questions`); each is one Claude request with web search (at most 3 searches) on `model_deep` (Sonnet 5.5), in the research's own instructions, and answers with notes, one line learned and up to 2 follow-ups. A follow-up starts as soon as its own answer arrives and a place is free, at most 2 at once (`AT_ONCE`, on top of the lane's own 2). A follow-up that repeats a question (Jaccard 0.7) or that a known fact answers (0.8 of its words, TBC) is dropped, and one with a link, an email, no question mark, more than 160 characters, or not about the company is dropped too, so a page can't steer the loop. Notes keep only links the search returned. The company cap stops it ("deep: stopped at the company cap"). Each note reaches the Assistant as a `finding`, the last of an answer with the question asked next. The research uses the loop only for a run the Assistant started (`from_assistant`) while `assistant_research_style` is `deep` (Admin setting, `standard` by default); the answer form, the gap check, the match and the score stay as they are, on the research's own model. Tests: 12 for the loop (with saved sample answers) and 2 run tests (the deep run's searches are all the loop's on `model_deep`, its card has the same result and tier as the angles' card, and any other run keeps the angles). T5-2's command is built, not run: `lead-finder compare-research` researches the 10 test companies both ways with memory off and prints facts, signs, cost, the time to the first finding and to the card; without `--yes` it says "At most US$20.00" and spends nothing, and it stops before a company that could pass US$20 (4 tests).
- 24 Nov 2026, T4-2 (website, `47e4b51`): "Research Northwind" opens the research card: what we know, one line each with its source, and "Research Northwind? About US$0.38." as its title. Enter, "yes" or a tap on Start research starts the run (`POST /companies/assistant/research`, with the card's Idempotency-Key, so a double press starts one run), and the card closes at once. Enter does nothing for the first half second, so the Enter that sent the command never starts a run. After a spoken command the card listens 5 seconds for "yes" or "cancel". A maybe shows the best guess first and "It's new"; the keys 1 to 3 pick. A lead card from the last 30 days opens at once, and a HubSpot company that isn't quiet opens Companies with its call prep (`?prep=1`). The run goes on in a tray at the bottom right (full width on a phone), under the dialogs, so the Assistant takes the next command: each finding as it arrives with its source link, then "Done: Northwind is a B lead." with "Open the lead card" and "Add to HubSpot" (the lead card's own preview and send). A screen reader hears the start and the end, never each finding. Tests: 27 (`research.test.tsx`), at 1440 and 390 px. Seen in jsdom only, not yet in a real browser. **For Al-khair's look (TBC):** (1) the tray lives in the page's memory: a reload hides it, and the run goes on (it shows on the Runs page); (2) the tray's place, bottom right; (3) the half-second wait on Enter.
- 24 Nov 2026, the review's fixes (`47e4b51`): (1) a blocker: the card sent a HubSpot company's name from our copy, so it could reach Claude. Now the card sends the rep's words (`said`), and the server picks the run's name: the rep's words while `hubspot_names_to_claude_ok` is off, and without them 422 "Say the company's name to research it." (2) A lead has one open plan, so another rep's later preview could plan their own owner. `send-many` now fails that lead with "The owner changed since the preview. Preview the batch again." and writes nothing. Tests: 2 and 1.
- 24 Nov 2026, T3-3, T4-4 and T5-4 (the checks of Parts 3 to 5):
  - **Backend:** ruff and mypy clean (492 files). The fast tests pass (the commit hook). The Lead Finder 2,113 passed, 29 skipped. Companies 792 passed (25 Nov, after a core run stuck since 14:49 the day before was stopped). Core 2,448 passed, 40 skipped, 11 failed: the 10 known `test_profiles.py` ones (the data file only the main folder has) and `test_browser.py`'s "two callers at once", a timing test that passes alone (1 of 1) under less memory pressure; V27 doesn't touch the browser code. The contract gate (`RUN_GATES=1`): 3 passed, and `engine openapi` writes the same contract.
  - **Website:** eslint clean, `tsc -b` clean, `npm run build` passes. The full vitest set: 3,262 of 3,262 passed (206 files). `node scripts/bundle-report.js`: first visit 244 kB gzip JavaScript and 25 kB CSS, the same as before Part 3.
  - **`flow-trace`** on the bulk add and the Assistant's research: no blocker. One fix (`3efbea6`): a finished research didn't refresh Results, Home's counts or the runs list; the tray now does, as the run page does. Notes: `send-many` has no Idempotency-Key header, but each lead's write id is its once-only key, so a second call sends nothing twice. A lead card's own Preview plans the lead again without an owner, and its send then writes none (the single send doesn't add one).
  - **`security-check`** on the HubSpot write and the research start: no blocker. No key in the diff; the new logs hold no name; the new settings hold no secret; the guard and server mode are unchanged. Every bulk write goes through the writer (preview, a person sends, once only, empty fields only), and writing stays off by default. The owner id comes from the sender's own account, never the request. A web page can't start a run or a send: both need a person's press, and the loop drops a follow-up with a link or an email. **TBC at M3 step 4:** HubSpot's owner field may be a list of choices; if our owner id isn't one of them, the writer puts "Owner: 88" in the note instead of setting the owner.
