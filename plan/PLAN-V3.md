# Lead Finder plan, version 3: staff numbers from Signal Hire

This plan builds Signal Hire into the Lead Finder's research. When the research and HubSpot find no staff number for a company's office, Signal Hire fills the gap. Criteria_v2 section 2 puts "a headcount tool" second in the order for staff numbers. Signal Hire is that tool.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-11-02. **TBC** means not confirmed yet.
- **Progress:** 5 of 11 steps done (A1, A3, C1, C2, C3). The code in "Already built" is committed and merged into `master`. A3 and the steps after it are on branch `signal-hire`, not merged. Nothing feeds a lead yet.
- **Runs beside:** [PLAN-V2.md](PLAN-V2.md). Its step A3 (test Signal Hire by hand) is steps A2 to A4 here. Sending leads to HubSpot is Phase 5 in [PLAN-V1.md](PLAN-V1.md), and it waits on the HubSpot service key.

## In short

- **What changes:** a lead with no staff number gets one from Signal Hire, marked as an estimate, with a note that says where it came from.
- **Non-disruptive:** Signal Hire only fills a gap. It never overwrites a number, never stops a lead or a run, and it stays off until the test numbers (A4) say it is worth turning on (see "Rules that keep it safe").
- **Order:** make it safe to build on and test the numbers (A), decide how far to trust them (B), build it into the research and the website (C), check on real companies and merge (D).
- **Cost:** Signal Hire's daily search quota (1 search per company), 1 company credit per `headcount` check, and about US$1 of Claude for D1. The 16 real leads so far cost US$5.48 in total, about US$0.34 each.
- **Not in this plan:** decision-maker names, emails and phones. They wait on Levi (Part E).

## Already built

Written on 2 Nov and committed on `decision-makers` (3b1a093). Step A1 merged it into `master`.

- **The client:** [client.py](../engine/backend/core/signalhire/client.py). It finds a company (free), reads its details (1 company credit), counts its profiles (free) and counts people by company, city and seniority (the daily search quota). It has no call for a person, an employee list or contact details. So no name, email or phone can come back.
- **The command:** `uv run --no-sync lead-finder headcount "Culture Amp" --city Melbourne --yes` prints a company's numbers. It uses no database. Without `--yes` it spends nothing.
- **Safety:** the key is `SIGNALHIRE_API_KEY` in `engine/.env`. The logs remove it. The tests blank it, so no test reaches Signal Hire. A slow paid call is never sent twice, and a busy answer (429) or server error is tried again twice.
- **Tests:** 39 new tests. The whole fast suite passes: 1,909 passed, 28 skipped.
- **Not built:** nothing feeds a lead yet. The research doesn't call Signal Hire, and the lead card doesn't show it.

## Rules that keep it safe

1. **It fills a gap only.** It runs only when the research and HubSpot found no staff number for the office. It never overwrites one.
2. **It never breaks anything.** Any Signal Hire error becomes one line in the card's problems. The lead is still saved and the run goes on.
3. **It stays off until it is proven.** `headcount_tool` is taken out of `staff_sources` in `criteria.yaml` when Part C is built, and B1 puts it back only if the A4 numbers hold up. So building Part C changes no lead. After that, one edit turns it off again, with no code change: take `headcount_tool` out, or empty the key in `engine/.env`.
4. **HubSpot names stay home.** A watchlist company (its name came from HubSpot) is not sent to Signal Hire unless a new switch in `engine/.env` says so. It works like the existing `HUBSPOT_NAMES_TO_CLAUDE_OK`, and it starts off.
5. **No database change.** The card gets one new list, empty by default, inside its saved JSON. Old cards still load, and `lead-finder rejudge` works as before.
6. **Counts only.** Only a number and a note are kept. No names, emails or phones.

## How to work this plan

