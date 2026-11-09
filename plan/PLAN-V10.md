# Companies and call prep plan, version 10

This plan builds the second project after the Lead Finder. A new Companies page lists every company we know. Clicking a company shows what we know about the client. Prep gives a salesperson a short call script before they ring someone.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code and the look. Levi confirms what is marked **TBC** (to be confirmed).
- **Last updated:** 2026-11-09 (merged into `master` on Al-khair's word, not pushed or deployed; the rest wait on screenshots, Levi or Al-khair's word).
- **Progress:** 14 of 21 steps done. Open: A2, B4, C2, D4, E1, E3, E4.
- **Sources:** [projects/prep/PREP.md](../projects/prep/PREP.md), and the meeting notes of 2 Nov and 5 Nov in `minutes of meeting/`.
- **The look to copy:** the clickable prototype, with made-up data: https://claude.ai/artifact/XLy7eG12m19r3Ne8uK5MTC (private). Where it differs from `engine/DESIGN.md`, DESIGN.md wins (see "Fix these from the prototype").
- **Comes after:** [PLAN-V9.md](PLAN-V9.md). It reuses the Lead Finder tick on each account (PLAN-V9 E1).

## In short

| What the team needs | This plan |
|---|---|
| One place to look up any company (decided 8 Nov) | B1 to B5: the Companies page, its list and the company panel. |
| Levi's 4 questions before a call: still there?, last call, news, links to our customers (2 Nov) | C1 and C2 bring in people and calls. D2 and D3 answer the 4 questions. |
| A short script for the call (our proposal, **TBC** with Levi) | D3 and D4: opener, why now, questions, answers to pushback, and the goal of the call. |
| Fast, and cheap | D2 reuses what we already know, for free. D5 searches ahead each morning for the companies most likely to be called. |
| Only Levi, Marcus and one other person see Lead Finder data (5 Nov) | B1, B2 and E2: a Companies tick for the sales team. Lead Finder data needs the Lead Finder tick, checked on the server. |

**What can be built before Levi answers:** Parts B and D work from our HubSpot copy alone. Part C waits for HubSpot access to contacts and calls. Until then, People and Call history say they are waiting for it.

**What it costs to build:** nothing but time, except E3, a test of 10 real preps, at about US$1 to US$2 (**TBC**). It needs Al-khair's OK.

**What it costs to run:**
- **A new prep:** about US$0.05 to US$0.15 (**TBC**). A prep is reused for free for 7 days (**TBC**). For example, if 5 people each prep 10 new calls a day, that is about US$5 a day.
- **Search ahead:** at most US$5 a day (**TBC**), about US$110 a month over 22 workdays.
- **All of it counts in the daily limit** that already covers the Lead Finder (US$150, PLAN-V9 D4).

## Words used here

- **Company panel:** what we know about a client. It slides in from the right when you click a row.
- **Prep:** the call script for one call, in a window over the page (a modal).
- **Facts pack:** everything we already know about a company and a person, each fact with its source. Building it is free.
- **Source:** where a fact came from: a HubSpot field, a call note, a saved note, or a web page.
- **Search ahead:** preps made each morning, before anyone asks, for the companies most likely to be called.
- **Tick:** the per-account access from PLAN-V9 E1. "Companies" is a new tick. "Lead Finder" already exists.

## How to work this plan

- **Work in your own copy of the repo.** Another session works in the main folder. Run `git worktree add ../contour-v10 -b plan-v10 master` once, then work in `../contour-v10`. This keeps the two sessions' changes apart.
- **At the start of a session:** read this section, go to `../contour-v10`, find the first step that isn't ticked, and run `brain context`.
- **Ticking a step:** tick it when its "Done when" is true, with the date and the commit. Then update **Progress** and **Last updated**, and add a line to the Log.
- **One heavy thing at a time:** use `bash engine/scripts/heavy.sh <cmd>`, because the laptop is short of memory. Make small commits, and run `git branch --show-current` before each one.
- **Only on Al-khair's word:** anything that costs money, sends a real email, writes to HubSpot, deploys, merges or pushes.
- **Screens:** check every screen against "The design and motion bar" below before ticking its step.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain with brain-save. At 95%, start no new step.

