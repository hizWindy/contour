# The Lead Finder fix: plan, version 20

This plan fixes the Lead Finder after the live run of 17 Nov, and takes out the goal of good leads. Since 16 Nov Claude had refused the company answer form every time, so every company came out with no facts. The run kept paying for the next company. The plan splits the form in two, stops a run at the first refusal, takes out the goal that never stopped a run, lists every company a run researched, and makes automatic runs look back 30 days.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair. Levi confirms the numbers marked **TBC with Levi**.
- **Last updated:** 17 Nov 2026 (built on branch `plan-v20`, checks run, merged into `master` by fast-forward; not pushed, not deployed).
- **Progress:** S1 to S6: 6 of 6. Merge and deploy: 2 of 4 (M0 merge, M1 live form test). The deploy (M2) and the refill of the 9 failed leads (M3) wait on Al-khair's word.
- **Sources:**
  - the live run `f4d799ee` (17 Nov, stopped by Al-khair at US$8.52, 3 of 3 researched companies with a failed form) and the 7 live runs before it;
  - the live server log, `claude_error`: HTTP 400, "The compiled grammar is too large";
  - the code on `master` (`0c9b68f`), read on 17 Nov;
  - Al-khair's decisions in chat on 17 Nov: no goal of good leads, don't make the engine narrow or strict.

## What was wrong

| What | The numbers |
|---|---|
| The answer form | 7,687 characters worked live until 15 Nov. PLAN-V16 made it 10,357 (5 more facts), and Claude refused it every time with a 400. It had 3 null-or-value fields and no optional ones, so our check of the field counts said it was fine. |
| The damage | 9 of 9 companies researched on the live site since 16 Nov have `form_failed`: US$6.25 of research spent, nothing saved but notes. The run kept going to the next company. |
| The goal of 20 | It never stopped a run: the 7 live runs found 0 to 3 good leads. It only showed a bar that read 0 of 20. |
| Companies under 40 | The run page counted them and linked to Results, so a run of weak companies looked empty. |
| The look-back | 14 days for an automatic run (the time between runs), against 30 for a run a person starts. |

## The steps

- [x] **S1. Split the form.** `CompanyCoreForm` (7,697 characters, the form that worked) and `CompanyExtrasForm` (4,393: `staff_projected`, `tender_only`, `dampeners`, `contact_roles`, `contour_angle`). The research asks both side by side and joins the answers into one `CompanyFacts`, so the card, the API and the score don't change. The second form failing keeps the first form's facts. `core.claude.forms.CHARACTERS_LIMIT` (8,000) is part of `within_limits`, so a form that is too big fails a test first.
- [x] **S2. Stop at a refusal.** `ClaudeRefused` (a `ClaudeUnavailable`) for HTTP 400: the research stops, the run fails in plain words ("Claude refused the request"), the companies after it are never started, and what was paid for is logged and its notes kept. A resume after a fix doesn't pay for them again. Call prep and the pre-read keep their old words for it (`claude_words`): the key and the connection are fine, so it is not a "set up" problem there.
- [x] **S3. No goal stops a run.** A run a person starts has no goal, no estimate sentence about companies needed, and no "Found 12 of 20 leads". An automatic run still reports against its share of the round's goal (Levi's 100), and it never stops for it. The setting `manual_run_goal_leads`, the "How many leads" field on Start and the pass-rate estimate are gone. `goal_leads` is still accepted in a run's params and ignored, so a page that was open before the change can start a run.
- [x] **S4. Every company is listed.** The run page lists the companies under 40 in a "Scored under 40" group, and the card is "Companies from this run". The goal bar shows only for an automatic run.
- [x] **S5. Automatic runs look back 30 days** (`LOOK_BACK_DAYS`, `round.look_back()`). A company researched in the last 30 days is skipped anyway, so the overlap costs nothing.
- [x] **S6. Check.** All of S1 to S5 are in one commit (17 Nov). Backend: ruff and ruff format, mypy, and the fast tests (the commit hook); the full run before the last fixes was **4,706 passed, 25 skipped, 7 failed**, the 7 being tests that still expected the old goal or the 14 days, and `tests/lead_finder` with `tests/companies` after the fixes **2,462 passed**; the API contract and the website types made again and unchanged by a second run; `alembic heads` one head (`0024_v18_teams_activity`, no migration here). Website: lint and types clean, **1,954 tests passed (137 files)**, the build, and Prettier. `lead-finder forms` (free): company facts 7,697 characters, company extras 4,393, both inside the 8,000 limit.

