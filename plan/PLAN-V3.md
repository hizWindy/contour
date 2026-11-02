# Lead Finder plan, version 3: staff numbers from Signal Hire

This plan builds Signal Hire into the Lead Finder's research. When the research and HubSpot find no staff number for a company's office, Signal Hire fills the gap. Criteria_v2 section 2 puts "a headcount tool" second in the order for staff numbers. Signal Hire is that tool.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-11-02. **TBC** means not confirmed yet.
- **Progress:** 1 of 11 steps done (A1). The code in "Already built" is committed and merged into `master`. Nothing feeds a lead yet.
- **Runs beside:** [PLAN-V2.md](PLAN-V2.md). Its step A3 (test Signal Hire by hand) is steps A2 to A4 here. Sending leads to HubSpot is Phase 5 in [PLAN-V1.md](PLAN-V1.md), and it waits on the HubSpot service key.

## In short

- **What changes:** a lead with no staff number gets one from Signal Hire, marked as an estimate, with a note that says where it came from.
- **Non-disruptive:** Signal Hire only fills a gap. It never overwrites a number, never stops a lead or a run, and one edit turns it off (see "Rules that keep it safe").
- **Order:** make it safe to build on and test the numbers (A), decide how far to trust them (B), build it into the research and the website (C), check on real companies and merge (D).
- **Cost:** Signal Hire's daily search quota (1 search per company), 1 company credit per `headcount` check, and about US$1 of Claude for D1. The 16 real leads so far cost US$5.48 in total, about US$0.34 each.
- **Not in this plan:** decision-maker names, emails and phones. They wait on Levi (Part E).

## Already built

Written on 2 Nov and committed on `decision-makers` (3b1a093). Step A1 merged it into `master`.

- **The client:** [client.py](../engine/backend/core/signalhire/client.py). It finds a company (free), reads its details (1 company credit), counts its profiles (free) and counts people by company, city and seniority (the daily search quota). It has no call for a person, an employee list or contact details. So no name, email or phone can come back.
- **The command:** `uv run --no-sync lead-finder headcount "Culture Amp" --city Melbourne --yes` prints a company's numbers. It uses no database. Without `--yes` it spends nothing.
- **Safety:** the key is `SIGNALHIRE_API_KEY` in `engine/.env`. The logs remove it. The tests blank it, so no test reaches Signal Hire. A slow paid call is never sent twice.
- **Tests:** 39 new tests. The whole fast suite passes: 1,909 passed, 28 skipped.
- **Not built:** nothing feeds a lead yet. The research doesn't call Signal Hire, and the lead card doesn't show it.

## Rules that keep it safe

1. **It fills a gap only.** It runs only when the research and HubSpot found no staff number for the office. It never overwrites one.
2. **It never breaks anything.** Any Signal Hire error becomes one line in the card's problems. The lead is still saved and the run goes on.
3. **One edit turns it off,** with no code change: empty the key in `engine/.env`, or take `headcount_tool` out of `staff_sources` in `criteria.yaml`.
4. **No database change.** The card gets one new list, empty by default, inside its saved JSON. Old cards still load, and `lead-finder rejudge` works as before.
5. **Counts only.** Only a number and a note are kept. No names, emails or phones.

## How to work this plan