Follow "How to work this plan" in [PLAN-V2.md](PLAN-V2.md#how-to-work-this-plan). In short:

- Do one step at a time. A step is done when its "Done when" is true. Tick it in the same turn, with the date and the commit, then add a line to the log.
- **While you wait for Signal Hire's support** (A2), A3 and C1 to C3 don't need the key, because the tests use a fake Signal Hire. They can be built first. C2 uses a multiplier of 2 until B1 sets the real one. D1 needs A2, A4 and B1 done.
- Check Claude's usage at the start of each step. At 80% on either limit, save to the AI Brain. At 95%, start no new step. To save in one line: `brain inbox "contour PLAN-V3 paused: done A1 to A3, next A4, branch master, last commit abc1234"`.
- **Costs money** marks a paid step. Run it only when Al-khair says so.
- Commits and pushes happen when Al-khair asks.
- While the backend runs, `uv run` can't rebuild the project, because `engine.exe` is in use. Use `uv run --no-sync`, or stop the backend first.
- A choice still open with Levi is not a hard rule. Build our recommendation, put the number in `criteria.yaml`, and mark it **TBC**.

## Part A: Make it safe to build on, and test the numbers

No lead changes in this part.

- [x] **A1. Commit the work and merge it.** Done 2026-11-02, 3b1a093.
  - Changed on the day: it was committed on `decision-makers`, not on a new `signal-hire` branch. Then `decision-makers`, with its earlier commit 4b27b41, was fast-forward merged into `master` on Al-khair's say, before A2 to D were done. The commit hook (Ruff, mypy, fast tests) passed. Nothing is pushed.

- [ ] **A2. Replace the key and check the account.** Al-khair, by hand.
  - The current key was shown in screenshots, so delete it in Signal Hire and make a new one. Put it in `engine/.env` as `SIGNALHIRE_API_KEY=`.
  - Email support@signalhire.com. Ask them to switch on the Company API. Ask how many company credits the account has, and its daily search quota (**TBC**).
  - **Costs money:** 1 company credit. Check one company: `uv run --no-sync lead-finder headcount "Culture Amp" --city Melbourne --yes`. If it says "Signal Hire said no", the Company API is still off.
  - **Done when:** one company prints its numbers, or the log says what support answered.

- [x] **A3. Let the command work while the Company API is off.** Done 2026-11-02, 4e561b4 (on branch `signal-hire`).
  - Today the command stops if Signal Hire refuses the company lookup (a 403). The city count uses the search, which doesn't need the Company API.
  - Change: the client gets its own error for a 403 (a kind of "unavailable"). On that error the command skips the company details, counts people by the name typed, and prints "name not checked". A refused key (401) still stops it. C2 reuses this error.
  - Tests for both cases.
  - **Done when:** the fast tests pass.
  - Changed on the day: the error is `SignalHireCompanyApiOff`, and only a 403 on a company call (find, details, profile counts) is that error. A 403 on the search is a plain "unavailable" ("Signal Hire refused the search") and still stops the command, because the search doesn't need the Company API, so a refused search is a different problem. If the Company API goes off after the name was found, the name stays checked, the other company calls are skipped, and it is noted once.

- [ ] **A4. Test 5 companies.** This was PLAN-V2 step A3.
  - **Costs money:** up to 5 company credits and 10 searches.
  - Use 5 companies from `testset.yaml`: Culture Amp and Seek (Melbourne), Elders and Maptek (Adelaide), and Mineral Resources (Perth).
  - For each one, write down: Signal Hire's people on file now, in the city, and its staff estimate for the whole company. Add the LinkedIn staff count × 2, and the public staff number for the whole company (the latest annual report or the company's own site).
  - Public numbers for one city are rare, so the table compares whole companies. The ratio "public staff ÷ Signal Hire people on file now" shows how much Signal Hire undercounts.
  - Put the table in [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md) section 2, with what it shows.
  - **Done when:** the table is written.

## Part B: Decide how far to trust it

