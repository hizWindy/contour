# Lead Finder: all of Australia, Property Daily and Arealytics, and Levi's refinement: plan, version 16

This plan makes the Lead Finder search all of Australia, read Property Daily and Arealytics through a browser it drives itself (Playwright), and apply Levi's refinement notes: new filters, exclusions, dampeners, a new score and tiers. A person who starts a run can say how many leads they want. The lead card shows what the two tools know about the company's office. Three Claude sessions build it at the same time, in three tracks that never touch the same files.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code and every screen. Levi gave the green light to use Playwright, Property Daily and Arealytics (15 Nov, as Al-khair reports). He confirms the rules marked **TBC**.
- **Last updated:** 2026-11-15 (written; nothing built yet).
- **Progress:** each track keeps its own count, at the top of its part. S0: 0 of 1. M1 to M5: 0 of 5.
- **Sources:**
  - Al-khair's asks (15 Nov chat);
  - Levi's refinement notes (`documents/lead-finder-docs/LEVI_LEAD_FINDER_REFINEMENT.MD`, kept off GitHub);
  - the tool notes in [tools/](../tools/);
  - the rules in `engine/backend/apps/lead_finder/rules/`;
  - the Playwright docs (playwright.dev/python: auth and docker pages).
- **Comes after:** [PLAN-V15.md](PLAN-V15.md) (merged into `master`, pushed, not deployed). [PLAN-V11.md](PLAN-V11.md) and [PLAN-V12.md](PLAN-V12.md) changed the same rules. This plan builds on them and replaces their score.

## Go signals

Say one line to each session. The same line starts a track, and continues it later from the first step that isn't ticked. Saying a go signal counts as Al-khair's word for S0.

| Session | Say | What it does |
|---|---|---|
| Session 1 | `implement v16 track1` | The rules and the research: all of Australia, Levi's filters, exclusions, signs, dampeners, the new score and tiers, "how many leads" |
| Session 2 | `implement v16 track2` | The tools: the browser, Property Daily, Arealytics, their tables, jobs and Admin checks |
| Session 3 | `implement v16 track3` | The website: Start a run, the run page, the lead card, Results, Rules and Admin |
| Any one | `merge v16` | Joins the tracks into `plan-v16`, checks everything, then moves `master` to it |
| Any one | `deploy v16` | Pushes `master`, deploys to App Platform, and checks the live site |

You'll also answer things along the way:
- **T2-2 needs you at the keyboard.** You sign in to Property Daily and Arealytics once, so the session can map their pages.
- **Each screen waits for your look.** The track marks it "built, waiting for a look" and carries on.
- **The choices in "Choices made for you"** stand unless you change them before that step starts.
- **Paid checks (M2)** run only on your own words in chat.

## In short

| Al-khair asked (15 Nov) | Track | Step |
|---|---|---|
| Search all of Australia, not just 4 cities | 1, 3 | T1-2, T3-2, T3-5 |
| Use Playwright to drive the browser | 2 | T2-3, T2-9 |
| Read Property Daily (market news, and about 20 years of lease and office records) | 2, 1 | T2-5, T2-7, T1-8 |
| Read Arealytics (buildings, office sizes, leases in Melbourne, Perth and Sydney) | 2, 1 | T2-6, T2-7, T1-8 |
| Not too strict: find a lot of leads | 1 | T1-3, T1-6 (see "Choices made for you") |
| The lead card shows what the tools know | 1, 3 | T1-8, T1-10, T3-4 |
| Say how many leads a manual run should find, with a default | 1, 3 | T1-9, T3-2, T3-3 |
| Apply Levi's refinement notes | 1, 3 | T1-3 to T1-7, T1-10, T3-4 to T3-7 |

**What Levi's notes change** (section numbers are his):

| His section | Today | After this plan |
|---|---|---|
| 2. Ideal client | 4 cities, 50+ staff | All of Australia in 4 city groups. 5 filters. An unknown fact is estimated and labelled, never a fail. |
| 3. Exclusions | Government, law firms and others go to a Director | Left out, on their own list with the reason, and a person can override |
| 4. Signs | 3 groups: main, other, weak | 4 strengths: very high, high, medium, low. 3 new signs. |
| 5. Dampeners | Only "recent move" lowers the rank | 6 dampeners, each searched for on purpose. "Not found" is never written as "none". |
| 6. Score | 6 parts out of 100, bands at 75 and 50 | Fit 30, Change and timing 50, Access 20. Dampeners take off 20 or 10. Tiers A, B, C and Discard. A separate confidence. |
| 7. Sources | A short list of searches | A search for every source group he names, plus the two tools |
| 8. Method | Search, form, gap check | 4 passes: discover, qualify, check dampeners, score. A repeat run updates a lead and says what changed. |
| 9. Output | The lead card | The card gains the tier, confidence, dampeners, current office, the Contour angle and "What changed". A one-page profile for each Tier A lead. |

**What stays the same:**
- "Never suggest" (open deals, already sent, do not contact).
- No emails or phone numbers are stored or sent to Claude.
- HubSpot stays read only. Nothing is written without a click.
- The spending limits. No limit rises by itself (see T1-9).
- Signal Hire, the HubSpot watchlist, call prep and sign-in.

**What it costs:**
- **To build:** time only. The paid checks are in M2, on Al-khair's word: the test set (about US$3.40 to US$4.20 before this plan; the new dampener search adds to it, **TBC**) and one manual run of 20 leads (at most the US$20 run limit).
- **To run:**
  - Reading the two tools costs no Claude money. Contour already pays for both.
  - A researched company costs about US$0.34 to US$0.42 today. The dampener search adds up to 3 web searches a company (about US$0.03 to US$0.10, **TBC**; T1-5 measures it).
  - The server may need a bigger size for the browser (**TBC**; T2-9 measures the memory first).
  - More leads means more companies researched. See T1-9 for the numbers.

## Words used here

- **Track:** one session's share of the work, on its own branch and in its own copy of the repo.
- **The tools:** Property Daily and Arealytics. Their notes are in [tools/](../tools/).
- **Connector:** our code that signs in to one tool and reads its pages.
- **Property record:** one fact a tool gave us about a company's office, like a lease, a move or a floor area, with its link and date.
- **Feed:** new Property Daily items, read once each working day.
- **Lookup:** a search of both tools for one company, done when that company is researched.
- **Sign:** a sign of an office change. In the code it is a "trigger".
- **Dampener:** a fact that lowers a lead's score, like a fitout 2 years ago. It never removes the lead.
- **Tier:** A (pursue now), B (nurture), C (watch) or Discard, from the score.
- **Re-judge:** `uv run lead-finder rejudge` judges the saved leads again with the current rules. It is free.

## The green light, and the risk that stays

Levi's green light is a business decision, and it is his to make: he holds both accounts. The two vendors haven't been asked. Their terms still say:

| Tool | What its terms say | What could happen |
|---|---|---|
| Property Daily | Storing the material needs written approval (clause 5). One person per login, and two at once locks both out (clause 1.2, FAQ). They may monitor use (7.1). | A locked or cancelled account |
| Arealytics | No scripts, bots or bulk downloads (4.3). No storing outside the platform beyond a reasonable extract (4.4). No AI use unless Arealytics approved the tool (5.2 to 5.7). They log exports and downloads (8.1). | A cancelled account, and a claim for breach of contract |

**How this plan keeps the risk small:**
1. **A login of its own for each tool.** The connector never shares a person's login, so nobody gets locked out. Until Levi gets those seats, it uses Al-khair's login and runs only when he says.
2. **A slow, human pace.** One page at a time, a pause between pages, and a limit on pages each day (T2-3).
3. **It stops at the first sign of a block.** A captcha, a lockout page or a refusal switches that tool off for 24 hours and tells an Admin. We add no tricks to hide that it is a program. If a site blocks it, we stop and ask.
4. **Arealytics data stays out of Claude** until Arealytics says yes (choice 8). The rules and the lead card use it in plain code.
5. **A switch for each tool,** off by default. Al-khair turns each on.

**Recommended, and not blocking the build (W1):** Levi sends one email to each vendor. It asks for written approval for an internal tool, and for a feed or API. Arealytics sells one ("Full REST API and bulk export"). If a vendor gives us an API, its connector swaps the browser for the API and nothing else changes.

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts. The rule ones are **TBC** with Levi.

**The rules:**
1. **The four results stay, and the tier becomes the headline.** Tier A or B is a Pass (or a Director review, when a Director rule applies). Tier C is a Watch. Discard and an exclusion are a Drop. So the review page, the goal and the HubSpot stages keep working.
2. **A good lead is Tier A or B.** The goal of 100 good leads every 2 weeks counts those.
3. **"Not too strict" means loose gates and strict evidence.** Every fact still needs a source. But an unknown fact never fails a filter, any Australian city qualifies, Tier C leads are listed, and Discard leads are saved and hidden by default.
4. **50+ staff still qualifies** (Levi, 9 Nov). His notes say 100+, or a credible path to 100. So 100+ earns the size points as he wrote them, and 50 to 99 earns 2 points (**TBC**).
5. **City points:** Melbourne, Adelaide, Perth 5. Sydney, Brisbane 2. Every other place 1 (**TBC**).