Follow "How to work this plan" in [PLAN-V2.md](PLAN-V2.md#how-to-work-this-plan). In short:

- Do one step at a time, in order. A step is done when its "Done when" is true. Tick it in the same turn, with the date and the commit, then add a line to the log.
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

- [ ] **A3. Let the command work while the Company API is off.**
  - Today the command stops if Signal Hire refuses the company lookup (a 403). The city count uses the search, which doesn't need the Company API.
  - Change: on a 403 from the lookup, skip the company details, count people by the name typed, and print "name not checked". A refused key (401) still stops it. So the client needs its own error for a 403.
  - Tests for both cases.
  - **Done when:** the fast tests pass.

- [ ] **A4. Test 5 companies.** This was PLAN-V2 step A3.
  - **Costs money:** up to 5 company credits and 10 searches.
  - Use 5 companies from `testset.yaml`: Culture Amp and Seek (Melbourne), Elders and Maptek (Adelaide), and Mineral Resources (Perth).
  - For each one, write down 4 numbers: Signal Hire's people in the city, Signal Hire's staff for the whole company, the LinkedIn staff count × 2, and a public figure if one exists (an annual report or the company's own site).
  - Put the table in [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md) section 2, with what it shows.
  - **Done when:** the table is written.

## Part B: Decide how far to trust it

- [ ] **B1. Pick the multiplier and the name rule.**
  - **The multiplier.** A LinkedIn count is about half the real staff, so the engine doubles it. Signal Hire's city count may need the same, or a different number. Use the A4 table to pick 1, 2 or another number, and put it in `criteria.yaml` as `headcount_tool_multiplier` (**TBC** with Levi). If the counts are far off for most companies, stop here and write why in the log.
  - **The name rule.** A short or common name can count other companies' people. Example: "Apex" in Perth may count staff at Apex Plumbing too. Our recommendation: use a count only when the Company API has checked the name. Use the typed name only if A4 shows it gives the same counts.
  - **Done when:** both choices are in `criteria.yaml`, and the log says why. Levi confirms later (see "Waiting on Levi").

## Part C: Build it into the research

This is where leads start to change. Each step has its own tests.

- [ ] **C1. The rule settings.**
  - Add `headcount_tool_multiplier`, and the name rule from B1, to `criteria.yaml`. Add their checks to `rules.py`, so a wrong value stops the backend at start-up.
  - **Done when:** the rules tests pass.

- [ ] **C2. The fill-in step.**
  - In `apps/lead_finder/headcount.py`, add a step like HubSpot's `fill_gaps` in `office_numbers.py`. It runs only when all of these hold:
    - The staff number is still unknown after the research and HubSpot.
    - `headcount_tool` is in `staff_sources`, a key is set, and the office's city is known.
    - The company didn't come from the HubSpot watchlist. Levi's OK covers sending HubSpot names to Claude. Whether it covers Signal Hire is **TBC**.
  - It makes one search: people whose current company is this one, in "<city>, Australia".
  - It writes the staff number as the count × the multiplier, labelled "estimated", with a link to the company's Signal Hire page when its slug is known (link format **TBC**). It adds a note. Example: "Staff in Melbourne: about 210, from Signal Hire (105 people on file × 2, TBC)."
  - Any Signal Hire error becomes one line in the card's problems.
  - **Done when:** tests show it never overwrites a number, needs a city, skips watchlist companies, applies the multiplier, and the size rule uses the number.

- [ ] **C3. Call it from the research.**
  - In `research.py`, step 5, after HubSpot fills its gaps and before the rules run. A real client is made from the settings for each company. Tests pass in a fake one.
  - A run researches at most `run_max_companies` companies (20 by default), with 1 search each, so a run uses at most 20 searches.
  - Add an integration test with a fake Signal Hire.
  - **Done when:** the fast and integration tests pass (`uv run --no-sync pytest`, with the database running).

- [ ] **C4. Show it on the lead card.**
  - Add `from_signalhire` to the card: a list of notes, empty by default, like `from_hubspot`.
  - Write the API contract (`uv run engine openapi`) and the website types (`npm run types`).
  - On the lead card, show "From Signal Hire" under "From HubSpot".
  - Give the fake backend one sample company with a Signal Hire note, so the page can be checked without a key.
  - **Done when:** the website lint, types, tests and build pass, and the card looks right in the browser on the fake backend.

## Part D: Check on real companies, then merge

- [ ] **D1. Research 3 real companies.**
  - **Costs money:** about US$1 of Claude and 3 searches.
  - Pick 3 companies whose staff number is hard to find in the news. Read each card. Check the number, the note and the link.
  - **Done when:** the 3 cards look right, or the log says what is wrong.

- [ ] **D2. The full check, then merge.**
  - Run the whole backend suite, the website checks one at a time, and the contract gate (`RUN_GATES=1`).
  - Update [AGENTS.md](../engine/AGENTS.md), the engine README (how to turn it off), Criteria_v2 section 2, and tick PLAN-V2 step A3.
  - Merge the work into `master`. This is Al-khair's call. The code from before Part B is already there (A1).
  - **Done when:** it is merged and the log says so.

## Part E: Later, not in this plan

Each needs Levi's OK first. Each is one small step on top of this plan.

- **Decision makers.** Names and job titles from a Signal Hire search for senior roles. This waits on question 17 in [LEVI.md](../projects/leads/questions/LEVI.md): whether Contour may keep names.
- **Emails and phones.** Only on a click, for one named person, sent straight to HubSpot as a contact and not kept in our database. This needs Levi's OK, a check that the Spam Act allows the outreach, and the HubSpot scope `crm.objects.contacts.write`.
- **More signals.** A leadership change (a senior person who started in the last year), the local team (senior people in Australia against overseas), a growth hint (people now against before) and a recruiter flag.

## Waiting on Levi

- **The multiplier and the name rule** (B1). We build our recommendation, marked **TBC**.
- **HubSpot names to Signal Hire.** Watchlist companies are skipped until he says yes.
- **Names, emails and phones** (Part E).

## Waiting on Signal Hire

- **The Company API** switched on, and the account's company credits and daily search quota (A2).

## Risks

- **The count may be wrong.** Signal Hire's city count may be far from the real staff. A4 shows how far before any lead uses it.
- **Common names.** A short name can count other companies' people. B1's name rule reduces this.
- **The daily quota.** The Signal Hire website shares it. If a run uses it up, the remaining cards say "Signal Hire skipped" and the run goes on.
- **Signal Hire changes its API.** Errors become card problems. Nothing else breaks.
- **Signal Hire's terms** on keeping its numbers are **TBC**. We keep only a count and a note.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-02: A1 done (3b1a093). The work was committed on `decision-makers` and merged into `master` with it, because Al-khair was near the weekly Claude limit and wanted it saved. Next: A2 (new key, Company API), then A3. Nothing is pushed.
- 2026-11-02: Plan written. The client, the `headcount` command and 39 tests were already written, uncommitted, on `decision-makers`. Al-khair says the key is in `engine/.env`. It hasn't been checked with a real call. No steps started.
