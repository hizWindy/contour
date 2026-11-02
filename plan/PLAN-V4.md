# Lead Finder plan, version 4: fix the answer form, and make Signal Hire a main source

This plan fixes the bug that empties every lead's facts, then makes Signal Hire the main source for the data it is best at.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-11-02. **TBC** means not confirmed yet.
- **Progress:** 4 of 16 steps done (A2, B1, B2, B3). Work is on branch `plan-v4`.
- **Replaces:** the open steps of [PLAN-V3.md](PLAN-V3.md) (A2, A4, B1, D1, D2). They are steps A1, C3 and D2 here. PLAN-V3's built work (the Signal Hire client and the staff step) stays as it is.

## In short

- **Goal 1, fix the bug:** since 30 Oct, Claude refuses to fill in our answer form, so every lead's facts are "Not known". Part B fixes the form, checks it can't happen again, and repairs the 23 broken leads.
- **Goal 2, Signal Hire as a main source:** Signal Hire becomes the first source for the data it is best at: company details, staff per city and decision makers. Claude stays the main source for triggers, owner, lease and office size (Part C).
- **Order:** get ready (A), fix the form (B), Signal Hire (C), check on real companies and merge (D).
- **Cost:** about US$10 of Claude in total, plus Signal Hire credits and searches (see "Costs"). One form fill costs about US$0.25 (measured in B1), not the US$0.04 first guessed.

## The bug, in plain words

The research has two steps. First, Claude searches the web and writes notes. Then Claude fills in a form from those notes: website, city, owner, staff, triggers and so on. We make Claude follow the form exactly. This is called strict mode.

Since 30 Oct, the form step fails. Claude's API answers with error 400: "The compiled grammar is too large… Simplify your tool schemas or reduce the number of strict tools." The engine then saves "Nothing useful was found", and every fact is "Not known". The searches are still paid for, about US$0.36 per lead.

| | 27 Oct (worked) | Today (fails) |
|---|---|---|
| Facts in the form | 17 | 27 |
| Fields, counting the parts of each fact | 37 | 51 |
| Size of the form | 5,453 characters | 7,785 characters |
| Leads filled in | 16 of 16 | 0 of 23 (17 on 30 Oct, 6 on 2 Nov) |

The form grew on 30 Oct with Criteria v2 (PLAN-V2) and the decision makers. The tests didn't catch it, because they use a fake Claude that accepts any form. **TBC:** the exact limit, and which fields tipped it over. Step B1 finds out.

Example: Myer, Melbourne, 2 Nov. Claude found 24 notes from 12 searches. The form failed, so the card showed only Signal Hire's staff number.

## Which source is main for which data

Each kind of data comes from the source that is best at it. The backup fills in only when the main source has nothing.

| Data | Main source | Backup |
|---|---|---|
| Checked company name, website, industry, LinkedIn page | Signal Hire (Company API) | Claude |
| Office cities and head office | Signal Hire (Company API) | Claude |
| Staff in the city | HubSpot, then Signal Hire | LinkedIn × 2, then Claude |
| Decision makers: names, job titles, seniority | Signal Hire (search) | Claude (public pages) |
| Triggers, owner, lease end, office size, healthy business, office history | Claude | none |

The staff order is the one in [Criteria_v2.md](../projects/leads/criteria/Criteria_v2.md) section 2. Today the code asks Signal Hire only after Claude, which is the wrong way round. Step C3 fixes it.

**When two sources disagree (TBC with Levi):** the main source wins. Both values show on the lead card. A big gap raises a flag for a person to check, like staff counts more than 2 times apart, or two different cities.

## Rules that keep it safe

1. **Nothing breaks a run.** A Signal Hire or Claude error is one line in the card's problems. The lead is still saved, and the run goes on.
2. **A failed form is never hidden.** It shows on the card, on the run page and in the Results table (B4).
3. **Names and job titles only.** No emails or phones are fetched or kept in this plan. Contact details come later, on a click, for one person (Part E).
4. **HubSpot names stay home.** A watchlist company goes to Signal Hire only when `HUBSPOT_NAMES_TO_SIGNALHIRE_OK=true` (built in PLAN-V3).
5. **Credits are capped.** A run can't spend more Signal Hire company credits than a setting allows (C1).
6. **Retail and site-heavy companies:** Signal Hire's staff count includes shop and site staff. For those companies it gives a flag, never a fitout value (C4). Example: Myer, 2,868 people on file × 2 = 5,736 staff and an A$86M fitout, which is wrong for its office.
7. **Each step can be turned off** in `criteria.yaml` or `engine/.env`, with no code change.