## The design and motion bar

The aim is a page that feels instant and calm. It should look like it was always part of the website.

### The look

- Copy the prototype's layout. Use only our tokens: the colours, Titillium Web, the 10px radius and 8-point spacing (`engine/DESIGN.md`).
- IBM Plex Serif only for call notes (they are quotes from a source) and empty states.
- Navy only for primary actions, selection, focus and progress.
- Colour only where something needs attention:
  - **Terracotta:** a person who has left.
  - **Ochre:** a lease ending within 24 months, or no call in 6 months.
- Everything else is neutral. Every status has an icon and a word.

### Fix these from the prototype

The prototype breaks 4 house rules. The build must not copy them.

1. **Shimmer on the grey placeholders.** Instead, show still grey shapes, only after 200 ms, then fade the content in (DESIGN.md, "Loading").
2. **A looping progress bar.** Instead, the bar fills in 3 steps: facts, web check, script. It never loops.
3. **Round chips and pills.** Instead, use the 6px badge radius. Pills are banned.
4. **The "Prototype" label and the build-step tags.** These are for the prototype only.

### Motion

| Moment | What moves | Time |
|---|---|---|
| Hover on a row | The background tints. | 150 ms |
| The company panel opens | It slides in from the right, and the page dims. | 250 ms |
| The prep modal opens | It fades in and rises 8 px. | 250 ms |
| A panel or modal closes | It fades and slides out. | 150 ms (**new:** add this to DESIGN.md's Motion section first) |
| Another person in the same modal | The content cross-fades. The modal keeps its size. | 150 ms |
| The web part arrives | The grey shapes swap to text, which fades in. Nothing moves. | 150 ms |
| Waiting for a prep | The bar fills one step at a time. | One step per stage |
| A new "Today" chip | It fades in at the start of the row. | 150 ms |
| Copy | The button reads "Copied" for 2 seconds. | At once |
| "Who are you calling?" becomes the card | The modal widens. | 250 ms |
| A guided question is ticked | It dims, folds its follow-ups, and the next one opens. | 150 ms dim, 250 ms fold |
| A HubSpot sync runs | The bar fills as the counts climb. Nothing loops. | A new count every 2 seconds |

- **One curve for everything:** `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Reduced motion:** if the computer asks for it, all of the above turns off and things appear at once.
- **Nothing bounces, pulses or loops.**

### Speed

- **The panel opens already filled.** Hover or focus on a row loads the company in advance, as the Results page does (`prefetchQuery` in `results/index.tsx`).
- **The modal shows the HubSpot facts** in under 100 ms (**TBC**), before any Claude request.
- **A saved or searched-ahead prep shows at once.** A new prep takes under 15 seconds (**TBC**, measured in E3).
- **Nothing jumps.** The grey shapes keep the size of the content that replaces them.

### Keyboard and phone

- **Keyboard:**
  - "/" puts the cursor in the prep box, and ↑ ↓ and Enter pick a match.
  - J and K move through the rows, and Enter opens the panel, as on Results.
  - Esc closes whichever is on top, and focus goes back to where you were.
- **Phone:**
  - The prep box sticks to the top.
  - The panel and the modal fill the screen.
  - The phone number and the Call button stay at the bottom of the script. Buttons are 44 px tall.

### How we check

- **DESIGN.md's checklist:** its 7 points ("Check before showing any screen"), on every screen.
- **Screenshots** at 390, 768, 1280 and 1440 px wide, in light and dark. Cover:
  - the page and the company panel;
  - the modal while ready, searching and failed;
  - the "Who are you calling?" picker;
  - the empty states.
- **The existing tests:** `contrast.test.ts`, `design-lint.test.ts` and `icons.test.tsx`.
- **A screen reader pass:** the panel and the modal announce their title, and "Searching" is announced once.

## Part A: Get ready

- [x] **A1. Own copy and a baseline.** (2026-11-09, `c652c92`) Make the worktree on branch `plan-v10` (see "How to work this plan"). Run the backend and frontend tests once with `heavy.sh`, and note the counts in the Log.
  - **Done when:** the worktree exists, and the test counts are in the Log.
- [ ] **A2. Ask Levi.** One short email, written with `/plain` and sent on Al-khair's word. Ask for:
  1. HubSpot read access to contacts and calls. The HubSpot admin adds it. The exact scope names are **TBC**.
  2. The customer list (promised on 2 Nov), for the connections question.
  3. His OK to look up named people ("still there?"). Also his OK to send company names to Claude: the switch `hubspot_names_to_claude_ok` is off until he says so, and any web check needs it.
  4. Whether he wants a full call script or only the questions, and whether the team already uses an opener or script.
  5. The names "Companies" and "Call prep", and who gets the Companies tick.
  6. Which Lead Finder leads show on the Companies page (see B2).
  - **Done when:** the email is sent. The answers go in "Waiting on".

## Part B: The Companies page (works from the HubSpot copy)

- [x] **B1. A new project: Companies.** (2026-11-09, `66b8f12`, `8898430`, and the People tab's tick in the next commit)
  - A folder `engine/backend/apps/companies/` with its `AppSpec`: schema `companies`, routes under `/companies`. Add it to `apps` in `core/config.py`.
  - A "Companies" tick on the People tab, the same way as the Lead Finder tick (`APP_TITLES` and `require_app` in `core/api/access.py`).
  - On the website, a module in `src/apps/companies/`.
  - A project with one page shows as a plain link under Home, not as a dropdown. This is a small change in `shell/app-sidebar.tsx`.
  - Remove "Meeting prep" from `PLANNED` in `src/modules.ts`, because Companies replaces it.
  - **Files:** the new folder, `core/config.py`, `core/api/access.py`, `src/modules.ts`, `shell/app-sidebar.tsx`, tests.
  - **Done when:** an account without the tick gets a 403 on every Companies route (a test walks them all), and the sidebar shows Companies under Home.
- [x] **B2. The list (backend).** (2026-11-09, `66b8f12`)
  - `GET /companies` reads our HubSpot copy (`core.hubspot_companies`, with its offices, deals and owners).
    - **Search:** name, website and industry.
    - **Filters:** city, owner, deal (open, customer or none) and source.
    - **Sort:** name, staff, lease end or last talk.
    - **Pages:** 50 rows each.
  - Lead Finder rows come through a new `AppSpec` hook, `company_leads`, so Companies never imports Lead Finder code. My recommendation (**TBC** with Levi):
    - everyone sees the HubSpot copy;
    - people with the Lead Finder tick also see good leads (Pass or Director review, not rejected) that aren't in HubSpot yet. Those rows are marked "Not in HubSpot yet", and these people see the Lead Finder column;
    - a lead reaches everyone once it is approved and sent to HubSpot (PLAN-V9 C3). That waits on HubSpot writing (PLAN-V5 F1 to F3).
  - The server leaves out every Lead Finder field for people without that tick. Hiding them in the browser is not enough.
  - **Done when:**
    - tests cover each filter and sort;
    - a page of 13,913 fake rows comes back in under 300 ms (**TBC**);
    - an account without the Lead Finder tick gets no Lead Finder field.
- [x] **B3. One company (backend).** (2026-11-09, `66b8f12`)
  - `GET /companies/{key}` returns:
    - what the company does, its offices, deals and owner, and the date of the last talk;
    - saved notes from the shared memory (`core.memory`), from any project, under 30 days old;
    - the Lead Finder section, for the tick only.
  - The `key` is the HubSpot id, or `lead:<id>` for a lead not in HubSpot.
  - **Done when:** there are tests for a HubSpot company, a lead-only company, and a company with no offices.
- [ ] **B4. The page.**
  - The prototype's layout: the page header, the prep box (wired up in D1), the filter bar, the table, phone rows, and an empty state in the serif voice.
  - The table uses the shared `components/data-table.tsx`.
  - The filter only filters the list. The prep box only preps.
  - **Done when:** it works by keyboard and on a phone, in light and dark, and passes the design bar.
- [x] **B5. The company panel.** (2026-11-09, `8898430`)
  - Clicking a row opens a Sheet from the right, built like the Results lead panel (`results/lead-panel.tsx`):
    - a header with "Prep a call", "Open in HubSpot" and "Open full page";
    - four boxes: next lease end, last talk, deal and owner;
    - then About, Offices, Deals, People, Call history, News and research, Connections and Lead Finder.
  - Hover or focus on a row loads the company in advance.
  - The full page is at `/companies/:key`.
  - Until Part C is done, People and Call history say "Waiting for HubSpot access to contacts and calls."
  - **Done when:** the panel opens filled, Esc closes it and focus goes back to the row. Tests cover it.

## Part C: People and calls from HubSpot (waits on Levi's access)

- [x] **C1. Copy contacts and calls.** (2026-11-09, `4f1dcc6`)
  - Two new core tables, in one migration with the next free number (0014 today):
    - `core.hubspot_contacts`: name, job title, phone, company and last activity;
    - `core.hubspot_calls`: company, contact, owner, date, length, outcome and the note.
  - The daily sync (`core/hubspot/sync.py`) reads them. It keeps only the last 2 years of calls (**TBC**).
  - Email addresses stay in our copy. They are never sent to Claude.
  - The Companies `AppSpec` lists the scopes in `hubspot_needs`, so the Admin page says which access is missing.
  - When someone preps a call, that company's calls are read live from HubSpot. Reading is free, and a call logged this morning then shows up.
  - **Done when:** the tests pass on the fake HubSpot, and the Admin page says "waiting for" the scopes until they are added.
- [ ] **C2. People and calls on screen.** The panel's People list (each person with "Prep a call") and the Call history go live. "Last talk" shows the note, not only the date.
  - **Done when:** tests pass, and it is checked in the browser.

## Part D: Call prep

- [x] **D1. The prep box.** (2026-11-09, `66b8f12`, `8898430`)
  - `GET /companies/search?q=` returns up to 4 people and 4 companies, from the HubSpot copy and, after C1, the contacts. A trigram index keeps it fast (**TBC**).
  - On the website it is a search box with a list of matches, built on the shared `components/ui/command.tsx`.
  - "Today" chips reopen my preps from today.
  - **Done when:** matches come back in under 150 ms on the full copy (**TBC**), and the keyboard tests pass.
- [x] **D2. The facts pack (free).** (2026-11-09, `4f1dcc6`)
  - One function gathers everything we know about the company and the person, each fact with its source:
    - HubSpot fields and call notes;
    - saved notes in the memory;
    - the Lead Finder lead.
  - The modal shows its HubSpot parts at once from this, before any Claude request.
  - **Done when:** tests show every fact with its source, and a note over 30 days old is left out.
- [x] **D3. The prep request (Claude).** (2026-11-09, `4f1dcc6`)
  - **The request:** one Claude request with web search, up to 3 searches (**TBC**). It looks for:
    - news from the last 90 days;
    - "still there?" for the person, if Levi agrees.
  - **What comes back:** the script in a fixed form: opener, why now, questions, if they say, and the goal of the call.
  - **No made-up facts:**
    - Every line must point to a fact from the pack, or to a page found in this search. A line with no source is dropped.
    - Web pages are data, never instructions. A page can hide text that tries to steer the AI (prompt injection). The prompt says so, and the fixed form leaves no room for actions.
  - **Reuse:**
    - New notes go to the shared memory, so the next prep and the Lead Finder reuse them.
    - When the company's web check is still fresh, a script for another person there is a smaller request with no web search.
  - **Saving:** each prep goes in a new table, `companies.preps`: company, person, script, sources, cost, who and when. It is reused for 7 days (**TBC**). Refresh makes a new one.
  - **Limits:**
    - US$0.25 a prep (**TBC**);
    - it counts in the daily limit (US$150);
    - a switch `prep_enabled`, off by default.
  - **Done when:** tests with a fake Claude show that:
    - a line with no source is dropped;
    - a second prep within 7 days costs nothing;
    - the cap stops a prep;
    - no company name is sent while `hubspot_names_to_claude_ok` is off.
- [ ] **D4. The prep modal.**
  - **Layout:** a Dialog with:
    - "Before you dial" (Levi's 4 questions);
    - the 5 numbered script steps;
    - a side column: the last call, quick facts and "Company info";
    - a footer: the number, "Copy number", "Copy script" and "Refresh".
  - On a phone, the number is a `tel:` link that dials.
  - **A company with no person:** the modal asks "Who are you calling?" and lists its people. "Prep a cold call" gives a script for the switchboard.
  - **States:**
    - ready;
    - searched ahead;
    - searching, with the bar filling in 3 steps;
    - failed, in plain words, with what to do next.
  - While a prep is searching, the website asks for it again every 2 seconds. Live updates like the run pages are another option (**TBC**).
  - **Done when:** there are tests for each state, the keyboard and focus return. It is checked on a laptop and a phone, in light and dark.
- [x] **D5. Search ahead.** (2026-11-09, `4f1dcc6`)
  - A schedule (`JobSpec` "companies.search_ahead") runs on weekdays at 6:30, after the 6:00 HubSpot sync.
  - It preps the companies with an open deal, and the Lead Finder's good leads. Each prep is for the person on the last call, or a cold call when nobody is named.
  - It skips a company with a prep or saved news under 7 days old.
  - It stops at its daily cap of US$5 (**TBC**).
  - It stays off until Al-khair switches it on. The Schedules page shows it.
  - **Done when:** a fake run keeps to the cap and the skip rules, and its preps show "Ready. Searched ahead at 6:30."

## Part E: Polish, check and finish

- [ ] **E1. Design and motion pass.**
  - Go through "The design and motion bar" on every screen. That includes the 4 fixes from the prototype, and adding the 150 ms exit to DESIGN.md first.
  - Take the screenshots listed there.
  - **Done when:** every check passes, and Al-khair signs off the look.
- [x] **E2. Access and safety check.** (2026-11-09, `08033d5`)
  - A test walks every Companies route as four accounts: no tick, Companies only, Companies and Lead Finder, and Admin.
  - A test checks that no email address and no phone number is ever in a Claude request.
  - **Done when:** both tests pass.
- [ ] **E3. Full check and a paid test.**
  - Run every backend and frontend test, the lint and the type check (`heavy.sh`).
  - On Al-khair's word, make 10 real preps, for about US$1 to US$2 (**TBC**). Record the cost and the time of each. Then set the limits in D3 and D5 from those numbers.
  - **Done when:** the numbers are in the Log.
- [ ] **E4. Docs, merge and switch on.**
  - Update `projects/prep/PREP.md` and the engine docs.
  - On Al-khair's word:
    1. merge, push and deploy;
    2. give the ticks;
    3. switch on `prep_enabled`, then search ahead.
  - **Done when:** the team can prep a call on the live site.

## Part F: The prep card's script, and syncing from the page (added 9 Nov)

Al-khair, 9 Nov, after comparing the build with the prototype: the company panel is everything we know about a client; the prep card is quick info, with a sales script and guided questions on it. And a button on the page that fetches everything from HubSpot.

- [x] **F1. The prep card: quick info, a sales script and guided questions.** (2026-11-09, `0ee5558`)
  - "Before you dial" is 4 tiles, as in the prototype. Beside the script: the last time we talked, quick facts, and "Company info", which opens the panel.
  - The script is written in the browser from our HubSpot copy (`playbook.ts`), so it is free, ready at once, and there while call prep is off. Its wording is **TBC** with Levi.
  - Guided questions: why each is asked, and what to ask next for each likely answer. Tick one as you ask it, and the next one opens. Ticks aren't saved.
  - Call prep's own script gets follow-ups too (prompt `prep-2`). A follow-up only asks: it never states a fact.
  - **Done when:** with call prep off, every card has a script and guided questions, and the tests pass.
- [x] **F2. "Sync with HubSpot" on the Companies page.** (2026-11-09, `0ee5558`)
  - A full sync (about 10 minutes, free), beside "HubSpot copy updated ...". One sync at a time, for everyone.
  - The sync saves how far it has read every 500 records, so the bar fills. When it finishes, the list refreshes and a toast says what was copied.
  - **Done when:** a test follows a sync from the button to the toast, and the sync tests pass.

## Part G: The Companies page on a phone (added 9 Nov)

Al-khair, 9 Nov: the team should be able to use it from a phone, between calls. Under 640px wide (DESIGN.md "Phone"):

- [x] **G1. Companies on a phone.** (2026-11-09, `66b9b71`)
  - **The list** is one card per company instead of the table (which showed only the name and the deal): name and deal, place, next lease end and last talk (Ochre when they need attention), owner. A tap opens the panel; the touch starts loading the company, so it opens filled. Previous and Next under the list scroll back to its first card.
  - **The filters** sit behind one "Filters" button that counts them and opens a sheet from the bottom, as on Results.
  - **The prep box** stays pinned to the top while the list scrolls, slimmer, with today's chips on one line that scrolls sideways.
  - **The company panel and the full page** keep the header and the close button at the top; "Prep a call" is a full-width button at the bottom, where a thumb reaches it.
  - **The prep card's bottom bar:** one big "Call" button, then Copy number, Copy script and Refresh.
  - **Done when:** tests show the cards, the Filters sheet, the panel's bottom button and the card's Call button on a phone. Looking at it on a real phone is part of E1.

## Waiting on

- **Levi:**
  - HubSpot access to contacts and calls (his HubSpot admin);
  - the customer list;
  - his OK on named people, and on company names going to Claude;
  - a full script or questions only, and any opener the team uses;
  - the names, and who gets the Companies tick;
  - which Lead Finder leads show on the Companies page.
- **Al-khair:**
  - sending the email to Levi (drafted in [EMAIL.md](../projects/prep/EMAIL.md));
  - the screenshots and the look (E1), in a browser on his laptop;
  - restarting the preview's backend (a few seconds), so F2's progress counts and call prep's follow-ups load;
  - the spend for E3;
  - switching on `prep_enabled` and search ahead;
  - merging, pushing and deploying.

## Risks

- **A script could state a wrong fact.** Every line needs a source, and lines without one are dropped. The sources show on the screen, and Refresh makes a new prep.
- **Calling someone who has left is embarrassing.** "Still there?" is the first thing on the script, in Terracotta when they have left.
- **Personal data.** Emails and phone numbers never go to Claude. Names go only with Levi's OK.
- **Cost could creep up.** There are four brakes: a cap per prep, the daily limit, 7 days of reuse, and the search-ahead cap.
- **The list could be slow with 13,913 rows.** Paging and sorting happen on the server, with indexes.
- **Two sessions in one folder could mix their changes.** That's why this plan uses its own worktree.
- **HubSpot access may take weeks.** Parts B and D still work from the copy, and People and Call history say they are waiting.

## Not in this plan

- **Prepping a company we don't have at all** (a web-only prep). For now, the page says it isn't in HubSpot or the Lead Finder. Later.
- **Call notes after the call:** the mic button, and Levi's "cockpit". That is the Call notes project.
- **Call blocks:** tick 10 companies and press "Prep all". Later.
- **Meetings.** Later, if Levi asks.
- **Writing to HubSpot:** PLAN-V5 F1 to F3.

## Log

Newest first.

- 2026-11-09: **Merged into `master`** on Al-khair's word: a fast-forward to `725fc9f` (all 11 commits of `plan-v10`). Not pushed and not deployed, so E4 stays open. The main folder's two leftovers (the CLAUDE.md pointer and the first draft of this plan) were the same as the branch's, so nothing was lost. The dev database `leadfinder` is still at 0013: master's backend moves it to 0014 the next time it starts (it migrates on start). The branch preview keeps running on its copy (`leadfinder_v10`).

- 2026-11-09: **Part G (G1) built:** the Companies page on a phone. Checks: website 63 files and 913 tests pass, lint and types clean, the design rules pass. Not yet looked at on a real phone (no browser could be driven here); in Chrome on the laptop, the device view (Ctrl+Shift+M) shows it. Found on the way, for later (**TBC**): the site's rule that gives fields 16px text on a phone (so an iPhone doesn't zoom in) sits in the base layer, so a field's own `text-ui` wins. The Companies search sets 16px itself; other pages' fields still zoom on an iPhone.

- 2026-11-09: **Part F added and built (F1, F2),** after Al-khair compared the build with the prototype. The preview runs the branch on a copy of the dev database (`leadfinder_v10`, at 0014), so `leadfinder` stays at 0013 for master. The website shows F1 live. The backend needs a restart (a few seconds, on Al-khair's word) to load F2's progress counts and the follow-ups in call prep's script. Checks: Companies backend tests 52 and sync tests 13 pass; website 63 files and 910 tests pass, lint and types clean. Also fixed: the branch's website couldn't load its fonts (the worktree links to the main folder's packages), so the preview showed a fallback typeface.

- 2026-11-09: **What is left, and why.** A2: the email is drafted in [EMAIL.md](../projects/prep/EMAIL.md), to send on Al-khair's word. B4, C2 and D4: built and tested by keyboard, but not yet looked at on a phone or in dark mode, because no browser could be driven here (the Chrome extension isn't connected, and Playwright isn't installed: installing it downloads a browser, which needs Al-khair's OK). E1 needs those screenshots and Al-khair's sign-off. E3: every check passes (below); the 10 paid preps wait on his word. E4: the docs are done ([PREP.md](../projects/prep/PREP.md), `engine/README.md`, `engine/AGENTS.md`); merging, pushing, deploying, the ticks and switching on wait on his word.
- 2026-11-09: **Checks after the build.** Backend `RUN_GATES=1`: 3,323 passed, 25 skipped, with the known timing test left out. Website: lint and types clean, 62 files and 900 tests pass (with the People tab's Companies tick), the build works (the Companies page's code is 14 kB, 5 kB zipped). The contrast, design-lint and icon tests pass with the new colour.
- 2026-11-09: **Decisions made while building, for Levi or Al-khair to confirm (TBC).**
  - A deal is won at "Ordered - Contract Signed" or "Handed over to client relations"; "Closed lost" and "Dissolved" are closed; everything else is open. A customer has a won deal or HubSpot's lifecycle stage "Customer".
  - Lead Finder rows: Pass and Director review, not rejected, not in HubSpot, by each company's newest research (a newer Drop hides an older Pass).
  - Calls are read with the contacts scope (`crm.objects.contacts.read`). The sync copies every contact and the calls of the last 2 years each day.
  - A prep is one Claude request (Sonnet 5.5 by default, on the Settings page). The cap per prep stops a second try; it can't stop a request already sent. Search ahead runs every day at 6:30 and skips weekends itself, because a schedule can't say "weekdays".
  - With two projects, a core list that names no project (runs, the search log, memory) now shows the projects the person may use, so a Lead Finder account still sees its own runs. Before, it needed every project's tick.
  - DESIGN.md: panels and dialogs now leave in 150 ms, and the Companies colour is Heath, a muted plum.
- 2026-11-09: **Speed (B2, D1).** On 13,913 made-up companies with offices, deals and 40,000 people: a page of the list takes 35 to 75 ms (limit 300) and the prep box 40 ms (limit 150). No trigram index was needed.
- 2026-11-09: **A1 baseline,** in the worktree `../contour-v10` on `plan-v10` from `3f13174`. Backend `RUN_GATES=1`: 3,270 passed, 1 failed, 25 skipped. The failure is the timing test `test_cancel_mid_run_keeps_what_finished_and_marks_it_cancelled`, which passed 3 times in a row on its own. Website on the same commit: 61 files, 885 tests, all pass.

- 2026-11-09: **Plan written,** from `projects/prep/PREP.md` and the prototype. No code yet.