- [ ] **B1. Pick the multiplier, the name rule, and whether to turn it on.**
  - **The multiplier.** Take the 5 ratios from A4. Our recommendation (**TBC** with Levi): the multiplier is the middle ratio, rounded to the nearest 0.5. Put it in `criteria.yaml` as `headcount_tool_multiplier`.
  - **Turn it on only if the ratios agree.** If the biggest ratio is more than twice the smallest, one multiplier is a poor guess. Then leave `headcount_tool` out of `staff_sources`, write why in the log, and stop. Part C stays built and off.
  - **The name rule.** A short or common name can count other companies' people. Example: "Apex" in Perth may count staff at Apex Plumbing too. Our recommendation: use a count only when the Company API has checked the name. Use the typed name only if A4 shows it gives the same counts.
  - **Done when:** the choices are in `criteria.yaml`, `headcount_tool` is back in `staff_sources` or the log says why not. Levi confirms later (see "Waiting on Levi").

## Part C: Build it into the research

Each step has its own tests. While `headcount_tool` is out of `staff_sources` (rule 3), nothing here changes a lead.

- [x] **C1. The settings.** Done 2026-11-02, 08047e6.
  - In `criteria.yaml`: add `headcount_tool_multiplier` (2 for now, **TBC**) and the name rule from B1. Take `headcount_tool` out of `staff_sources`. Add their checks to `rules.py`, so a wrong value stops the backend at start-up.
  - In `core/config.py`: add a switch for HubSpot names going to Signal Hire (env-only, off by default, only the exact text `true` turns it on, like `hubspot_names_to_claude_ok`).
  - **Done when:** the rules tests and the settings tests pass.
  - Built: `size.headcount_tool_multiplier: 2` (more than 0 and at most 20, so a typo stops the backend), `size.headcount_tool_name_check: required` (the other value is `optional`, which also uses the name as typed), both listed as TBC, and `headcount_tool` out of `staff_sources`. The switch is `HUBSPOT_NAMES_TO_SIGNALHIRE_OK` in `engine/.env` (see `.env.example`). The API contract and the website types were rewritten, because the Rules endpoint now returns the two new fields.

- [x] **C2. The fill-in step.** Done 2026-11-02, d301734.
  - In `apps/lead_finder/headcount.py`, add a step like HubSpot's `fill_gaps` in `office_numbers.py`. It runs only when all of these hold:
    - The staff number is still unknown after the research and HubSpot.
    - `headcount_tool` is in `staff_sources`, a key is set, and the office's city is known.
    - The company's origin is not `hubspot`, unless the new switch is on. (A watchlist run already needs Levi's OK for Claude. Whether it also covers Signal Hire is **TBC**.)
  - It makes one search: people whose current company is this one, in "<city>, Australia".
  - It writes the staff number as the count × the multiplier, labelled "estimated", and adds a note. Example: "Staff in Melbourne: about 210, from Signal Hire (105 people on file × 2, TBC)."
  - **The multiplier is applied once.** The saved number is the multiplied one, and `staff_from_linkedin` stays false. If it were true, the size rule would multiply it again by its own LinkedIn number.
  - No link on the fact until Signal Hire's page link format is known (**TBC**). The HubSpot step already allows a fact with no link.
  - Any Signal Hire error becomes one line in the card's problems.
  - **Done when:** tests show it never overwrites a number, needs a city, skips watchlist companies, multiplies once, and the size rule reads the number as it is.
  - Built: `wants_signalhire` (the conditions above, in plain code) and `fill_staff_gap` in `apps/lead_finder/headcount.py`, with 22 tests in `tests/lead_finder/test_staff_fill.py`. Choices made on the day:
    - The note says "x", not "×" (the code checker refuses the sign): "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC)." The ", TBC" shows only while `size.headcount_tool_multiplier` is listed under `tbc` in `criteria.yaml`, so it goes away when Levi confirms.
    - With the name rule `required`, it looks the company up first (free) and counts under Signal Hire's own name for it. No match, or the Company API off, means no count and one line in the problems. With `optional` it counts under the name as typed, and the note says the name wasn't checked.
    - Nobody on file is not a staff number of 0, so no number is written. The problems say why.
    - `staff_from_linkedin` is set to false (not just left alone), because the research can set that flag with no number, and the size rule would then double ours.
    - It never raises. A slow Signal Hire is cut off after 90 seconds (`STEP_SECONDS`), and a bug becomes the line "it couldn't be read", with no detail on the card.