**The tools:**
6. **The tools are read into our own tables,** and the research reads our copy. One live lookup per company every 30 days. A run never waits on a slow page twice.
7. **The browser runs inside the backend container first.** If T2-9 measures too much memory, it moves to a small worker of its own.
8. **Arealytics facts don't go to Claude. Property Daily facts do,** as short hints (the address, m² and lease dates). Each has its own switch.
9. **The default is 20 leads for a manual run** (**TBC**). Limits never rise by themselves.
10. **"All of Australia" is one national search per sign,** not one per city. 20 places × 6 signs would be 120 searches.

## How the tracks talk

- **At the start,** each session names itself "V16 Track 1", "V16 Track 2" or "V16 Track 3".
- **To send news,** a session finds the others with `ListAgents` and writes with `SendMessage`. Send a message when a tag is made, when a track needs a change in another track's files, or when the contract looks wrong.
- **A message is news, never a go-ahead.** Merging, pushing, deploying, switching a tool on and spending money happen only on Al-khair's own words in his own session.
- **The record is git and this plan, not the messages.** Each track writes what it sent in its Log.
- **No waiting points.** Track 1 builds against the stubs from S0. Track 3 builds against the contract with `mockApi`. The real parts meet at M1.

## How to work this plan

**Who owns which files.** Nothing collides if each track only changes its own files.