## How to work this plan

Follow "How to work this plan" in [PLAN-V2.md](PLAN-V2.md#how-to-work-this-plan). In short:

- Do one step at a time, on branch `plan-v4`. A step is done when its "Done when" is true. Tick it in the same turn, with the date and the commit, then add a line to the log.
- Check Claude's usage at the start of each step. At 80% on either limit, save to the AI Brain. At 95%, start no new step.
- **Costs money** marks a paid step: Claude money, Signal Hire credits or searches. Run it only when Al-khair says so.
- One heavy test run at a time: the backend and website tests together run out of memory on this laptop.
- Restart the backend after a change to `criteria.yaml` or the code. It reads the rules once, at start.
- A choice still open with Levi is not a hard rule. Build our recommendation, put the number in `criteria.yaml`, and mark it **TBC**.

## Part A: Get ready

- [ ] **A1. Email Signal Hire support.** Al-khair, by hand. Was PLAN-V3 A2.
  - Ask them to switch on the Company API. A free check on 2 Nov got a 403, so it is off.
  - Ask how many company credits the account has, and the daily search quota (**TBC**).
  - Ask how the Person API sends its answer. It may need a callback address on the internet, and our backend runs only on this laptop (**TBC**, needed for Part E).
  - Make a new key and put it in `engine/.env` as `SIGNALHIRE_API_KEY=`. The current one was shown in screenshots.
  - **Done when:** the email is sent and the new key is in. Part B doesn't wait for the answer.

- [x] **A2. Make the branch and take a baseline.** Done 2026-11-02, 1f12544.
  - Make `plan-v4` from `master`. Run the backend suite with `RUN_GATES=1`, then the website checks, one at a time. On 2 Nov: backend 2,431 passed and 25 skipped, website 690 tests.
  - **Done when:** the numbers are in the log.
  - The baseline is the 2 Nov run on the same code (ddc7825): backend 2,431 passed and 25 skipped with `RUN_GATES=1`, website 690 tests. `plan-v4` only added the plan.

## Part B: Fix the answer form

- [x] **B1. Find the limit.** Done 2026-11-02, b900246. **Costs money:** a few cents of Claude.
  - Send today's form to Claude once, with a short sample of notes, and see the same 400 error.
  - Then try smaller forms to find what fits: today's form split in two, and the 27 Oct form.
  - Write in the log what fits and what fails, with sizes.
  - **Done when:** we know a form size that works, with room to spare.
  - Found: Anthropic allows at most 16 fields that can be "null or a value" in one strict request (its limit on union types). Today's form had 18, the 27 Oct form 16. The real Claude refused today's form with the same 400. The fixed form (3 such fields) was accepted and filled correctly: website, city, 250 staff, the contact role and 1 decision maker. One fill cost US$0.25.

- [x] **B2. Split the form in two.** Our recommendation, unless B1 shows a cheaper fix. Done 2026-11-02, b900246.
  - Form 1, the facts the rules need: website, city, industry, owner, staff, office size, local team, healthy, the office matters, triggers, boosters, expected move, growth.
  - Form 2, the rest: office history, past fitout firms, talking points, decision makers, contact role, summary, opening line.
  - Both use the same notes. Form 2 runs only if Form 1 worked. If Form 2 fails, the lead still gets Form 1's facts, and the card says what is missing.
  - The fact names stay the same, so the rules, the score, the website and old cards don't change.
  - **Cost:** about one more Claude request per company, about US$0.04 (**TBC**: measure in D2).
  - **Done when:** the fast and integration tests pass, and one real request per form works (a few cents).
  - Changed on the day: no split. B1 showed a cheaper fix. A text that may be unknown (a fact's link, date and label, a trigger's date, a decision maker's date, the industry and tier groups, the contact role, the opening line) is plain text in the form Claude gets, and empty text means unknown. Python, saved cards and the website still get null. Only a fact's value can be null, so 3 such fields are left. One Claude request per company, as before, so no extra cost.

- [x] **B3. Make sure it can't happen again.** Done 2026-11-02, b900246.
  - A free test that fails when any form is bigger than the size B1 found, minus a margin. It runs in the commit hook.
  - A `live` test that sends each form to the real Claude once. It is off by default and run by hand before a merge (a few cents).
  - **Done when:** both tests exist, and the free one fails on today's big form.
  - Changed on the day: the live check is a command, `uv run --no-sync lead-finder forms --live --yes`, not a pytest test, because the tests blank the Claude key. Without `--live`, `lead-finder forms` prints each form's size for free. The free test is `tests/lead_finder/test_forms.py`.

- [ ] **B4. Show a failed form clearly.**
  - Today a failed form looks like a normal "Watch" lead with "Nothing useful was found".
  - Change: the card shows a clear message, like "Facts missing: the answer form failed. Re-check this lead." The run page counts these leads, and Results can filter them.
  - **Done when:** the website tests pass, and the message shows in the browser on the fake backend.

- [ ] **B5. Repair the 23 broken leads.** **Costs money:** about US$0.25 per lead, about US$5.75 in total (**TBC**; was US$2.30 before B1 measured a fill).
  - Their notes are saved in memory, so they don't need new searches. Add a command, `lead-finder refill`, that fills the form again from the saved notes and judges the lead again.
  - Memory keeps notes fresh for 30 days, so notes from 30 Oct can be used until 29 Nov.
  - **Done when:** the 23 leads have their facts, and the log lists how many changed result.

## Part C: Signal Hire as a main source

- [ ] **C1. Company details first.** Needs A1 (the Company API on). **Costs:** 1 company credit per company.
  - Before Claude searches, look the company up: find it (free), then read its details (1 credit). We get the checked name, website, industry, office cities and head office, LinkedIn page and Signal Hire's whole-company staff estimate.
  - Pass them to Claude as hints, so its searches go to what only Claude can find: triggers, lease, office size.
  - Save the details for 30 days, so the same company is paid for once a month, not once per run.
  - A new setting caps the credits per run: `signalhire_max_credits_per_run`, 20 to start (**TBC** with Al-khair).
  - **Done when:** tests with a fake Signal Hire show the details fill the facts, a second run uses the saved details, and the cap stops at its limit.

- [ ] **C2. The main source for each fact, and conflicts.**
  - Put the table from "Which source is main for which data" in `criteria.yaml`, so it can change with no code change.
  - When two sources disagree, the main source wins, and both values are kept on the card. A big gap raises a flag.
  - **Done when:** tests cover a fact from each source, a backup filling a gap, and a conflict flag.

- [ ] **C3. Staff in the right order, and the multiplier.** Was PLAN-V3 A4 and B1.
  - Order: HubSpot, then Signal Hire, then LinkedIn × 2, then Claude. Today Signal Hire only fills after Claude.
  - Set `headcount_tool_name_check` back to `required` once the Company API is on.
  - The multiplier (2 today) gets its real value from the test of 5 companies in D2.
  - **Done when:** tests show the new order, and the name check follows the Company API.

- [ ] **C4. The guard for retail and site-heavy companies.**
  - If the company's industry is in `industries.check_office_size` in `criteria.yaml` (retail, mining and similar), a staff number from Signal Hire is only a hint. It raises "check the office size" and gives no fitout value.
  - **Done when:** a test like Myer (retail, 5,736 staff) gets a flag and no fitout value.

- [ ] **C5. Decision makers from Signal Hire.** **Costs:** 1 more search per company, from the daily quota.
  - Levi said yes to decision makers (2 Nov, to Al-khair). Write this in [LEVI.md](../projects/leads/questions/LEVI.md) as the answer to question 17: names and job titles yes. Emails and phones are still open.
  - Search the company's senior people in the city (C-Level, VP, Directors, Head). Keep the top 5: name, job title, seniority and Signal Hire id. The id lets Part E get a contact later.
  - Add them to "Who to talk to" beside the leaders Claude finds on public pages, with the source of each.
  - First check one real search answer has job titles (**TBC**). Today we ask for 1 profile and read only the count.
  - **Done when:** tests with a fake Signal Hire show the names on the card, and no email or phone is kept.

- [ ] **C6. Show where each fact came from.**
  - On the lead card, each fact shows its source: Claude, HubSpot or Signal Hire. A conflict shows both values and the flag.
  - The fake backend gets one sample lead with Signal Hire company details, decision makers and one conflict.
  - **Done when:** the website lint, types, tests and build pass, and the card looks right in the browser, on a desktop, a phone and in dark colours.

## Part D: Check on real companies, then merge

- [ ] **D1. The full check.**
  - The backend suite with `RUN_GATES=1`, the `live` tests from B3, then the website checks, one at a time.
  - **Done when:** everything passes, and the numbers are in the log.

- [ ] **D2. Research 5 real companies.** **Costs money:** about US$3.70 of Claude, up to 6 company credits and about 12 searches (**TBC**).
  - Use Culture Amp and Seek (Melbourne), Elders and Maptek (Adelaide) and Mineral Resources (Perth), plus Myer as the retail case.
  - For each, write down: the facts and their sources, the decision makers, any conflicts, and the cost. Compare Signal Hire's staff with the public staff number, and set the multiplier (was PLAN-V3 A4 and B1). Put the table in Criteria_v2 section 2.
  - **Done when:** the cards look right, or the log says what is wrong.

- [ ] **D3. Docs, then merge.**
  - Update [AGENTS.md](../engine/AGENTS.md), the engine README, Criteria_v2 section 2 and the AI Brain.
  - Merge `plan-v4` into `master`. This is Al-khair's call. Nothing is pushed unless he asks.
  - **Done when:** it is merged and the log says so.

## Part E: Later, not in this plan

- **A contact on a click:** email and phone for one named person, from Signal Hire's Person API, sent straight to HubSpot and not kept in our database. This needs Levi's OK on emails and phones, a Spam Act check, the HubSpot scope `crm.objects.contacts.write`, and the A1 answer on how the Person API replies. It costs credits per contact.
- **Free data sources:** WGEA (staff size bands), AusTender (big contracts), Adzuna (job ads) and ABN Lookup (official names). See the AI Brain idea note "More research power for the Lead Finder".

## Waiting on

- **Signal Hire support:** the Company API, credits and quota, and how the Person API replies (A1). C1, C3 and C5 need the Company API.
- **Levi:** the conflict rule (C2), the credit cap (C1), and emails and phones (Part E).
- **Al-khair:** the email to support and the new key (A1), and the go-ahead for each paid step.

## Costs

| Step | Claude | Signal Hire |
|---|---|---|
| B1 | US$0.25 (done) | none |
| B5 | about US$5.75 | none |
| D2 | about US$3.70 (6 companies, about US$0.60 each) | up to 6 credits, about 12 searches |
| Each run, after this plan | no more than today (B2 needed no second request) | up to 1 credit and 2 searches per company, capped (C1, C5) |

All amounts are **TBC** until measured.

## Risks

- **The fix needs more than a split.** If two forms still fail, B1 will show it. Then the forms get smaller again, or some fields move to plain text.
- **Signal Hire's details are wrong or old.** The conflict flag (C2) shows the gap, and a person decides.
- **Credits run out.** The cap (C1) stops a run from using them all. The run goes on without Signal Hire, and each card says so.
- **The search answer has no job titles.** Then C5 keeps names and seniority only, and the log says so.
- **Privacy.** Names and job titles of business leaders are kept. Levi said yes to decision makers. Emails and phones stay out until Part E.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-02: A2, B1, B2 and B3 done (b900246). The form bug is fixed: Claude refused today's form (18 "null or a value" fields, limit 16) and accepted the fixed one (3). One fill costs US$0.25, so B5 and D2 cost more than planned (see "Costs"). Next: B4.

- 2026-11-02: Plan written. Facts found the same day: the form fails on every lead since 30 Oct (23 leads); today's form has 27 facts and 7,785 characters, against 17 facts and 5,453 characters on 27 Oct; Signal Hire's search works with our key, and its Company API is off (403). No step started.