- [x] **C3. Call it from the research.** Done 2026-11-02, 6d4bd92.
  - In `research.py`, step 5, after HubSpot fills its gaps and before the rules run. Make a real client from the settings for each company (it is closed after). Tests pass in a fake one.
  - **No database connection is held while Signal Hire answers.** End the open transaction first, as the research already does before it calls Claude. A slow answer can take up to 30 seconds, with 2 retries.
  - A run researches at most `run_max_companies` companies (20 by default), with 1 search each, so a run uses at most 20 searches.
  - Add an integration test with a fake Signal Hire.
  - **Done when:** the fast and integration tests pass. For the integration tests, start the database first (`docker compose up -d` in `engine/`), then `uv run --no-sync pytest`.
  - Built: `_signalhire_staff` in `research.py`. It asks `wants_signalhire`, makes the client from the settings (`get_signalhire`) or takes the fake from the new `signalhire=` argument of `research_company`, ends the transaction, calls `fill_staff_gap`, closes a client it made (even after an error), and adds the problem lines to the card. With no key, or while `headcount_tool` is out of `staff_sources`, nothing happens and no connection is touched.
  - Moved here from C4: the card list `from_signalhire`, the API contract and the website types, because the research needs a place to put the note. `lead-finder research` prints the notes too. C4 keeps the website view and the fake backend.
  - Tests: 11 new integration tests in `test_research.py` (it fills a gap; it stays off while `headcount_tool` is not listed; it is not asked when the research or HubSpot had a number; an error is one line and the lead is saved; the watchlist switch; the transaction is over before each call; a client it made is closed, also after an error; no key; an old card still loads). The whole backend suite: 2,424 passed, 28 skipped.

- [ ] **C4. Show it on the lead card.**
  - Add `from_signalhire` to the card: a list of notes, empty by default, like `from_hubspot`.
  - Write the API contract (`uv run engine openapi`) and the website types (`npm run types`).
  - On the lead card, show "From Signal Hire" under "From HubSpot". Add the field to the website's test card (`test-lead.ts`) and a test in `index.test.tsx`.
  - Give the fake backend one sample company with a Signal Hire note, so the page can be checked without a key.
  - **Done when:** the website lint, types, tests and build pass, and the card looks right in the browser on the fake backend.

## Part D: Check on real companies, then merge

- [ ] **D1. Research 3 real companies.**
  - Needs A2, A4 and B1 done, with `headcount_tool` back in `staff_sources`. Restart the backend first, so it loads the key and the new code.
  - **Costs money:** about US$1 of Claude and 3 searches.
  - Pick 3 companies whose staff number is hard to find in the news. Read each card. Check the number, the note and the problems list.
  - **Done when:** the 3 cards look right, or the log says what is wrong.

- [ ] **D2. The full check, then merge.**
  - Run the whole backend suite, the website checks one at a time, and the contract gate (`RUN_GATES=1`).
  - Update [AGENTS.md](../engine/AGENTS.md), the engine README (how to turn it off), and Criteria_v2 section 2.
  - Merge the work into `master`. This is Al-khair's call. The code from before Part B is already there (A1).
  - **Done when:** it is merged and the log says so.

## Part E: Later, not in this plan

Each is one small step on top of this plan. Names, emails and phones need Levi's OK first.