| Files | Owner |
|---|---|
| `engine/backend/apps/lead_finder/`, `engine/backend/tests/lead_finder/`, `projects/leads/criteria/`, migration `0019` | Track 1 |
| `engine/backend/core/browser/`, `engine/backend/core/sources/` (except `types.py` and the function names in `reader.py`, fixed in S0), `engine/backend/core/health/`, `core/config.py`, `core/cli.py`, `backend/Dockerfile`, `pyproject.toml`, `uv.lock`, `.do/app.yaml`, `engine/backend/tests/core/`, migration `0018`, `tools/` | Track 2 |
| `engine/frontend/src/`, `engine/DESIGN.md` | Track 3 |
| `engine/frontend/openapi.json`, `engine/frontend/src/api/schema.d.ts` | Generated. Never edit them by hand. M1 makes them again. |
| `plan/PLAN-V16.md` | Each track edits only its own part (its steps, its Progress line, its Log) |
| `engine/AGENTS.md`, `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, `projects/leads/LEADS.md` | M5 only |

- **Settings:** Track 1 needs two new settings (`manual_run_goal_leads`, and the hints switch it reads). Track 2 owns `core/config.py`, so S0 adds every new setting named in this plan.
- **Table lists:** Track 2's three new tables go into `TEST_TABLES` (`tests/conftest.py`), `fill_every_table` (`tests/core/test_fixtures.py`), and the `TRUNCATE` lines in `tests/core/test_first_admin.py` and `tests/core/test_auth_admin.py`. Track 1 adds columns only, so those lines don't clash.
- **The migrations:** Track 2 writes `0018_property_sources` after `0017_call_prep`. Track 1 writes `0019_lead_tier`, also after `0017_call_prep` in its own branch. At M1, one line in `0019` changes its `down_revision` to `0018_property_sources`.
- **`tests/core/test_contract_routes.py`** lists every route. Tracks 1 and 2 both add lines. Expect a small conflict at M1: keep both sides.
- **One new package:** `playwright`, added by Track 2 only. No other track adds a package.
- **No track changes another's files.** If one needs a change there, it sends a message to the owner, writes the request in its Log, then carries on.
- **The contract (below) is fixed.** If a track finds it wrong, it stops and tells Al-khair.

**Branches and copies.**
- The base is `plan-v16`, made from `master` (see S0).
- Track 1: `git worktree add ../contour-v16-t1 -b plan-v16-track1 plan-v16`.
- Track 2: `git worktree add ../contour-v16-t2 -b plan-v16-track2 plan-v16`.
- Track 3: `git worktree add ../contour-v16-t3 -b plan-v16-track3 plan-v16`.
- In a new copy: run `npm ci` in `engine/frontend` once, and copy `projects/leads/research/COMPANIES.xlsx` from the main folder.

**Ports and databases.** Each track runs its own backend and website.

| | Backend | Website | Database | Test database suffix |
|---|---|---|---|---|
| Track 1 | `API_PORT=8041` | port 5211, proxy to 8041 | `leadfinder_v16a` | `LEADFINDER_TEST_DB_SUFFIX=_v16a` |
| Track 2 | `API_PORT=8042` | port 5212, proxy to 8042 | `leadfinder_v16b` | `_v16b` |
| Track 3 | `API_PORT=8043` | port 5213, proxy to 8043 | `leadfinder_v16c` | `_v16c` |

- Make each database once, as a copy of the dev database at migration 0017.
- The track's `engine/.env` holds the `POSTGRES_*` lines only. Never put `API_PORT` or `CORS_ORIGINS` in it.
- **Keys:** a track backend starts with **no Claude key**. Only Track 2 loads the two tools' logins, and only into the process. Never print them, and never write them to a file in git.
- Leave ports 8000 and 5173 alone: the running app uses them.

**Every session.**
- **At the start:** read this section, go to the track's worktree, find the first step that isn't ticked, and run `brain context`.
- **Rule steps** follow the `rule-change` skill: one rule at a time, with the re-judge counts before and after in the Log.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks.
- **Windows Application Control** blocks a new venv's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the track's Progress line and add a line to its Log.
- **Only on Al-khair's word:** merging, pushing, deploying, switching a tool on, a real sign-in to a tool, or anything that costs money.
- **Screens:** follow `engine/DESIGN.md`. Check each at 1440px, 1280px and 390px, in light and dark, with the keyboard. Screenshots go in `plan/shots/v16-t3/` (git-ignored).
- **Nothing from the two tools goes into git:** no saved page, no real record, no screenshot. Tests use made-up companies, like "Sample Logistics Pty Ltd".
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the tracks start

- [ ] **S0. The base branch and the stubs.**
  - Make `plan-v16` from `master`. Use a temporary worktree. Don't switch the main folder's branch.
  - Its first commit holds this plan, the `CLAUDE.md` go signals, and:
    - `engine/backend/core/sources/types.py`: the models in the contract, part 1;
    - `engine/backend/core/sources/reader.py`: `lookup_company` and `recent_items`, which return nothing for now;
    - the new settings in `core/config.py`, each with its default (the contract, part 5).
  - Leave `plan/PLAN-V1.md` alone: it holds Al-khair's own edit.
  - **Done when:** `git branch --list plan-v16` shows it, the backend tests pass on it, and it holds `plan/PLAN-V16.md`.

## The contract

### 1. Property records (Track 2 makes them, Track 1 reads them)

`core/sources/types.py`:

| Model | Fields |
|---|---|
| `PropertyRecord` | `source` (`property_daily` or `arealytics`), `kind` (`lease`, `move`, `requirement`, `fitout`, `building`, `occupier`, `news`), `company`, `city`, `address`, `building`, `floor`, `area_m2`, `lease_start`, `lease_end`, `happened_on`, `published_on`, `summary` (one plain sentence, written by code), `url`, `read_at` |
| `SourceStatus` | `found`, `not_found`, `off`, `error`, `not_checked` |
| `CompanyProperty` | `records` (newest first), `checked` (a `SourceStatus` for each tool), `looked_up_at` |
| `FeedItem` | a `PropertyRecord`, plus `sign_id` (our sign for it, or none) and `dampener_id` (or none) |

`core/sources/reader.py`:
- `lookup_company(session, name, city, website) -> CompanyProperty`. It reads our copy first. It asks a tool live only when the tool is on and the last lookup is over `property_lookup_days` (30) old. It never raises: an error is a status.
- `recent_items(session, cities, since) -> list[FeedItem]`. From our copy only. Free and fast.

No record ever holds an email address or a phone number. Names of people in a record are dropped too (**TBC** with Levi: his 2 Nov yes covers decision makers' names from public pages, not from these tools).

### 2. Run options and params (Track 1 builds, Track 3 reads)

- `GET /lead-finder/run-options`:
  - each city gains `group`: `priority`, `secondary`, `capital` or `regional`;
  - a new entry `Australia` with the group `national`;
  - `goal_leads`: `{ default, min: 1, max: 100 }`;
  - `sources`: for `web`, `property_daily` and `arealytics`: `on`, `ready` and one plain sentence when not ready.
- `POST /runs`, mode `discovery`:
  - `cities` takes any city in the rules, or `["Australia"]` alone;
  - `goal_leads` (1 to 100, optional): stop once this many good leads are found;
  - `sources` (optional): which of the three to use. Missing means every source that is ready.
- `RunOut` gains `goal_leads`, `good_leads` and `leads_by_source` (`web`, `property_daily`, `arealytics`).
- The estimate (`POST /runs/estimate`) gains `companies_needed` and one sentence when the goal doesn't fit the limits.

### 3. The lead card (Track 1 builds, Track 3 reads)

`LeadCard` gains:

| Field | What it is |
|---|---|
| `tier` | `A`, `B`, `C` or `discard` |
| `score` | 0 to 100, after dampeners; `score_before_dampeners` beside it |
| `confidence` | `high`, `medium` or `low`, with `confidence_why` (one sentence) |
| `filters` | the 5 filters, each `pass`, `fail` or `estimated`, with its basis |
| `excluded` | none, or `{ reason_id, label, evidence, url, overridden_by, overridden_at }` |
| `dampeners` | every dampener: `{ id, label, state: found or not_found or not_checked, strength, evidence, date, url, can_reverse }` |
| `property` | a `CompanyProperty`, or none |
| `office` | `{ address, building, floor, area_m2, area_basis: confirmed or estimated, since, since_words, lease_end, lease_end_basis, fitout_by, source }` |
| `headcount` | `{ now, projected, now_basis, projected_basis, source_url }` |
| `space` | `{ now_m2, projected_m2 }` at 10 m² a person |
| `contour_angle` | one line, like "post-merger integration" |
| `contact_roles` | likely roles to call, like CEO, COO, CFO, Head of People, Head of Property |
| `what_changed` | `new`, `upgraded`, `downgraded` or `unchanged`, with one sentence |

- `GET /lead-finder/leads` gains the filters `tier`, `confidence`, `city_group`, `has_property` and `excluded`, and sorts by tier then score. The default view is tiers A and B.
- `POST /lead-finder/leads/{id}/override-exclusion` (a person with the Lead Finder tick): judges the lead again without the exclusion, free, and records who did it.
- `GET /lead-finder/leads/{id}/profile`: the one-page profile's data for a Tier A lead.

### 4. Sources for Admin (Track 2 builds, Track 3 reads)

- `GET /sources` (Admin): for each tool: `on`, `signed_in`, `last_read_at`, `pages_today`, `pages_limit`, `records`, `paused_until`, `last_problem` (a fixed plain sentence, never a raw error).
- `POST /sources/{id}/check` (Admin): a free sign-in check. It reads one page.
- `POST /sources/{id}/resume` (Admin): lifts a 24-hour pause.
- Health gains one row for each tool.

### 5. Settings (S0 adds them)

| Setting | Default | What it does |
|---|---|---|
| `property_daily_enabled`, `arealytics_enabled` | off | The switch for each tool |
| `PROPERTY_DAILY_USERNAME`, `PROPERTY_DAILY_PASSWORD`, `AREALYTICS_USERNAME`, `AREALYTICS_PASSWORD` | empty | Secrets, in `engine/.env` and the App Platform dashboard only. Tests blank them. |
| `property_daily_to_claude_ok` | on | Property Daily facts go to Claude as hints |
| `arealytics_to_claude_ok` | off | The same for Arealytics (choice 8) |
| `source_page_wait_seconds` | 4 to 9, picked at random | The pause between pages (**TBC**) |
| `source_pages_per_day` | 300 for each tool | The most pages a day (**TBC**) |
| `source_pages_per_run` | 60 | The most live lookup pages one run may use (**TBC**) |
| `property_lookup_days` | 30 | How long a lookup is reused |
| `manual_run_goal_leads` | 20 | The default "How many leads" (**TBC**) |

## Track 1: the rules and the research (session 1)

**Progress:** 8 of 12.

- [x] **T1-1. Own copy and a baseline.** Done 2026-11-15 (counts in the Log).
  - Make the worktree and the database. Run the backend tests once and note the counts.
  - Save the re-judge output: the count of each result.
  - Copy Levi's notes into `projects/leads/criteria/Criteria_v3.md`, in plain words, with his section numbers. `Criteria_v2.md` stays as the old version.
  - **Done when:** the counts are in the Log and `Criteria_v3.md` exists.

- [x] **T1-2. All of Australia.** Done 2026-11-15 (see the Log).
  - `cities` in `criteria.yaml` becomes four groups (the list is **TBC** with Levi):
    - `priority`: Melbourne, Adelaide, Perth;
    - `secondary`: Sydney, Brisbane;
    - `capital`: Canberra, Hobart, Darwin;
    - `regional`: Gold Coast, Newcastle, Sunshine Coast, Wollongong, Geelong, Townsville, Cairns, Toowoomba, Ballarat, Bendigo, Launceston, Mackay.
  - The city rule (`_city` in `scoring.py`): any of these passes the location filter. A place not on the list still passes, with a flag "check the city". Today's Director review for Sydney goes away (**TBC** with Levi: his notes call Sydney "secondary", not a Director's).
  - An overseas or interstate company that announces an office in one of these places counts for that place.
  - `geo.py`: a map centre for every new place. `queries.yaml`: a CBD area for each.
  - **The national search:** `cities: ["Australia"]` makes one slice per sign. The searches say "Australia" in place of the city, and the form asks Claude which city each company's office is in.
  - `params.py`, `options.py` and `steps/plan.py` follow the contract, part 2.
  - The HubSpot watchlist's `count_cities` gains Sydney and Brisbane (free; the others when HubSpot has offices there, **TBC**).
  - **Done when:** tests prove a Brisbane, a Darwin and a Geelong company pass the location filter, a national run of 6 signs plans 6 slices, and the re-judge counts are in the Log.

- [x] **T1-3. The five filters and the exclusions** (his sections 2 and 3). Done 2026-11-15 (see the Log).
  - **Filters,** checked before the score: location, office size (1,000 m²+ now or within 24 months), headcount, office relevance and sector. Each is `pass`, `fail` or `estimated`. An unknown fact is estimated, labelled, and never a fail (choice 3). Example: no floor area known, 120 staff, so "about 1,200 m², estimated from staff".
  - **Headcount:** city staff, not national. 50+ still qualifies (choice 4). "50 staff hiring 100" qualifies on its path. "10 staff hiring 20" doesn't.
  - **Exclusions,** left out and not scored, each with its reason and evidence:
    - government departments and agencies (a government-owned corporation is flagged, not excluded);
    - not-for-profits and charities that rely on grants or donations (an industry super fund or a member-owned insurer is not one);
    - law firms;
    - the big four banks and tier one financial institutions;
    - companies where the office is incidental (logistics, manufacturing, retail, hospitality with mostly non-office staff);
    - companies that buy fitouts only through public tender portals.
  - An excluded lead is a Drop with `excluded` filled in. The override endpoint judges it again without the exclusion.
  - This replaces `industries.director_review` for those industries. Education, real estate agencies and hospitals aren't in his exclusions: they stay a Director review (**TBC**).
  - **Done when:** tests cover each exclusion, the two "is not one" cases and the override. The re-judge counts are in the Log.

- [x] **T1-4. Signs with a strength** (his section 4). Done 2026-11-15 (see the Log).
  - Each sign gets a strength in `criteria.yaml`. The ids stay, so old leads keep their signs.

    | Strength | Signs |
    |---|---|
    | Very high | `lease_ending`, `long_tenure` |
    | High | `fast_growth` (a hiring surge: open roles of 25%+ of local staff), `merger_or_takeover`, `capital_raise` (new), `new_to_australia`, `big_new_contract`, `tenant_advisor` (new) |
    | Medium | `new_ceo`, `restructure`, `office_consolidation`, `return_to_office`, `hot_industry_growth` (sector tailwind), and today's other "other" signs |
    | Low | `growth_list` (new: AFR Fast 100, Deloitte Fast 50), `culture_change`, `hiring_push`, `rival_growth` |

  - A sign older than 18 months is ignored, unless it is a lease or tenure date.
  - **Long tenure** follows his words: 8+ years at the address (10+ is strongest), stable or growing, and no known fitout there in the last 5 years. "At this address since at least 2017" is enough.
  - **The competitor sweep** is today's rivals search (`rivals.py`): 3 to 5 rivals in the same city. It now also runs after a sector tailwind sign.
  - **Done when:** every searchable sign still has a search (the start-up check), tests cover the 18-month rule and the tenure rule, and the re-judge counts are in the Log.

- [x] **T1-5. Dampeners** (his section 5). Done 2026-11-15 (see the Log).
  - Six dampeners in `criteria.yaml`, each with a strength:

    | Dampener | Strength |
    |---|---|
    | A fitout or move in that city in the last 3 years | Strong. Still listed if hiring would outgrow the space within 24 months. |
    | A fitout or move 3 to 5 years ago | Moderate |
    | A global or national real estate outsourcing deal (JLL, CBRE, Cushman & Wakefield, Colliers) | Strong |
    | A known tie to a competitor (2+ projects, or a panel) | Moderate |
    | Procurement red flags (tender portal, offshore buying, lowest price, design and build bought apart) | Moderate to strong |
    | Financial stress (layoffs, profit warnings, administration, a hiring freeze) | Strong, unless it is part of a consolidation that creates a move |

  - A new research angle, `dampeners`, in `queries.yaml`: up to 3 searches a company. Example: "{company} office fitout {city}", "{company} JLL OR CBRE OR Colliers corporate real estate", "{company} tender fitout".
  - The answer form (`fields.py`) gains `dampeners`. Each of the four checks (recent fitout, outsourcing, competitor tie, procurement) comes back `found` or `not_found`. The code never writes "none".
  - A found dampener records its evidence, its date, and what could reverse it (like a contract renewal date).
  - PLAN-V11's "just moved in the last 12 months is a Watch" stays, as the strongest case of the first dampener.
  - Run `uv run lead-finder forms`: the form must stay under Anthropic's limits for strict forms.
  - Measure the extra cost on the fake Claude's token counts, and note it in the Log.
  - **Done when:** tests cover each dampener, "not found", and the outgrow rule. The forms check passes.

- [x] **T1-6. The new score, the tiers and confidence** (his section 6). Done 2026-11-15 (see the Log).
  - `score` in `criteria.yaml` becomes:

    | Part | Check | Points |
    |---|---|---|
    | Fit (30) | Local staff: 50 to 99 = 2 (choice 4), 100 = 5, 150+ = 10, 250+ = 12 | 12 |
    | | Priority sector | 8 |
    | | City: priority 5, secondary 2, other 1 (choice 5) | 5 |
    | | Office relevance and a work-together culture | 5 |
    | Change and timing (50) | The strongest sign: very high 25, high 18, medium 10, low 4 | 25 |
    | | Other independent signs within 12 months: 8 each, at most 2 | 16 |
    | | The office is constrained or ending: 8+ years there, lease timing, overflow space, split sites | 9 |
    | Access (20) | No outsourcing deal or competitor lock-in found | 10 |
    | | Favourable procurement | 6 |
    | | A warm path in | 4 |

  - Then the dampeners: strong takes off 20, moderate 10.
  - **Tiers:** A at 75+, B at 55 to 74, C at 40 to 54, Discard below 40.
  - **Results** follow choice 1. The Director rules that stay: over 6,000 m² or 600 staff (a possible Whale Pipeline project), and the industries left in T1-3.
  - **Confidence:** high when the headcount, the signs and the dampener checks all have named sources. Low when key facts are estimated. A fact confirmed by Property Daily or Arealytics counts as confirmed. Tier A with low confidence gets the flag "verify before outreach".
  - **Priority sectors** (his section 2): energy, renewables, critical infrastructure, defence, engineering, insurance, mid-tier financial services, technology, professional services (non-legal) and resources head offices. They replace `tier_1` and `tier_2`.
  - Migration `0019_lead_tier`: `tier` and `confidence` columns on `leads`, both indexed, filled for saved leads by a re-judge.
  - The goal (`goal.py`) and the review page count Tier A and B (choice 2).
  - **Done when:** the rules check passes (the parts add up to 100), tests cover each tier edge (39, 40, 54, 55, 74, 75) and each deduction, and the re-judge counts by tier are in the Log.

- [x] **T1-7. Sources and searches** (his section 7). Done 2026-11-15 (see the Log).
  - `queries.yaml` gains at least one search for each source group he names: mergers (the ACCC acquisitions register, ASX, AFR Street Talk), funding (AFR, SmartCompany, Startup Daily, Crunchbase), hiring (SEEK, careers pages), leases and tenure (The Urban Developer, AFR commercial property, the Wayback Machine for an old contact page), recent fitouts (ArchitectureAU, Office Snapshots, fitout firms' project pages), outsourcing, leadership, sector growth, procurement (AusTender and the state portals, as a red-flag check) and company facts (WGEA, ASIC, annual reports).
  - `source_domains` and `sources_rank` gain `arealytics`. Both tools rank first. `propertydaily.com.au` stays on the blocked list for Claude's web tool: only our connector reads it.
  - Each fact records which source supports it (it already does: `fact_sources`).
  - **Done when:** the start-up check passes, and a test proves every source group has a search.

- [x] **T1-8. The tools' facts in the research.** Done 2026-11-15 (see the Log).
  - `research.py`: after Signal Hire's step and before Claude searches, call `lookup_company`. It is free and never stops a lead: an error is one line in the card's problems.
  - `sourcing.py`: a source order for three facts. The first source with a value wins, and the others stay on the card.
    - office size (m²): `property_daily`, `arealytics`, `hubspot`, `web_research`;
    - lease end: the same order;
    - at the address since: the same order.
  - A gap between sources is a flag. Example: Arealytics says 1,400 m², the web says 900 m².
  - The code, not Claude, adds signs from the records: a lease ending in 12 to 36 months is `lease_ending`, a "requirement" record is `tenant_advisor`, and 8+ years at an address feeds `long_tenure`. A "fitout" record in the last 5 years feeds the dampener.
  - Hints to Claude: only facts from a tool whose `..._to_claude_ok` switch is on. The rest never enters a prompt (a test proves it).
  - **Discovery:** `steps/discover.py` adds `recent_items` for the run's cities to the candidates, each with its sign, when that source is picked. A company found by a tool and by the web is one candidate.
  - **Done when:** tests with fake records prove the source order, the flag, each sign and dampener from a record, the "no Arealytics in a prompt" rule, and that a run with both tools off works as today.

- [ ] **T1-9. How many leads.**
  - Discovery takes `goal_leads` (the contract, part 2). The run starts companies, best first, and stops starting new ones once it has that many good leads. It reuses the automatic runs' goal (`state["goal"]` in `steps/graph.py`).
  - The default comes from `manual_run_goal_leads` (20), a setting an Admin can change on the Settings page.
  - **The estimate tells the truth about the limits.** Example: 20 leads at a pass rate of 40% needs about 50 companies, about US$17 to US$21. A manual run may research at most 20 companies and spend US$20 today (`run_max_companies`, `run_cap_usd`). So the form says: "20 leads needs about 50 companies. This run's limits allow 20. An Admin can raise them in Settings." The pass rate comes from the last 5 runs (40% until there are any, **TBC**).
  - No limit rises by itself. Raising `run_max_companies` and `run_cap_usd` is Al-khair's call (see "Waiting on").
  - A run that ends short says why: "Found 12 of 20 leads. It stopped at the run limit (US$20)."
  - **Done when:** tests prove a run stops at its goal, stops at a limit with the right sentence, and the estimate names the limit that binds.

- [ ] **T1-10. The output** (his sections 8 and 9).
  - The answer form gains `contour_angle`, `contact_roles` and the projected headcount with its basis. The card gains every field in the contract, part 3.
  - **What changed:** code compares the lead with the last research of the same company: `new`, `upgraded`, `downgraded` or `unchanged`, with one sentence, like "Up from B to A: a lease end in 2028 was found". Free.
  - **A repeat never duplicates:** before a company is researched, the run checks the saved leads, HubSpot and past rejects (it already does: `steps/choose.py`). A new sign or dampener on a saved lead judges it again.
  - **A run's result** lists the ranked leads, then the excluded, then the watch list (`leads_by_source` too).
  - The profile endpoint and the CSV gain the new columns.
  - Run `uv run lead-finder forms` again.
  - **Done when:** tests cover each `what_changed` case, the CSV has the new columns, and the forms check passes.

- [ ] **T1-11. The automatic runs.**
  - The round's fixed order gains Brisbane and "Rest of Australia" (the national search), after Sydney. Both are off by default.
  - The round's budget and goal work as today.
  - **Done when:** tests prove the two new schedules exist, are off, and a round with all six on runs one day apart.

- [ ] **T1-12. Track 1 check.**
  - All backend tests, Ruff and mypy. `uv run engine openapi`.
  - The Rules page's TBC list is current. `Criteria_v3.md` matches `criteria.yaml`.
  - The final re-judge counts, by result and by tier, against T1-1.
  - **Done when:** all checks pass and the Log says "Track 1 ready to merge".

### Track 1 Log

Newest first.

- 2026-11-15: **T1-8 done** (cc94ac5). **The lookup:** `research.py` asks `lookup_company` (step 1d) after Signal Hire's step and the too-small check, before Claude searches. Free. A too-small company isn't looked up, so it spends no pages. A tool that failed is one line in the problems, and the lead is still researched. No connection of ours is held while it reads a site. The card gains `property`: the records of the tools in use (newest first, at most 30) and each tool's status. **A tool that is `off` is skipped entirely,** even when our copy still has its records (Track 2's `lookup_company` returns them with `off`). **The office now** (`property.py`): a lease that still runs, or a move that has happened. With no lease end known, the only address a tool has in that city. With several such addresses we don't guess: Track 2's company reports give past offices as leases with no dates, so a past office looks like the current one. Each floor counts once, and floors add up. **Which source wins** (`sourcing.choose_office_value`, `data_sources.office_m2`, `lease_end` and `office_since` in `criteria.yaml`): Property Daily, Arealytics, HubSpot, then the web research. The others stay in `fact_sources`. **A change for Al-khair to know:** HubSpot's lease end and move-in date now come before the web research's (before, they only filled a gap), and HubSpot's office size ("Office Space Size") is used for the first time. To go back, put `web_research` before `hubspot` in the three lists (a test proves it). **The flag:** two sizes more than 1.25 times apart, or two dates more than 12 months apart (TBC). The plan's example (Arealytics 1,400 m² against the web's 900 m²) raises it. **Signs and the dampener from records** (code, never Claude, matching Track 2's `core.sources.meaning`): a lease ending in 12 to 36 months is `lease_ending` (outside that window a tool's lease end is no sign, and the web's dated lease sign still gives way to it); a move still to come is `lease_ending` too (its label says "or a relocation"); a search for space is `tenant_advisor`; a fitout, done or already given to a firm (dated when the tool published it), is the last fitout, so it feeds `recent_fitout` (strong to 3 years, moderate to 5, nothing after) and stops the tenure sign; the first date at the address feeds `long_tenure` (8+ years). **What Claude reads:** Property Daily's office now (address, floors, m², lease dates) as one JSON hint line in each search prompt (not in the form's prompt), while `property_daily_to_claude_ok` is on. Nothing from Arealytics while `arealytics_to_claude_ok` is off: not in a search, the form, the gap check, the Why now (`why.claude_view` hides a hidden tool's values and signs, as it does HubSpot's) or call prep's best sign (`company_leads._sign` passes over it). A tool's feed item is never saved as a memory note (notes go to Claude): the research adds its sign itself. **Source kinds (a fix to T1-7):** the blocked list came first, so a record's link on a tool's site counted as "blocked" and its sign ranked last. Now a link on a tool's site is that tool's kind (`source_kind`), and Claude's links there are still dropped (`sources.is_blocked`, used by the source check, discovery and the rivals). `spatialgroup.com.au` (Property Daily's real pages, T2-2) joins both lists. **Discovery:** a discovery run's `sources` (`web`, `property_daily`, `arealytics`; left out, every ready one). The research of each company still uses every tool that is on. Without `web` a run makes no web search for companies, and goes from plan to merge. Each picked tool's new items (`recent_items`: since `since_days`, the run's cities, or every place for all of Australia) with a sign the run looks for become companies found (`run_sources.feed_found`), merged with the web's ones. An item that is only a dampener never brings a company in. A tool the run names that isn't ready is a 422 `source_not_ready`, with its sentence. The estimate counts the tools' new items (free), and says so. `GET /lead-finder/run-options` gains `sources` (`id`, `label`, `on`, `ready`, `sentence`), worked out from the settings for now. **For M1:** use Track 2's `source_availability` there (it knows a 24-hour pause); `tests/core/test_contract_routes.py` (Track 2's file) gains `sources` in the run params list: keep both sides. **Re-judge:** unchanged (Pass 0, Director review 0, Watch 30, Drop 22; by tier A 0, B 0, C 3, Discard 49): no saved card holds a tool's record, and the order runs at research time. **Tests:** `test_property.py` (32: the office now, the order, the flag, each sign and the dampener, the 12 and 36 month edges, the hints, the hidden sources, call prep, the source kinds, the feed, a tool and the web as one candidate, the source checks); the research end to end with a fake lookup (Arealytics in no prompt of any step, Property Daily's hint in each search only, a failed lookup, both tools off the same as before, no lookup for a too-small company); a discovery run from the feed alone (no web search, no note saved); the Why now privacy tests; and the order tests in `test_sourcing.py` and `test_office_numbers.py` (`fill_gaps` and `hubspot_filled` are gone: the order does their work). **Full backend run** (`heavy.sh`) on the T1-8 code before its last change: **4,013 passed, 28 skipped, 0 failed**, in 7 min 30 s. The last change (the estimate counts the tools' new items) then passed its own test, the run tests and the estimate tests, and the commit's fast tests. **For Track 3:** the card's `property` (the contract's `CompanyProperty`); `fact_sources` entries with `fact` `office_m2`, `lease_end` or `last_fitout`, and `used` or `source` `property_daily` or `arealytics`; the run options' `sources`; a discovery run's `params.sources`. **Not done here:** the `office` block and the rest of the contract's part 3 come with T1-10.
- 2026-11-15: **T1-7 done** (cf4680c). **Source groups** (`queries.yaml` `source_groups`): Levi's ten groups (mergers, funding, hiring, leases and tenure, recent fitouts, outsourcing, leadership, sector growth, procurement, company facts), each naming the sites he names. Each has searches for one company, added to the research angles it names, and, when a sign uses it, searches for a discovery slice, added after the sign's own. They are suggestions in the prompt: no search limit changed, and no request was added. The backend won't start if a group is missing, has no search, or names a sign that has no search. **Ranks:** `sources_rank` and `score.source` gain `arealytics` after `property_daily`, so both tools rank first. Since T1-6 these rank signs against each other and are no longer points of a lead's score. `source_domains` names both tools' own sites, and both sites are on the blocked list: Claude's web tool never reads them, and a fact that cites one is dropped. Only our connector reads them (T1-8). **Re-judge:** the same as T1-6 (no saved fact depends on a search or a rank). **Tests:** every group has a search, the sites he names are in the searches, an angle and a sign ask their groups, and five start-up checks. **Full backend run** on c7c04db (T1-6, its test fix and T1-7), with `heavy.sh`: **3,968 passed, 28 skipped, 1 failed**, in 8 min 1 s. The failure was 0017's migration test (`tests/companies/test_races.py`): it stopped the database at 0017 and then compared it with the models, so any later migration breaks it (our 0019, and Track 2's 0018). Fixed in 0936a53 with Track 2's own patch (4397820), byte for byte, so M1 merges it cleanly. That test passes now. **Read from Track 2's branch (no messages reach it from here):** Arealytics is dropped from V16 (its site refused automated access), so its status is always `off`. Track 2 has `source_availability` and `core.sources.meaning` for M1.
- 2026-11-15: **T1-6 done** (57d6a05, and c7c04db for three database tests that the first commit broke: the fake backend's "Sample Analytics" needs a priority sector to stay a Watch, a just-moved company's line now names its tier, and a found outsourcing deal makes the sample lead a Watch). **The score** (`criteria.yaml` `score`, Levi's points): Fit 30 (local staff 12, priority sector 8, city 5, office relevance 5), Change and timing 50 (the strongest sign 25, other signs within 12 months 8 each and at most 2, the office constrained or ending 9), Access 20 (no lock-in 10, favourable procurement 6, a warm path 4). The rules check that the parts add up to 100 and the checks to their part. The dampeners then take 20 (strong) or 10 (moderate) off, never below 0. **Tiers:** A 75+, B 55 to 74, C 40 to 54, Discard under 40. **Results (choice 1):** A and B are a Pass, or a Director review when a Director rule applies. C is a Watch. Discard is a Drop. A rule that holds a lead at Watch (just moved, size unclear) wins over A and B. An unknown fact never fails a lead, so a Discard stays a Watch while the city or the size isn't known, or the dampener checks haven't run. **Confidence:** high, medium or low, from how well the headcount, the signs and the dampener checks are sourced. A Tier A lead with low confidence gets the flag "Verify before outreach". **Priority sectors** replace tier 1 and tier 2: Levi's list in 7 of Claude's industry groups. Life sciences and medtech earns no sector points now (TBC). The rivals search follows the priority sectors. Financial stress is a strong dampener, no longer a Drop. **Not judged yet:** a warm path in (it needs HubSpot contacts and board lists), so the best score is 96. **Migration `0019_lead_tier`:** `tier` and `confidence` columns on `leads`, both indexed. `uv run lead-finder rejudge --save --yes` fills them in. I ran the re-judge without `--save`: nothing in the track database changed. **Re-judge** (the 52 saved leads): **Pass 0, Director review 0, Watch 30, Drop 22.** By tier: **A 0, B 0, C 3, Discard 49** (T1-5: Pass 3, Watch 27, Drop 22). The three Passes are Watches now: Budget Direct (33), Dragonfly (30) and Peet (46). The best is Cimic at 49 (Tier C). Why no saved lead is A or B: 22 are Drops (a score of 0), and every other one was researched before the dampener checks existed. So its Access checks are not known yet: "no lock-in" (10 points) earns nothing, and "favourable procurement" (6) earns only with a known buying strategy. A new research fills them in. The real tier counts come with the M2 test set. **Tests:** each tier edge (39, 40, 54, 55, 74, 75), each deduction (strong, moderate, several, the floor at 0, a waived one), confidence high, medium and low, "Verify before outreach", Tier C's line, a hold at Watch over Tier B, the parts and cuts at start-up, and the priority sectors. **For Track 3:** the card has `tier` (`A`, `B`, `C` or `discard`), `score` (after the dampeners), `score_before_dampeners`, `confidence` (`high`, `medium`, `low`) and `confidence_why`. `score_parts` has the three parts and their ten checks. `score_checked` and `band` are empty on a card made now, and the lead list no longer works out a band. The strongest sign is first in `triggers`. The full backend run is in the T1-7 line above.

- 2026-11-15: **T1-5 done** (bc37dda, and 1da29b2 for four database tests that counted requests, notes and US$1.06). **Five dampeners** in `criteria.yaml` `dampeners` (the plan's six rows: the two fitout rows are one dampener with two strengths). Ids, in this order: `recent_fitout` (strong up to 3 years ago, moderate to 5, nothing after), `outsourcing` (strong), `competitor_tie` (moderate), `procurement` (`tender_portal` and `offshore_buying` strong, `lowest_price` and `separate_design_and_build` moderate, no kind moderate: our reading, TBC) and `financial_stress` (strong, from the `healthy` fact). **The search:** `queries.yaml` `company.dampeners`, 3 templates, at most 3 (checked at start-up). It is a fourth angle that runs with the other three in every research, a tenure run too. **Cost:** on the fake Claude it is one more search request a company: 20,000 input tokens, 1,000 output tokens and 2 web searches, **US$0.12**, so a researched company costs US$0.52, not US$0.40 (3 angles US$0.36 + dampeners US$0.12 + the form US$0.04). The real number comes with the M2 test set (the plan guessed US$0.03 to US$0.10, **TBC**). **Searches and limits:** the 3 searches are **on top of** `company_max_searches` (12), so a company may use up to 15. No setting changed, and the money limits are the same (US$2.50 a company, US$20 a manual run, US$150 an automatic run). I chose this so the gap check keeps its 3 searches. If you want them inside the 12, the gap check is the one that loses them. The Settings page text for `company_max_searches` (`core/prefs/service.py`, not my file) should say "not counting the dampener check's 3": for M1 or M5. A fourth request now waits for a money hold (`acquire_request`): four holds of US$0.80 don't fit under the US$2.50 cap at once, and the old `reserve_searches` would have refused the fourth on every company. **The form:** `CompanyFacts.dampeners` is one entry for each of the four searched checks: `id`, `state` (`found` or `not_found`), `evidence`, `date`, `source_url`, `kind` (procurement only) and `can_reverse`. `lead-finder forms`: company facts still **3 of 16** null-or-value fields and 0 of 24 optional ones (7,749 to 9,690 characters, no limit on those). `sources.py`: a found answer needs a page that was read, else the check goes back to `not_checked`, never `not_found`; a `not_found` keeps no text and no link. **The card:** `dampeners: [{id, label, state, strength, evidence, date, url, can_reverse, waived}]`, all five, in that order. `state` is `found`, `not_found` or `not_checked` (a card made before this step, or a check that was skipped, is all `not_checked`). `strength` is `strong` or `moderate` and only when found. `waived` is a sentence when it is found but takes nothing off. The move-in and the last fitout feed `recent_fitout`, and a tender-only buyer feeds `procurement`, so a card never says "not found" beside a fitout it shows elsewhere. **The outgrow rule:** a found fitout takes nothing off (`waived`) when the company plans to hire a lot, says it will need more space than it has now (or than about 10 m² a person) and needs it within 24 months. Financial stress takes nothing off with a merger or takeover sign or an office consolidation sign. PLAN-V11's "moved in the last 12 months is a Watch" stays. **Not built yet, on purpose:** the points. A dampener is shown and the result is the same, so the **re-judge is unchanged: Pass 3, Director review 0, Watch 27, Drop 22**. The deductions (strong 20, moderate 10) come with T1-6. **For Track 2:** a "fitout" record feeds `recent_fitout` (T1-8), so a `FeedItem.dampener_id` is `recent_fitout`. **Tests:** 66 in `test_dampeners.py` (each dampener, found, not found and not checked, the strength edges, the outgrow rule and its edges, the source check, the form), 12 in `test_rules.py` (start-up checks), and the research tests. I edited one line of `tests/core/test_contract_routes.py` (Track 2's folder): the research endpoint now returns 5 notes.
- 2026-11-15: **T1-4 done** (e99607e, and 7db889b for eight database tests that the first commit broke, see "A default run is dearer" below). **Strengths:** every sign in `criteria.yaml` has one (`very_high`, `high`, `medium`, `low`), as in the plan's table. The ids stay, so old leads keep their signs. Where his notes are silent, the three version 2 "other" signs (new business unit, new facility, underperforming workplace) are medium and the weak ones (culture change, hiring push, rival growth) are low (TBC, in the Rules page's TBC list). The group (main, other, weak) now only says which signs a run searches by default. The card's triggers carry `strength`. **New signs:** `capital_raise` and `tenant_advisor` (high, main, 3 and 2 searches in `queries.yaml`) and `growth_list` (low, weak, 2 searches). **18 months:** a sign older than 18 months is ignored (it was 12), except a lease date or the tenure sign. A sign of 12 to 18 months counts but earns no recency points. **Long tenure:** 8+ years at the address, a company that is stable or growing, and no known fitout there in the last 5 years (a fitout longer ago doesn't stop it; before, any fitout after the move-in did). A year is enough for the move-in: "At this address since at least 2017 (9 years), with no known fitout there in the last 5 years." **The competitor sweep** (`rivals.py`) also runs for a good lead with a sector tailwind sign (`rivals.also_after`), whatever its sector. **A default run is dearer.** A run with no choices now searches 8 signs, not 6: 8 slices, so the estimate at past prices for the default Melbourne schedule goes from US$18.90 to US$25.20 (and from US$41.10 to US$54.79 a month), and at the placeholder prices from US$62.40 to US$83.20. **No limit was changed** (the run limit stays US$150 for an automatic run and US$20 for a manual one); both still fit. To go back to 6, move the two new signs from `main` to `other` in `criteria.yaml` (TBC with Al-khair: whether the two new signs should be searched by default). A run may name up to 24 signs. **Re-judge** (the 52 saved leads): **Pass 3, Director review 0, Watch 27, Drop 22**, the same as after T1-3: none of the saved leads has a sign the new rules treat differently. **Tests:** the strengths, the 18-month edges (13, 17 and 19 months), lease dates exempt, the new signs, the tenure rule (5-year fitout, year-only, the 8-year edge, an unhealthy company), the sweep, and the start-up checks (every searchable sign has a search). **For Track 3:** `GET /lead-finder/rules` has `criteria.triggers.main|other|weak` as `{id, label, strength}` and `criteria.rivals.also_after`; `GET /lead-finder/run-options` offers the 8 main signs as defaults; `triggers[].strength` is on each card trigger.
- 2026-11-15: **T1-3 done** (54149cf). **Exclusions** (`criteria.yaml` `exclusions`, `scoring._exclusion`): government, not-for-profit, law firm, big bank, an incidental office and tender-portal-only. An excluded lead is a Drop that is not scored, and the card's `excluded` has the reason, the evidence and its link. The four industry ones read Claude's `industry_group`; the extract prompt now says what each left-out group means. A company is **not** left out, and gets a flag, when its industry or owner says it is a government-owned corporation, a member-owned organisation (an industry super fund), or an insurer, a fund manager or a customer-owned bank (insurance and mid-tier financial services are priority sectors in his notes: the old group "Premium banks and finance" held Budget Direct). The office is incidental only when the research says the office doesn't matter **and** the industry is a site-heavy one; elsewhere that answer is still a flag. The answer form gains one fact, `tender_only`. Government, law firms, premium banks and finance and standard not-for-profits left `industries.director_review`; Education, real estate agencies, hospitals and industry consultants stay (TBC, in the Rules page's TBC list). The HubSpot watchlist's Director list keeps its mapping, so those companies still need a person's OK to be researched. **Filters** (`filters` on the card, each `pass`, `fail` or `estimated` with its basis): location never fails (a place not on the list passes with its flag); office size and headcount fail only on a known size or staff under the floor; "50 staff hiring 100" qualifies on its path and "10 staff hiring 20" fails (tests); relevance fails only for an incidental office; sector never fails (a priority sector is named, any other passes with no sector points). **Override:** `POST /lead-finder/leads/{id}/override-exclusion` judges the saved facts again without the exclusion (free), saves the new result and score, and puts who did it and when on the card (`excluded.overridden_by`, `overridden_at`); 404 for an unknown lead, 409 `not_excluded` or `already_overridden`. `rejudge` keeps a saved override. `research.py` has `verdict_fields`, `apply_verdict` and `verdict_columns`, the one place that says what a verdict sets. **Re-judge** (the 52 saved leads): **Pass 3, Director review 0, Watch 27, Drop 22** (T1-2: 2, 1, 27, 22). Budget Direct moved Director review to Pass: it was a Director review only because of its old group, and it is an insurer. Challenger, Euroz Hartleys and P&N Bank (also in the old group) were Drops already, for HubSpot or size. Tests: 54 in `test_exclusions.py` (each exclusion, the "is not one" cases, the override, each filter state, the prompt), 4 start-up checks in `test_rules.py`, and 6 over HTTP in `test_override_api.py`. **For Track 3:** the card has `filters: [{id, label, state, basis}]` and `excluded: {reason_id, label, evidence, url, overridden_by, overridden_at} | null`; the route is `POST /api/v1/lead-finder/leads/{lead_id}/override-exclusion` (answers the lead's detail); the exclusion ids are `government`, `not_for_profit`, `law_firm`, `big_bank`, `office_incidental`, `tender_only`. `GET /lead-finder/rules` has `criteria.exclusions` (`id`, `label`, `kind`, `industry_groups`, `meaning`, `unless`, `flag`).
- 2026-11-15: **T1-2 done** (7dd4954, and 5cb90b9 for five database tests that the first commit broke: a colon in `testset.yaml`, the watchlist's new 55, and the route test that refused Sydney). `criteria.yaml` `cities` is four groups (priority 3, secondary 2, capital 3, regional 12) and `national: Australia`; any place on the list passes the location filter, a place that isn't on it passes with the flag "check the city", and Sydney is no longer a Director's decision. Each place has a map centre and a CBD to search. **The national run** (`cities: ["Australia"]`, alone) plans one slice per sign: 6, not 120. Its request says "all of Australia" and asks for each company's own city, and the companies may be in any listed place (`steps/plan.py` `run_cities`). The prompts say all of Australia. `GET /lead-finder/run-options`: every city has a `group`, `Australia` (group `national`) comes first, and a part of a city with no suburbs (a regional centre has only a CBD) isn't offered. `kind` stays and is always `pass`. `GET /lead-finder/rules` returns `criteria.cities` as `{groups, national, no_city_director_signs}` in place of `pass`, `director_review` and `other_cities`. **The HubSpot watchlist** counts Sydney and Brisbane too: 55 companies at 50+ staff in the 25 Oct export, was 52 (the EXPORT.md golden tests keep the document's three cities). HubSpot send knows each place's state. Canva (Sydney) no longer expects a Director review. Tests: Brisbane, Darwin, Geelong and 3 more places pass the location filter, a place that isn't listed passes with the flag, the national plan has 6 slices, the national request, the options, and the start-up checks (a place in two groups, no CBD area, the national name used as a place). **Re-judge** (the 52 saved leads): **Pass 2, Director review 1, Watch 27, Drop 22** (baseline: 1, 3, 26, 22). Cimic (Sydney, size not known) Director review to Watch, Dragonfly (Sydney) Director review to Pass. The other two Director reviews were not Sydney's. No messages sent: the other two tracks' sessions run under another account and are not in my `ListAgents`, so the contract notes above are in this Log.
- 2026-11-15: **T1-1 done.** The Track 2 session made S0 (`plan-v16`: a727967 and 5095b47, in `../contour-v16-t2`), a few seconds before I would have. I did no S0 work. **Own copy:** worktree `../contour-v16-t1` on `plan-v16-track1` (from `plan-v16` at 5095b47), database `leadfinder_v16a` (a copy of the dev database at `0017_call_prep`, 52 leads), test suffix `_v16a`, its own `.venv`, `COMPANIES.xlsx` copied. No `npm ci`: this track has no website work. **Backend tests on 5095b47** (a full run with `heavy.sh`, on a clean copy of that commit): **3,660 passed, 28 skipped, 1 failed**, 8 min 4 s. The one failure is a timing test, `tests/companies/test_companies_speed.py::test_a_page_and_the_prep_box_are_fast_on_a_full_copy` (533 ms against its 300 ms limit, while two other sessions were running tests). It passes alone in 3 s. **Re-judge baseline** (`lead-finder rejudge`, today's rules, the 52 saved leads): the saved results are Pass 2, Director review 7, Watch 41, Drop 2. Judged again now: **Pass 1, Director review 3, Watch 26, Drop 22** (bands: 13 investigate, 17 nurture, 22 none). 24 of the 52 differ from the saved result, because the HubSpot labels were refreshed after those leads were made (PLAN-V5 D2). **Forms check** (`lead-finder forms`): company facts use 3 of 16 null-or-value fields and 0 of 24 optional ones, so there is room for the new facts. `projects/leads/criteria/Criteria_v3.md` is written from Levi's notes (his section numbers, plain words, our TBC choices marked, the questions for him at the end). S0's own box in "Before the tracks start" is still unticked: the Track 2 session ticks it.

## Track 2: the tools (session 2)

**Progress:** 0 of 10.

- [ ] **T2-1. Own copy and a baseline.**
  - Make the worktree and the database. Run the backend tests once and note the counts.
  - Add the package `playwright` (`uv add playwright`), then `uv run playwright install chromium` on the laptop. Note the installed version: the container must use the same one.
  - **Done when:** a 5-line script opens `https://example.com` in headless Chromium and prints its title.