Merge and deploy:

- [x] **M0. Merge** (17 Nov): `master` moved from `0c9b68f` to `plan-v20` by fast-forward, after the checks above. Not pushed.

- [x] **M1. The live form test** (17 Nov, on Al-khair's word in chat): `lead-finder forms --live --yes` sent each form to Claude once at low effort. **All five were accepted by `claude-opus-5-5`, US$0.0611 in all:** search notes US$0.0032, company facts (the main form, 7,697 characters) US$0.0308, company extras (4,393) US$0.0168, discovery US$0.0066, why now US$0.0037. This is the real API accepting the two new forms. The key was loaded into that one process from the main `engine/.env` and not written anywhere.

Waiting on Al-khair's word (on the live site, or paid):

- [ ] **M2. Push and deploy** (`deploy v20`). App Platform has `deploy_on_push` off.
- [ ] **M3. Refill the 9 failed leads** from their saved notes: `lead-finder refill --yes` in the DigitalOcean console, about US$0.35 a lead (TBC, it was US$0.25 for one request), 2 requests, no web search. Without it, a new run skips those companies for 30 days (their notes are fresh).

## Not done here, on purpose

- **More companies per run** (more search passes until it has enough, a 90 day window, more signs on by default). A run finds about 7 companies (66 searches found 46 in the 7 live runs). That is its own piece, to test on one city first.
- **The score and the tiers.** Not touched. After M3 the 9 leads show how the new score judges real facts, and Levi decides about the cutoffs.
- **Effort "max".** The live setting is `max` (default `medium`): each company cost about US$1.75, and the dampener search was skipped for lack of room under the US$2.50 company cap. Try `medium` on one city and compare.

## Log

- 2026-11-17: S1 to S6 built on `plan-v20` (from `master` at `0c9b68f`). The two forms are 7,697 and 4,393 characters, and the first has the same questions, in the same order, as the form that worked up to V15. The fake Claude answers both forms; a research is now 6 requests and US$0.01 more on the fake.
- 2026-11-17: **Two things worth knowing.** (1) The two forms are asked at the same time, so a company that is just under its cap can pass it by one more form request (about US$0.1 to 0.3). Before, it was one request. (2) A lead judged before the tiers existed has no tier, so the run page lists it by its result: a Pass or a Director review with the ranked leads, a Watch with Tier C, a Drop under 40. A company researched in the last 30 days is still skipped by a new run unless it has a new sign, so the 9 failed leads need M3.
- 2026-11-17: **Merged** into `master` by fast-forward (the commit of this line). Not pushed, not deployed.
- 2026-11-17: **M1 done.** The live form test passed: all five forms accepted, US$0.0611 (see M1). The first try in this shell had no Claude key in its environment, so Claude was never asked and nothing was spent. The second try loaded the key from the main `engine/.env` into that one process.
- 2026-11-17: **The number.** This plan was written as PLAN-V19. The Improvements 2 plan took V19 in the main folder that same morning (uncommitted, written before this one), so this plan is V20 and nothing of the other plan was touched. `CLAUDE.md` has no pointer to this plan yet: the main folder's own `CLAUDE.md` edit was uncommitted, so it was left alone. Add one line when that edit lands: "PLAN-V20 is the Lead Finder fix of 17 Nov, built and merged into `master`, not deployed; its open steps are M1 (the live form test), M2 (`deploy v20`) and M3 (refill the 9 failed leads)."