- **Decision makers.** Names and job titles from a Signal Hire search for senior roles. They would join the decision-makers list the research already fills from public pages. This waits on question 17 in [LEVI.md](../projects/leads/questions/LEVI.md): whether Contour may keep names.
- **Emails and phones.** Only on a click, for one named person, sent straight to HubSpot as a contact and not kept in our database. This needs Levi's OK, a check that the Spam Act allows the outreach, and the HubSpot scope `crm.objects.contacts.write`.
- **More signals.** A leadership change (a senior person who started in the last year), the local team (senior people in Australia against overseas), a growth hint (people now against before) and a recruiter flag.
- **Links.** The company's LinkedIn page (company details give its LinkedIn id) and its Signal Hire page, on the card for a person to open. We never read LinkedIn ourselves. This is company data, so it doesn't wait on Levi.
- **Office addresses.** The company details list its offices, with city, state and a head-office flag. Match them against HubSpot's offices, and use them to confirm the lead's city. This is company data too.
- **A status line in Admin.** Whether Signal Hire is on, and the credits left (Signal Hire sends them in the `X-Credits-Left` header).

## Waiting on Levi

- **The multiplier and the name rule** (B1). We build our recommendation, marked **TBC**.
- **HubSpot names to Signal Hire.** Watchlist companies are skipped until he says yes and the new switch is turned on.
- **Names, emails and phones** (Part E).

## Waiting on Signal Hire

- **The Company API** switched on, and the account's company credits and daily search quota (A2).

## Risks

- **The count may be wrong.** Signal Hire's city count may be far from the real staff. A4 and B1 show how far before any lead uses it.
- **Common names.** A short name can count other companies' people. B1's name rule reduces this.
- **The daily quota.** The Signal Hire website shares it. If a run uses it up, the remaining cards say so in their problems, and the run goes on.
- **Too many searches at once.** Up to 4 companies are researched at the same time, but Signal Hire allows 3 searches at once. A busy answer (429) is retried twice, then it becomes a problem line.
- **Signal Hire changes its API.** Errors become card problems. Nothing else breaks.
- **Signal Hire's terms** on keeping its numbers are **TBC**. We keep only a count and a note.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-02: C3 done (6d4bd92). The research calls Signal Hire for a staff gap, and the card has `from_signalhire`. It is still off (`headcount_tool` is out of `staff_sources`), so no lead changes. The card field and the contract moved here from C4. Next: C4 (the website view and the fake backend).

- 2026-11-02: C2 done (d301734). `fill_staff_gap` and `wants_signalhire` are built and tested with a fake Signal Hire. The research doesn't call them yet (C3). Next: C3.

- 2026-11-02: C1 done (08047e6). The multiplier (2) and the name check (`required`) are in `criteria.yaml` as TBC, `headcount_tool` is out of `staff_sources`, and `HUBSPOT_NAMES_TO_SIGNALHIRE_OK` exists and is off. Next: C2.

- 2026-11-02: A3 done (4e561b4, branch `signal-hire`). With the Company API off, `lead-finder headcount` counts people by the name typed and says "name not checked". Next: C1 to C4 (they need no key), then A2 and A4 by hand.

- 2026-11-02: Checked the plan against Signal Hire's docs (overview, authentication, pricing, search, Company API pages). It uses the Search API (standard access) and the Company API (on request). The Person API, the only one with contact details, stays out. Added links and office addresses to Part E. Plan pushed to GitHub (b0f4d7e).
- 2026-11-02: Plan reviewed against the code. Changes: Signal Hire stays off until A4 and B1 say so (rule 3); the multiplier is applied once and `staff_from_linkedin` stays false (C2); watchlist companies need a new switch (C1, C2); no database connection is held during the call (C3); the A4 table now compares whole companies, and B1 has a test for turning it on; Part C can be built while waiting for support.
- 2026-11-02: A1 done (3b1a093). The work was committed on `decision-makers` and merged into `master` with it, because Al-khair was near the weekly Claude limit and wanted it saved. Next: A2 (new key, Company API), then A3. Nothing is pushed.
- 2026-11-02: Plan written. The client, the `headcount` command and 39 tests were written first, on `decision-makers`. Al-khair says the key is in `engine/.env`. It hasn't been checked with a real call. No steps started.