- [ ] **T2-2. Map the two sites.** Needs Al-khair at the keyboard.
  - Al-khair signs in to each site in a browser the session can see (a headed Playwright window, or Claude in Chrome). The session reads, and clicks only to move between pages. It changes nothing on the sites: no shortlist, no note, no reminder, no export.
  - For each site, write down in [tools/](../tools/):
    - how sign-in works. Property Daily's FAQ says a username and password. Arealytics: **TBC** (a code by email would need a saved session);
    - how long a session lasts;
    - each page we need, its address pattern, and the fields on it;
    - whether the page loads its data from the site's own data address (JSON). Reading that reply is sturdier than reading the page's layout;
    - how search and paging work, and any limit the site shows.
  - **Property Daily pages to find:** today's items, the "online database of past and current leads", MarketView, and a company's history (how far back it goes: about 20 years, as Levi says, **TBC**).
  - **Arealytics pages to find:** a tenant search by company name, a building's page, and a search for leases that end in a date range in one city.
  - Saved pages go in the scratchpad, never in the repo.
  - **Done when:** `tools/propertydaily.md` and `tools/arealytics.md` each have a "Pages" section with the patterns and fields, and a list of what each tool can't give us.

- [ ] **T2-3. The browser** (`core/browser/`).
  - One headless Chromium, started when a job needs it and closed after 5 minutes idle. One page at a time for each site.
  - **Its own thread.** The backend on Windows uses the selector event loop (for psycopg), and that loop can't start a browser process. So the browser runs in one worker thread with its own loop, and the backend talks to it through a queue. The same code runs on the server.
  - **Signed-in state** is kept in memory and in a temp file (`context.storage_state(path=...)`), reused by `browser.new_context(storage_state=...)`. It is never in git and never logged. After a restart the connector signs in again.
  - **Only the tool's own hosts load.** `context.route` blocks every other host, and images, fonts and media, to save memory.
  - **Pace:** a random pause of `source_page_wait_seconds` between pages, at most `source_pages_per_day` a day and `source_pages_per_run` a run. Every page read is one row in `core.source_reads` (the site, the kind of page, the time, ok or not, the ms). Never the page's content.
  - **Stop rules:** a captcha, a lockout page, a 403 or 429, or the sign-in page twice in a row pauses that tool for 24 hours. Health shows it, and an Admin can resume it. There is nothing that hides the program from the site.
  - Every action has a timeout (30 s). A hung page is closed, and the lookup returns `error`.
  - **Done when:** tests against a small local test site prove the pace, the daily limit, the host block, each stop rule, and that a crash of the browser never crashes the backend.

- [ ] **T2-4. The tables.** Migration `0018_property_sources`, in the `core` schema, so call prep can read them later.
  - `core.property_records`: the `PropertyRecord` fields, a cleaned company key (the same cleaning as HubSpot matching), and a unique key so the same record is saved once.
  - `core.property_lookups`: the company key, the tool, when, the status and the count. This is the 30-day memory.
  - `core.source_reads`: the log from T2-3.
  - Run `scripts/schema_map.py`, and add the tables to the four table lists.
  - **Done when:** the migration runs up and down, and the schema map is committed.

- [ ] **T2-5. The Property Daily connector** (`core/sources/property_daily/`).
  - `signin.py`: signs in with the username and password from the settings.
  - `parse.py`: pure code that turns a page (or its data reply) into `PropertyRecord`s. It drops emails, phone numbers and people's names.
  - `pages.yaml`: the address patterns and selectors from T2-2. A layout change is a fix to this file, checked at start-up.
  - `feed.py`: reads the items since the last read, every category (leasing, requirements, relocations, fitout projects, design appointments), every city. Each item gets a sign or a dampener: a lease expiry or a requirement is a sign, a fitout project already awarded is a dampener.
  - `lookup.py`: searches the database for one company, and reads its history: past leases, moves and office sizes.
  - **Done when:** `parse.py` passes tests on made-up pages shaped like the real ones. On Al-khair's word, one real feed read and one real lookup work on the laptop, and their counts are in the Log.

- [ ] **T2-6. The Arealytics connector** (`core/sources/arealytics/`).
  - The same five parts as T2-5.
  - `lookup.py`: finds the tenant by name, then reads its leases (address, floor, area m², start, end) and the building.
  - `lease_endings.py`: for one city, the office leases that end in 12 to 36 months, 500 m² and up (looser than the 1,000 m² rule, so a growing company isn't missed). Each becomes a `FeedItem` with the sign `lease_ending`. Cities: Melbourne, Perth and Sydney first (Levi), then Brisbane and Adelaide if our licence has them (**TBC**).
  - It never uses the site's export or bulk download.
  - **Done when:** the same as T2-5, for Arealytics.

- [ ] **T2-7. The jobs and the reader.**
  - `reader.py` gets its real code: `lookup_company` and `recent_items` (the contract, part 1). Company names are matched like HubSpot's (`core/hubspot/matching.py`), in a thread.
  - Two schedule jobs (`JobSpec`), both **off** until a person switches them on:
    - `sources.property_daily.feed`: every working day at 6:15 am Melbourne time;
    - `sources.arealytics.lease_endings`: every Monday at 6:45 am, one city a week in turn.
  - A job skips itself while its tool is off or paused, and says why.
  - **Done when:** tests with fake connectors prove the 30-day reuse, the per-run page limit, the "never raises" rule, and both jobs.

- [ ] **T2-8. Admin and commands.**
  - The routes in the contract, part 4, and the two Health rows.
  - Commands: `uv run engine sources-check` (signs in to each tool that is on, free) and `uv run engine sources-lookup "Company" --city Perth` (one live lookup, printed).
  - The secrets are `SecretStr`. `core/logs.py` redacts them, and no route ever returns them.
  - **Done when:** tests cover the routes and prove no secret is in a response or a log line.

- [ ] **T2-9. The container.**
  - `backend/Dockerfile`: install Chromium and its system packages (`playwright install --with-deps chromium`), at the same version as `uv.lock`, in a path the `contour` user can read.
  - **Measure** on the laptop: run the image with `--memory=2g` (the server's size), start a run with a fake Claude, and do 20 lookups against the local test site. Note the peak memory.
  - **Decide (choice 7):** if the peak leaves under 500 MB free, move the browser to a worker of its own in `.do/app.yaml` (a second component with the same image, a queue in the database, and its own size; its price is **TBC**). Tell Al-khair before building it.
  - **Chromium's sandbox:** on App Platform it may not start as a normal user. If it doesn't, run it with the sandbox off. That is acceptable only because the browser loads two known hosts and nothing else (T2-3). Note it in `AGENTS.md` at M5.
  - `test_deploy_files.py` gains checks: the Chromium version matches, and no login is in an image or a file.
  - **Done when:** the image builds, the measure is in the Log, and the choice is made.

- [ ] **T2-10. Track 2 check.**
  - All backend tests, Ruff and mypy. `uv run engine openapi`.
  - `tools/propertydaily.md`, `tools/arealytics.md` and `tools/playwright.md` say how each really works.
  - **Done when:** all checks pass and the Log says "Track 2 ready to merge".

### Track 2 Log

Newest first.

## Track 3: the website (session 3)

**Progress:** 0 of 8.

Every step follows `engine/DESIGN.md`, uses the `ui-build` skill, and builds against the contract with `mockApi`.

- [ ] **T3-1. Own copy and a baseline.** Make the worktree. Run lint, types, the tests and the build once, and note the counts.

- [ ] **T3-2. Start a run.**
  - **Where:** the cities in four groups (Priority, Secondary, Capitals, Regional), and "All of Australia" as the first choice. Picking it clears the cities.
  - **How many leads:** a number field, 1 to 100, filled with the default (20). Under it, the estimate's sentence, like "About 50 companies, about US$19", or the limit that binds.
  - **Where to look:** three ticks: the web, Property Daily, Arealytics. A tool that isn't ready is greyed out with its one sentence, like "Property Daily is switched off. An Admin can switch it on."
  - **Done when:** it works in the browser with `mockApi`, with tests for the national choice, the default and a greyed-out tool.

- [ ] **T3-3. The run page.**
  - Progress to the goal: "12 of 20 leads found".
  - Where the leads came from: the web, Property Daily, Arealytics.
  - When it ends: the ranked leads, then "Excluded" (with each reason) and "Watch".
  - A run that ended short shows its sentence.
  - **Done when:** the four states (running, met its goal, ended short, no goal) have tests.

- [ ] **T3-4. The lead card.**
  - **The header:** "A · 82 · Medium" (tier, score, confidence), then what changed, like "New" or "Up from B".
  - **Property record,** a new section in the Overview, above the summary:
    - the current office: address, building, floor, m² (confirmed or estimated), "at this address since at least 2017", the lease end, and who did the last fitout;
    - a short timeline of the records, newest first, each with its tool's name, its date and a link;
    - for each tool, one line when there's nothing: "Arealytics: not found" or "Property Daily: switched off". Never "none".
  - **Dampeners,** a new section: each one found, with its evidence and date, and "Not found" for each of the four checks.
  - **Size:** local staff now and projected, and the space now and projected, each marked confirmed or estimated.
  - **Contour angle,** the likely roles to contact, and the suggested opener.
  - **An excluded lead** shows its reason first, with an "Override" button that asks once before it judges again.
  - **Done when:** the card has tests for a full record, an empty one, an excluded lead and each tier, and Al-khair has seen it.

- [ ] **T3-5. Results.**
  - A Tier column, and filters for tier, confidence, city group, "Has a property record" and "Excluded". The default view is tiers A and B.
  - The map fits all of Australia when leads are spread, and one city when they aren't.
  - **Done when:** the filters and the default view have tests.

- [ ] **T3-6. Rules and Admin.**
  - **Rules page:** the city groups, the five filters, the exclusions, the signs by strength, the dampeners, the score table and the tiers, with the TBC list.
  - **Admin, a Sources tab:** each tool's switch, whether it is signed in, the last read, pages today of the limit, a pause and its "Resume", and "Check now".
  - **The round card** offers Brisbane and "Rest of Australia".
  - **Settings:** the new settings, in a "Sources" group.
  - **Done when:** each has tests, and Al-khair has seen them.

- [ ] **T3-7. The one-page profile.** A print view for a Tier A lead: everything in his section 9 on one page. "Print" on the card opens it.
  - **Done when:** it fits one A4 page for a full lead, in a test at print size.

- [ ] **T3-8. Track 3 check.** Lint, types, the tests, the build, the design check and `node scripts/bundle-report.js`. Each screen at 1440px, 1280px and 390px, light and dark.
  - **Done when:** all checks pass and the Log says "Track 3 ready to merge".

### Track 3 Log

Newest first.

## Merge and deploy

- [ ] **M1. Join the tracks** (`merge v16`, on Al-khair's word).
  - Run the `merge-check` skill first. It must say Ready.
  - In a worktree on `plan-v16`: merge Track 2, then Track 1, then Track 3, each with `--no-ff`.
  - The known joins: `0019`'s `down_revision` becomes `0018_property_sources`; keep both sides in `test_contract_routes.py`; run `uv run engine openapi` and `npm run types`; replace Track 3's hand-written types with the generated ones.
  - Run every test and build on the joined branch.
  - **Done when:** all of them pass on `plan-v16`.

- [ ] **M2. The paid checks** (on Al-khair's own words).
  - With the tools off: the test set. Compare it with the last test run.
  - With the tools on (on the laptop, with Al-khair's login until the tool has its own): one manual run in Perth for 20 leads.
  - Check 10 cards by hand against the two sites: is the address, the m² and the lease end right?
  - **Done when:** the Log has the good leads, the cost per good lead, how many leads came from each source, and how many of the 10 cards were right.

- [ ] **M3. Move `master`** (part of `merge v16`): `git merge --ff-only plan-v16` in the main folder. If it won't fast-forward, stop and ask.

- [ ] **M4. Deploy and check live** (`deploy v16`, on Al-khair's word).
  - Add the four login secrets in the App Platform dashboard. Both tools stay off.
  - Push, deploy, and watch the log (`live_log.py`). The post-deploy 503s are planned.
  - Then, one tool at a time: switch it on, press "Check now", run one lookup, and watch the memory for an hour.
  - **Done when:** both tools read on the live site, the memory holds, and a small live run finds leads with a property record.

- [ ] **M5. Docs.**
  - `engine/AGENTS.md`: the Map, a "Sources" section, and the Safety line "Read, don't scrape. Property Daily stays off…" becomes the new rule: on Levi's word of 15 Nov, the two tools are read by our connectors only, at the pace and with the stop rules above.
  - The same line in `.claude/agents/rules-agent.md`, `.claude/skills/rule-change/SKILL.md` and `.claude/skills/security-check/SKILL.md`.
  - `projects/leads/LEADS.md`, `CLAUDE.md` and the three files in `tools/`.
  - A short email to Levi, written with `/plain`, sent on Al-khair's word: what changed, the M2 numbers, and the TBC questions.
  - **Done when:** no doc says the tools are off, and the email is sent.

## Waiting on

- **Levi:**
  - **W1.** One email to The Spatial Group and one to Arealytics: written approval for an internal tool, and a feed or API (recommended, not blocking);
  - a login of its own for the connector on each tool;
  - the rules marked **TBC**: the city list and points, 50 or 100 staff, Sydney without a Director, the exclusions against today's Director industries, and whether a good lead is Tier A or B.
- **Al-khair:**
  - sitting in on T2-2;
  - the limits for manual runs. To let one run find 20 leads, `run_max_companies` needs about 50 and `run_cap_usd` about US$25 (**TBC**, from the pass rate M2 measures);
  - the paid checks in M2, the merge and the deploy;
  - a look at each screen.

## Risks

- **A vendor blocks or cancels an account.** See "The green light, and the risk that stays". W1 is the real fix.
- **A site changes its layout.** The connector then reads nothing, says so in Health, and the Lead Finder works as it did before this plan. The fix is in one `pages.yaml`.
- **The server runs short of memory.** T2-9 measures it before the deploy, and M4 watches it after.
- **Looser gates bring weak leads.** The tier ranks them, and the default view shows only A and B. The reject reasons show if a rule went too far.
- **A wrong match.** "Apex Group" in Arealytics may not be our Apex Group. The match needs the same city, and a weak match is a flag, not a fact.
- **Cost.** More leads means more companies researched. The run and daily limits still stop every run.
- **The new score moves old leads.** T1-6's re-judge shows how many, before anything is saved.

## Not in this plan

- **Call prep reading the property records.** The tables are in `core`, so it is a small next step.
- **Property Daily's daily email** as a second way in. Only if the site read proves unreliable.
- **Arealytics' API.** If W1 gets it, a later plan swaps the browser for it.
- **Emails or phone numbers** from either tool. Still open with Levi.
- **LinkedIn.** Still no scraping.
- **New Zealand.** Property Daily covers it. Contour doesn't work there.

## Log

Newest first.

- 2026-11-15: Plan written from Al-khair's asks, Levi's refinement notes and his green light for the tools (as Al-khair reports). Nothing built yet.
