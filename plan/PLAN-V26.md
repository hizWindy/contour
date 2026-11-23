# Admin tools and no more waiting: plan, version 26

This plan stops Claude requests from blocking each other: a call prep never waits behind a Lead Finder run again. It gives the Platform admin the tools Al-khair listed: one-click sign-in details, a reset that can keep someone signed in, a changeable username, an Unlock button, an Activity page per person, and a view of the database with a few safe edit screens. It adds a faint glass to each module and a tighter sidebar. It also makes plans cheaper to build: old copies go, and agents read less before they start. One session builds it, in five parts, after PLAN-V25 is merged.

**TBC** means to be confirmed.

- **Status:** drafted on 22 Nov 2026 from Al-khair's chat of 21 and 22 Nov. Being built since 22 Nov on `plan-v26`, on his "implement v26" (A1). Joined into `master` on 23 Nov (M1). Not pushed or deployed.
- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 23 Nov 2026.
- **Progress:** every step of Parts 1 to 5 is built and checked, and joined into `master` (23 Nov, M1). Not pushed or deployed. T3-4 is switched off until Levi's OK. Open: Al-khair's looks (T3-3, T4-3, T5-1, T5-2), S3 (with T3-4 and T4-1), the plan list line, S0, S2 (last, after M4), S4, and M2 to M4.
- **Sources:**
  - Al-khair's chat on 21 and 22 Nov 2026 (his 13 asks, then his answers);
  - the code on `master` (`ff0f658`). The files this plan changes are the same as on `b84c3cf`, read on 21 Nov;
  - Claude's docs, "Workspaces", the part on workspace limits, read on 22 Nov.
- **Comes after:** [PLAN-V25.md](PLAN-V25.md) (A smarter Assistant), being built now in `../contour-v25`. Nothing here touches PLAN-V25's plan file, branch, copy or database.

## Why

**Claude requests wait for each other.** One line of 2 places serves every Claude request in the app (`claude_concurrency`, `engine/backend/core/config.py:362`, at most 4). A request keeps its place until it ends, web searches included (`engine/backend/core/claude/client.py:245`). A Lead Finder run researches 2 companies at once, so it can take both places. A call prep then waits until one of them ends.

**The admin side is missing tools.**
- The username can't be changed after an account is made.
- Copy takes only the password, not the username or the address.
- A password reset always signs the person out on every device.
- The 10th wrong password in a row locks an account for 15 minutes, and Admin has no Unlock.
- The sign-in log (every sign-in, with IP address and device) has no screen and is kept forever.
- Nothing records which admin changed an account, or who started a run or a Claude request.

**Plans cost a lot to build.** The laptop holds 40 copies of the code, 33 with their own website install (939 MB for PLAN-V24's). Every new agent first reads about 200 KB: `engine/AGENTS.md` (61 KB), `engine/DESIGN.md` (44 KB) and the plan (PLAN-V24 was 98 KB). That is roughly 50,000 tokens for each agent, each time.

## Go signals

| Say | What it does |
|---|---|
| `clean copies` | S0 only: removes old plan copies. Safe while PLAN-V25 is being built, so it can run now |
| `implement v26` | Builds S1 to S3, Part 1 (no more waiting), Part 2 (people and passwords), Part 3 (the Activity page), Part 4 (the Data tab), then Part 5 (the look) |
| `merge v26` | Checks everything, then moves `master` to `plan-v26` |
| `deploy v26` | Pushes `master`, deploys, and does the live check (M3) |

- `implement v26` starts only after `merge v25`.
- Each screen waits for your look. Pushes, deploys, deletions and paid checks happen only on your own word in chat.

## Decided in chat (21 and 22 Nov)

1. **Password manager:** no stored passwords anyone can read. Passwords stay scrambled (argon2id). The Platform admin resets a password and copies it.
2. **Database:** a read-only view of every table, plus edit screens for a few tables.
3. **Claude:** separate lanes, not one line and not no limit. With no limit, Anthropic answers "busy" (HTTP 429) when too many go at once. Our code tries again twice, waiting up to 20 seconds each time (`BUSY_RETRIES`), and then the request fails.
4. **No second API key for now.** Anthropic's limits cover the whole organization, not each key. A workspace (a group of keys) can be capped lower but never raised above the organization's limits (Claude docs, "Workspaces"). Revisit only if the live logs show 429s (M3).
5. **Change access is not in this plan.** PLAN-V19 already lets the Platform admin change the role and the 8 access ticks.
6. **Al-khair took the recommendations** on 22 Nov ("I want your recommendation"): the username edit, one Copy button, the sign-out switch, Unlock, the record of who changed what, the Activity page with device sign-out and spending, a keep time for sign-in records, the glass, the sidebar, and lighter builds.
7. **PLAN-V25 comes first,** and nothing here may disturb it while it's being built.

## Words used here

- **Lane:** a group of Claude requests with its own number of places. Requests in one lane never wait for another lane.
- **Copy (of the code):** a git worktree, a second folder checked out from the same repo, like `../contour-v24`.
- **Platform admin:** the one role that sees Admin settings (PLAN-V19).

## What exists already (so nothing is built twice)

- **The sign-in log** (`core.audit_log`): every sign-in, failure, lock, sign-out and password change, with IP address and device. The route `GET /auth/log` is for the Platform admin. It has no screen, no filter by person, and no keep time.
- **Sessions** (one per signed-in browser) keep IP address and device. Ended sessions are deleted a week later (`core/auth/sessions.py`, `clean_up`). Code to end one session, or all of a person's, already exists.
- **Who did what:** call notes (`user_id`), preps (`made_by`) and meeting forms (`made_by`, `sent_by`) record the person. Runs (`runs`) and Claude requests (`searches`) don't.
- **Admin, People** (`apps/lead-finder/admin/people.tsx`, `core/api/people.py`): add a person, change role, ticks, position, active and HubSpot user, and reset a password.
- **Screens that already edit their own tables:** Settings, Schedules, Learned names and style notes.
- **Glass** is on floating layers only (`styles/index.css:436`, PLAN-V19 choice 17). **Sidebar** rows are `h-9` (36px), `touch:h-11` (44px), with `gap-1` (4px).

## Choices made for you

**Part 1: no more waiting**

1. **Three lanes.** Each size can be changed in Settings, from 1 up to the hard ceiling (`hard_concurrency`, 4):
   - **People, 4 (TBC):** call prep, Research again (on a company or a lead card), sorting a call note, the Assistant, and a pre-read drafted on a click.
   - **Runs, 2:** Lead Finder runs. Each run keeps its own limits as well.
   - **Jobs, 1:** the morning search ahead, meeting forms, other scheduled work and the command line.

   Up to 7 requests can run at once, instead of 2 today.
2. **The lane follows who started the work, not the code.** Example: a prep from a click is People. The same prep made by the 6:30 search ahead is Jobs.
3. **Inside a lane, first come, first served,** as today. The daily Claude limit still covers every lane together.
4. **Show the wait.** A prep or Research again that waits more than 1 second (**TBC**) shows "Waiting for Claude: 1 ahead of you."
5. **`claude_concurrency` goes.** A saved value is removed, and the three new settings start at their defaults.

**Part 2: people and passwords**

6. **Reset password** gets a "Sign them out everywhere" switch, on by default. Off: the new password works at once, and their open browsers stay signed in.
7. **One "Copy sign-in details" button,** after Add person and after a reset. It copies:
   ```
   Contour HQ: https://contourhq.online
   Username: jsample
   Password: <the new password>
   ```
   With no username, it copies the email. The address is the site the admin is on.
8. **The username can be changed** in Edit person, with Add person's rules (lower case, no @, not taken). Cleared, the person signs in with their email. The old username stops working at once.
9. **Unlock.** A locked person's row says "Locked until 3:40 pm after 10 wrong tries", with an Unlock button. Unlock clears the count.
10. **Every admin change records who made it:** the admin, their IP address and their device, in the sign-in log's details. No new table.

**Part 3: the Activity page**

11. **One page per person:** Admin, People, a person, Activity. Tabs: Sign-ins, Devices, Calls and notes, Preps, Sent, Spending. Newest first, 50 to a page.
12. **Devices** lists each signed-in browser with its device, IP address, first use and last use, and a Sign out button. "Sign out everywhere" sits above the list.
13. **Spending** shows the person's Claude cost by day and by kind (preps, call notes, the Assistant, runs). From this plan on, each Claude request saves who asked (`searches.user_id`), and each run saves who started it (`runs.started_by`). Older ones show as "Not recorded before this update".
14. **Sign-in records are kept for 90 days (TBC with Levi).** A daily job deletes older sign-in log rows. Call notes, preps, forms and spending records stay as they are.
15. **The team is told.** One line on the sign-in page: "Contour keeps a record of sign-ins and devices for 90 days." It also goes in the team note. Both are **TBC with Levi**.

**Part 4: the Data tab**

16. **Admin, Data,** for the Platform admin only. Every table on a list in code, each with a plain name, like "Leads" or "Call notes". 50 rows to a page, with search and sort. No export or download.
17. **Never shown:** password hashes, session token hashes and any key. Contact emails and phone numbers are masked, like `j•••@northwind.com.au` (**TBC with Levi**).
18. **Edit screens for three tables** (recommended; Al-khair confirms, A3):
    - **Leads:** company name, city, website, result and note.
    - **Call notes not yet sent** (needs a company, to confirm, failed): company, person, outcome and note, and deleting a stuck one.
    - **Memory:** deleting a wrong note.
19. **HubSpot tables are view-only.** They say "Change it in HubSpot, then press Sync." A table with its own screen (Settings, for example) links to it.
20. **Every edit is recorded** with the table, the row, the old and new value, who and when, and has an Undo. The record goes in a new table, `core.admin_edits`.

**Part 5: the look**

21. **A faint glass** on each page's header band and on Home's cards. Tables, rows, forms and lists stay solid. This changes PLAN-V19's choice 17 and `engine/DESIGN.md`.
22. **A tighter sidebar** when using a mouse: rows go from 36px to 32px, and the gap from 4px to 2px. Touch screens and windows under 640px wide keep 44px, because a fingertip needs it.

**Lighter builds**

23. **Old copies go** (S0). Their branches stay, because they are small.
24. **One copy per plan, no helper copies.** PLAN-V24 used 4.
25. **A smaller first read** (S2). `engine/AGENTS.md` becomes a short core (under 15 KB, **TBC**) plus topic files that an agent reads only when a step needs them. Plans stay under 30 KB.

## Words on screen

- "Waiting for Claude: 1 ahead of you."
- "Copy sign-in details", then "Copied".
- "Sign them out everywhere"
- "Locked until 3:40 pm after 10 wrong tries." and "Unlock"
- "Change it in HubSpot, then press Sync."
- "Undo"

## What it costs

- **To build:** time only.
- **To run:** no new service. Up to 7 Claude requests can run at once instead of 2, so a busy day may reach the daily limit sooner. The daily limit itself doesn't change.
- **New packages:** none.
- **Disk:** S0 frees roughly 30 GB (estimate).

## Who builds it

One session builds every step, in order: S0 to S3, then Parts 1 to 5. Parts 2 to 4 share the People routes and screens, so two sessions would wait on each other.

- **Backend steps** are `backend-agent` work, with the `api-change` skill, and `db-migration` for the migration.
- **Website steps** are `frontend-agent` work, with the `ui-build` and `design-review` skills.
- **One migration,** `0029_v26_activity` (after `0027`: PLAN-V25 added no migration, so there is no `0028`): `searches.user_id`, `runs.started_by` and the `core.admin_edits` table.
- **Contract changes:** the reset's switch, the username in Edit person, Unlock, the Activity routes, the Data routes and a prep's wait. Make the website's types again after each.
- **M1's independent check** is a fresh `review-agent` with the `merge-check` skill.

## How to work this plan

As [PLAN-V25](PLAN-V25.md)'s "How to work this plan", with these changes:

- **The copy:** `git worktree add ../contour-v26 -b plan-v26 master`, after `merge v25`.
- **Ports and database:** backend `API_PORT=8131`, website 5301, database `leadfinder_v26` (a copy of the dev database at PLAN-V25's newest migration), test suffix `_v26`. Leave 8000, 5173, PLAN-V25's 8121 and 5291, and older plans' ports alone.
- **One copy only.** No helper copies. Agents work in this copy one at a time.
- **Never start `tests.e2e.serve` from this copy as it is.** It migrates the shared `leadfinder_e2e` to this plan's migration, and then no older copy's fake backend starts (the Log, 23 Nov). A browser check here uses a database of this plan's own, checked by name before the start, or mocked answers.
- **No Claude key and no HubSpot key** in the copy. Blank `ANTHROPIC_API_KEY` for the process.
- **Made-up names only,** like "Northwind" and "Jo Sample". Check any new example name against our copy before a commit (the `github` skill, "Never on GitHub").
- **After S2,** read only the topic files a step needs.

## Before the build starts

- [ ] **S0. Remove old copies** (`clean copies`; it can run now).
  - List every copy: its branch, whether that branch is merged into `master`, any uncommitted files, and its size.
  - Remove only copies whose branch is merged and which have no uncommitted work. Copies with uncommitted files are listed for Al-khair and kept until he says. Two are known: `contour-v19-imp2` (a blank line in PLAN-V19.md) and `contour-v21` (dev logs).
  - Never touch: the main folder, `contour-v25`, `plan-v25`, `leadfinder_v25`, or the copy under `.local/share/kilo/`, which belongs to another tool.
  - Branches stay. Old databases (`leadfinder_v10` to `leadfinder_v24`, and their test databases) are listed with their sizes, and dropped only on his word (A5).
  - **Done when:** the Log has the list, what was removed and the space freed; `git worktree list` shows only the kept copies; and `contour-v25`'s commit and status are the same before and after.
- [x] **S1. The branch and the copy** (after `merge v25`). Done 22 Nov (`3dd3b77`), from `master` on Al-khair's word. The plan list line waits for his answer (see the Log).
  - Make `plan-v26` from `master` in `../contour-v26`. Its first commit holds this plan.
  - Add the plan's line to the plan list wherever it is then. If Al-khair's move of the list from `CLAUDE.md` to `AGENTS.md` is still uncommitted, ask first.
  - Make the database `leadfinder_v26`, and check the newest migration.
  - **Done when:** `plan-v26` holds this plan, and the fast backend tests and the website tests pass on it.
- [ ] **S2. A smaller first read.** Choice 25.
  - Split `engine/AGENTS.md` into a short core and topic files, and point `.claude/agents/*.md` at the topic files.
  - Only after PLAN-V25's docs step (its M4) and Al-khair's uncommitted `AGENTS.md` and `CLAUDE.md` changes are committed. If either is still open, do S2 last, as M5.
  - **Done when:** the core is under 15 KB; every heading of the old file has a new place, listed in the Log; and a fresh agent's first read is measured before and after, in the Log.
- [ ] **S3. Levi's answers** (**TBC with Levi**), about 10 minutes: the 90-day keep time (choice 14), the line on the sign-in page (choice 15), and masking contact details in the Data tab (choice 17).
  - **Done when:** the Log has his answers, and choices 14, 15 and 17 match them.
- [ ] **S4. The rate limits** (Al-khair, about 5 minutes, before M2). On the Console's Rate limits page, note the requests and tokens per minute for the models Contour uses.
  - **Done when:** the Log has the numbers, and the lane sizes fit them.

## Part 1: no more waiting

- [x] **T1-1. Three lanes.** Done 23 Nov (`723aedf`). (`core/claude/limiter.py`, `client.py`, `core/config.py`, `core/prefs/service.py`, and each caller). Choices 1, 2, 3 and 5.
  - **Done when:** tests pass: a run holding both Runs places doesn't delay a prep; 4 People requests run at once and the 5th waits; a search ahead prep waits in Jobs, not People; the daily limit stops every lane; and Settings shows the three sizes, each from 1 to the ceiling. The contract and the website's types are made again.
- [x] **T1-2. Show the wait.** Done 23 Nov (`723aedf`). (the lane tells a waiting request its place; the prep's answer gains how many are ahead; `apps/companies/script-header.tsx` and the lead card). Choice 4.
  - **Done when:** tests pass: a waiting prep shows the words with the right number; the words go when it starts; a screen reader hears them once; and a request that starts at once never shows them.
- [x] **T1-3. Part 1 check.** Done 23 Nov (the numbers are in the Log). Website: lint, types, tests, build, `node scripts/bundle-report.js`. Backend: ruff, mypy, the fast tests, the Companies tests and the run tests.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 2: people and passwords

- [x] **T2-1. Reset with a switch.** Done 23 Nov (`0338f24`). (`core/api/people.py`, `admin/people.tsx`). Choice 6.
  - **Done when:** tests pass: on, every session ends; off, open sessions stay and the new password works; and the log says which.
- [x] **T2-2. Copy sign-in details.** Done 23 Nov (`0338f24`). (`admin/people.tsx`). Choice 7.
  - **Done when:** tests pass: the copied text matches choice 7 exactly; with no username it has the email; and "Copied" shows for 2 seconds.
- [x] **T2-3. Change the username.** Done 23 Nov (`0338f24`). (`core/api/people.py`, Edit person). Choice 8.
  - **Done when:** tests pass: a change works; a taken name is refused (409); an @ is refused; clearing works; the old username can't sign in and the new one can; and the log has the change.
- [x] **T2-4. Unlock.** Done 23 Nov (`0338f24`). (a new route beside reset, the person's row). Choice 9.
  - **Done when:** tests pass: a locked person shows the lock and its end time; Unlock clears it; the right password then works at once; and the log has the unlock.
- [x] **T2-5. Who changed it.** Done 23 Nov (`0338f24`). (`core/api/people.py`, `core/auth/audit.py`). Choice 10.
  - **Done when:** tests pass: every admin route's log entry has the admin, the IP address and the device.
- [x] **T2-6. Part 2 check.** Done 23 Nov (the numbers are in the Log). As T1-3, plus the `security-check` skill on sign-in and passwords.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 3: the Activity page

- [x] **T3-1. Save who asked.** Done 23 Nov (`95dec9c`). (the migration; who asked, set once per request and per job; the search log; `runs`). Choice 13.
  - **Done when:** tests pass: a prep, a call note and an Assistant command save the person; a scheduled job saves none; a run saves who started it; and the migration goes up and down cleanly.
- [x] **T3-2. The Activity routes.** Done 23 Nov (`95dec9c`; the paging test for all six tabs in `8c49680`). (a new `core/api/activity.py`, Platform admin only). Choices 11 and 12.
  - **Done when:** tests pass: each tab's route pages 50 at a time, newest first; ending one session or all of them works; anyone but the Platform admin gets 403; and the contract is made again.
- [ ] **T3-3. The Activity page.** Built 23 Nov (`95dec9c`), its tests pass. Waits for Al-khair's look. (`admin/`, a new page from the People table). Choices 11 to 13.
  - **Done when:** tests at 1440 and 390 px pass: the six tabs show their rows; Sign out asks first, then ends that browser; an empty tab says so in words; and Al-khair has looked.
- [ ] **T3-4. The keep time and the sign-in page line.** Built 23 Nov (`8253e76`), its tests pass. Both are off until Levi's OK (S3): then set `SIGN_IN_RECORDS_OK=true` on the server. (a daily job, `auth/login-page.tsx`). Choices 14 and 15, after S3.
  - **Done when:** tests pass: sign-in log rows older than the keep time go, and nothing else does; and the line shows on the sign-in page.
- [x] **T3-5. Part 3 check.** Done 23 Nov for what is built (the numbers are in the Log). Run again after T3-4, 23 Nov: the Log. As T1-3, plus the contract gate (`RUN_GATES=1`).
  - **Done when:** all pass, and the numbers are in the Log.

## Part 4: the Data tab

- [ ] **T4-1. The view.** Built 23 Nov (`a5caf5f`) with choice 17's mask, its tests pass. Waits for S3 to confirm the mask. (a new `core/api/data.py`, `admin/data.tsx`). Choices 16, 17 and 19.
  - **Done when:** tests pass: every listed table shows, paged, searchable and sortable; no hash or key ever leaves the server; contact details are masked as S3 decided; HubSpot tables have no edit; and anyone but the Platform admin gets 403.
- [x] **T4-2. The change record and Undo.** Done 23 Nov (`a5caf5f`): the record and the Undo logic. Their route and button come with T4-3. (`core.admin_edits`). Choice 20.
  - **Done when:** tests pass: each edit saves the old and new value, who and when; Undo puts the old value back and is recorded too; and Undo is refused if the row changed since.
- [ ] **T4-3. Three edit screens.** Built 23 Nov (`8253e76`) with the three recommended, its tests pass. Waits for Al-khair's look. (Leads, Call notes not yet sent, Memory). Choice 18, after A3.
  - **Done when:** tests pass: only the listed fields can change; a call note that is sending or logged can't be edited; a delete asks first; and Al-khair has looked.
- [x] **T4-4. Part 4 check.** Done 23 Nov for what is built (the numbers are in the Log). Run again after T4-3, 23 Nov: the Log. As T1-3, plus the `security-check` skill.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 5: the look

- [ ] **T5-1. A faint glass.** Built 23 Nov (`2baade5`), its tests pass and Home was measured (the Log). Waits for Al-khair's look. (`styles/index.css`, `components/page-header.tsx`, Home's cards, `engine/DESIGN.md`). Choice 21.
  - **Done when:** the contrast tests pass (4.5 to 1 for text, light and dark); no list or table has blur; with reduced transparency it falls back to solid; Home's first frame is measured before and after, in the Log; and Al-khair has looked.
- [ ] **T5-2. A tighter sidebar.** Built 23 Nov (`2baade5`), its tests pass. Waits for Al-khair's look. (`shell/app-sidebar.tsx`, `components/ui/sidebar.tsx`, `engine/DESIGN.md`). Choice 22.
  - **Done when:** tests pass: rows are 32px with a mouse at 1440 px, and 44px at 390 px and on touch; and Al-khair has looked.
- [x] **T5-3. Part 5 check.** Done 23 Nov (the numbers are in the Log). As T1-3, plus the `design-review` skill.
  - **Done when:** all pass, and the numbers are in the Log.

## Merge, checks and going live

- [x] **M1. Merge** (`merge v26`, on Al-khair's word). Done 23 Nov (`8d173e9`, `a0e5086`, `9a80ae0`; the Log). First: `plan-v26` takes `master` once PLAN-V25 is there; `0029` stays after `0027`, because PLAN-V25 added no migration; the contract and types are made again; and the main folder's untracked `plan/PLAN-V26.md` moves aside, or the fast-forward stops on it. Full checks, the `merge-check` skill and a fresh `review-agent`. Then `git merge --ff-only plan-v26` in the main folder.
- [ ] **M2. Deploy** (`deploy v26`), after S4. Push `master` and deploy. The migration runs on deploy.
- [ ] **M3. The live check:**
  1. Start a small Lead Finder run, then open a call prep: the prep starts at once. This is paid (a small run plus one prep, capped at US$0.25), so on Al-khair's word.
  2. Reset a test account with the switch off: its browser stays signed in.
  3. Copy sign-in details, and sign in with them.
  4. Open your own Activity page: your devices and spending are there.
  5. A week later, count "busy" retries (`claude_busy_retry`) in the live logs. If there are any, look again at a second key in its own workspace.
- [ ] **M4. The docs.** The plan list, `engine/AGENTS.md` (or its topic files), `engine/DESIGN.md`, and a short team note about sign-in records, written with `/plain` and sent on Al-khair's word.

## Waiting on

- **Al-khair:**
  - **A1.** Approve this plan, or change it.
  - **A2.** S4's rate limits, before M2.
  - **A3.** Confirm the three edit screens (choice 18), or name others. On 23 Nov he said "pleas get it done now" after the recommendation, taken as yes. Say so if not.
  - **A4.** Say `clean copies` when you want S0 done.
  - **A5.** Whether to drop the old databases S0 lists.
  - **A6.** Done 23 Nov, 07:07, on his "Please get this done": `leadfinder_e2e` is back at `0024`.
- **Levi:** S3's three answers.

## Risks

- **Too many requests at once.** Above the account's limits, Anthropic answers 429, and after 2 tries the request fails. S4 sets lane sizes, and M3 counts the retries.
- **A changed username.** The person may not know. Edit person says to tell them, and their email always works.
- **A wrong data edit.** Every edit is recorded and has Undo. HubSpot tables can't be edited here.
- **Privacy.** IP addresses and devices are personal information. Keep them 90 days and tell the team (S3).
- **Glass that's hard to read.** The contrast tests, Al-khair's look and the solid fallback.
- **A clash with PLAN-V25.** This plan starts after `merge v25`, and S2 waits for PLAN-V25's docs.
- **Removing a copy with unsaved work.** S0 removes only merged copies with no uncommitted files.

## Not in this plan

- Readable passwords.
- A second API key or workspace (only if M3 shows 429s).
- Add, edit and delete on every table, or exporting data.
- Changing a person's email: it is their sign-in and their HubSpot match. That's for a later plan.
- Access finer than PLAN-V19's role and 8 ticks.
- Tracking which pages people open.

## Log

- 22 Nov 2026: drafted from Al-khair's chat of 21 and 22 Nov: his 13 asks (Admin Panel and website refinement), his answers (reset and copy, view all and edit a few, lanes), and the recommendations he took. Nothing built yet. Not in the plan list yet: S1 adds it, so PLAN-V25's session isn't disturbed.
- 22 Nov 2026, the build starts, on Al-khair's word: "implement v26", "Implement this in seperate branch", and stop at 97 to 98% of the usage limit. Where that differs from this plan:
  - **Before `merge v25`.** "`implement v26` starts only after `merge v25`" gives way to his word. `plan-v26` is made from `master` (`ff0f658`) in `../contour-v26`. `../contour-v25` is only read, never changed.
  - **The database** `leadfinder_v26` is a copy of the dev database (at `0024`), migrated to `0027`, the newest on `master`. `leadfinder` is unchanged.
  - **The plan list** waits. His move of the list from `CLAUDE.md` to `AGENTS.md` is still uncommitted, and S1 says to ask first.
  - **S0 isn't run:** it needs `clean copies` (A4).
  - **S2 goes last, as M5:** its condition is still open (PLAN-V25's docs, and his uncommitted `AGENTS.md` and `CLAUDE.md`).
  - **No helper agents:** the session builds each step itself, in the one copy, so it can stop at the usage limit he gave.
  - **A paid slip:** while looking for the usage percentage, the session ran `claude -p "/usage"`. It went to the model on the laptop's `ANTHROPIC_API_KEY` and cost about US$0.025. Nobody had approved that. The key is blanked for every test, build and server command since, and usage is estimated from local token counters. (Corrected 23 Nov: this said "every command". 50 of 176 shell commands had it in their environment. They were reads and edits, and none could call Claude.)
- 23 Nov 2026, S1's baseline on `ff0f658`: 3,557 fast backend tests pass. One failed only because the shell had exported `API_PORT=8131`; alone, without it, it passes. 3,039 of 3,042 website tests passed; the 3 others timed out under load and pass when run again.
- 23 Nov 2026, Part 1 (`723aedf`):
  - **T1-1:** `core/work.py` says who started the work, set in three places only (the guard, the run engine, the scheduler). So no caller changed, and PLAN-V25's files are barely touched. The command line and anything nobody started are Jobs.
  - **T1-2:** "ahead" is how many requests must end first. The lead card's Research again opens the run's page, so the words show there.
  - **Lane sizes:** each field's own top is 4, like the other concurrency settings (a test ties it to `hard_concurrency`'s default).
  - **T1-3's numbers:** ruff, mypy, lint, types and build pass; 3,577 fast backend tests; 717 of 719 Companies, run, schedule and settings tests; 3,048 website tests; first visit 243 kB gzip JS and 25 kB CSS. The 2 that failed under load (a speed budget and a cancel's timing, with 275 MB of memory free) pass when run again (31 tests).
  - **Still true:** a Research again on a lead is refused while a run is going (`max_concurrent_runs` is 1). The lanes don't change that limit. For Al-khair.
- 23 Nov 2026, Part 2 (`0338f24`):
  - **T2-2:** with no username, the copied line still says `Username:`, with the email after it, as choice 7's shape has it.
  - **T2-4:** an Unlock is logged as `account_changed` with `unlocked`, because the log's kinds are a fixed list in the database (choice 10: no new table). Unlock doesn't lift the separate limit on one IP address's tries.
  - **T2-5:** the admin's IP address and device go in the entry's details, so the entry's own address stays the person's.
  - **T2-6's numbers:** ruff, mypy, lint, types and build pass; 3,580 fast backend tests; 147 People and sign-in database tests; 3,060 website tests; first visit 243 kB gzip JS and 25 kB CSS. Four older tests were updated for the new log details and route.
  - **The security check:** no blockers. Every route is the Platform admin's, no allow list changed, no new package, nothing new in the logs. One risk is by choice: with the switch off, a stolen session outlives a reset, so the switch is on by default and the log says which.
- 23 Nov 2026, Part 3 (`95dec9c`):
  - **The migration:** `0029_v26_activity` follows `0027` on this branch. **At M1, point its `down_revision` at PLAN-V25's `0028`.** It went up, down and up cleanly on `leadfinder_v26`. It also removes a saved `claude_concurrency`, and it adds `admin_edits.row_after`, a hash that lets Undo see a row changed since.
  - **Sent** is the person's calls that reached HubSpot and the pre-reads they emailed. A lead sent to HubSpot isn't there: that write doesn't save who pressed it.
  - **Run now** on a schedule saves the admin who pressed it. A start on time saves nobody.
  - **T3-5's numbers:** ruff, mypy, lint, types and build pass; 3,582 fast backend tests; 172 database tests, after one older migration test learned the new newest migration; 3,068 website tests; first visit 243 kB gzip JS and 25 kB CSS.
  - **The contract gate** (T3-5) passes run alone. Inside the whole fast suite it fails on `master` (`ff0f658`) too: two `Literal`s with the same words in another order (`high, medium, low`) share Python's cache, so the enum's order follows the test order. Not fixed here. For M1: run `tests/gates` alone.
- **23 Nov 2026, 02:15, a mistake that waits for Al-khair's OK (A6): the shared `leadfinder_e2e` was migrated.**
  - **What:** to measure Home, the session wrapped `tests.e2e.serve` to use a database of its own. The wrapper missed one default, so the migrate step ran on the shared `leadfinder_e2e` and took it from `0024` to `0029_v26_activity`. The session hadn't checked the wrapper before running it.
  - **Effect:** the fake backend in the main folder, `contour-v25` and older copies can't start, because they don't know `0029`.
  - **Not touched:** no rows were lost (the wipe step failed on the other, empty database). `leadfinder`, `leadfinder_v25` and every other database are at their own revision.
  - **The fix, not run:** from `contour-v26/engine/backend`, in PowerShell: `$env:POSTGRES_DB='leadfinder_e2e'; uv run --no-sync python -m alembic downgrade 0024_v18_teams_activity; Remove-Item Env:POSTGRES_DB`. Rehearsed on a copy (`leadfinder_e2e_v26`): back at `0024`, the same rows in every table, the same columns as the dev database.
  - **Since:** the wrapper is disabled, and Home is measured with mocked answers and no backend.
- 23 Nov 2026, Part 4 (`a5caf5f`):
  - **The list:** every table of the core, Companies and Lead Finder, each with picked columns. A new column stays off screen until someone lists it.
  - **The mask** covers phone and email columns, and emails and phone numbers inside notes and JSON. It doesn't catch an email said in words ("jo at sample dot com"), and people's names show. For S3.
  - **Search** looks in names only. (Corrected below: a detail typed into a name column could still be guessed by search or sort.)
  - **T4-4's numbers:** ruff, mypy, lint, types and build pass; 3,605 fast backend tests; 55 database tests; 3,075 website tests; first visit 244 kB gzip JS (1 kB more, the menu's new tab) and 25 kB CSS.
  - **The security check:** no blockers. Both routes are the Platform admin's and read only, table and column names come only from code, and hiding runs off the event loop.
  - **On the real-sized copy** (`leadfinder_v26`, counts only): all 35 tables read, the slowest page 182 ms (Memory, 14,768 rows), and no whole email or phone-like number left in notes. With hiding off, the same check finds one of each. (Corrected below: that check read the newest 200 rows of each table only, and the mask did fail.)
- 23 Nov 2026, Part 5 (`2baade5`), then the fixes from reading the whole diff again (`a21e08f`):
  - **The glass is a tint and a bright edge, with no blur.** Only the flat page is behind a header or a card, so a blur would show nothing and cost every frame. For Al-khair's look.
  - **Home's first frame,** built site, 1440 px, 4x CPU, median of 7, mocked answers: first paint 1,036 ms before and 1,092 ms after; heading 1,505 and 1,491 ms; longest task 198 and 186 ms. No change beyond the noise between rounds.
  - **The sidebar, measured:** 32 px and 2 px apart with a mouse; 44 px and 4 px on a phone. Folded on a touch tablet it is 36 wide by 44 tall: the 52 px rail has no room for 44 wide.
  - **T5-3's numbers:** lint, types and build pass; 3,103 website tests; first visit 244 kB gzip JS and 25 kB CSS.
  - **The design review:** fixed the Activity switch's width, the lock icon's place, the loading header's height and the folded touch rows. Text and links on the glass keep 4.5:1. No page scrolls sideways at 1440, 1280 or 390, light and dark (mocked answers). The shots are in `plan/shots/v26/`. Not tried: real data on these screens, a real phone, a screen reader.
  - **The fixes:** the mask missed a phone written with dots, or with 61 and no plus, and JSON keys. A note starting with a time showed as "Unknown".
  - **Found, older than this plan, not fixed:** resetting your own password with sign-out on signs you out at once, so the new password may leave the screen before it's copied. The switch avoids it. For Al-khair.
  - **The whole backend suite** on `a21e08f`: 5,176 passed, 28 skipped, none failed. After it, two test files gained checks (`8c49680`, their 33 tests pass).
  - **Not run:** M1's fresh `review-agent`, the `merge-check` skill, a paid run, and anything against real HubSpot or Claude. The lanes are proven with a fake Claude only.
  - **Left on this laptop:** the databases `leadfinder_v26`, `leadfinder_test_v26` and `leadfinder_e2e_v26` (the rehearsal). Nothing is running. `plan-v26` is not pushed.
  - **The session stopped here** because every step that waits on nobody is built, at an estimated 76% of the 5-hour limit and 79% of the week. The percentages come from local token counters, not from `/usage`.
- **23 Nov 2026, 07:06 to 08:00, the full checks on `ba46d8f`,** run again on Al-khair's word, and followed by a monitor so the session didn't go idle:
  - ruff, mypy, lint, types and build pass; the contract gate passes alone (3 tests); 3,632 fast backend tests; 3,113 website tests; first visit 244 kB gzip JS and 25 kB CSS.
  - 1,599 of 1,603 database tests passed. 3 failures were real: the schedule tests didn't know T3-4's new daily job. Fixed in `85875f9`, and all 72 schedule tests pass. The 4th, `test_browser.py`'s two callers at once, is the Property Daily browser, which V26 never touched. It passed 3 times out of 3 when run alone, so it fails only when the laptop is busy.
- **23 Nov 2026, 07:07, A6 done** on Al-khair's "Please get this done", which answered "Reply `rerun checks` and `fix A6`". Before: `leadfinder_e2e` at `0029`, nobody connected, and the new columns and table empty. The rehearsed downgrade then took it to `0024`. After: every table has the same rows as before, and its columns are the same as the dev database's at `0024`. `master` and `contour-v25` know `0024`, so their fake backends start again and migrate it up themselves.
- **23 Nov 2026, 03:54, "so its done right ?", and the answer was no.** A check against the code found three claims above that were wrong:
  - **The mask** let 14 of 17 common ways of writing a phone or email through, like `0412345678x12` and `jo%40northwind.com.au`. On the copy's 61,224 rows no known phone number showed. The copy holds no HubSpot contacts, so real contact emails are untested.
  - **Search and sort** could read a hidden detail typed into a name column.
  - **The key** wasn't blanked for every command, as corrected above.
- **23 Nov 2026, on his "pleas get it done now"** (`8253e76`):
  - **The mask** hides all 17. It hides when in doubt, so a meeting id or another long number in free text goes too. Passcodes in links go as well. Run again on every row: no known detail shows.
  - **Search and sort** skip any value that could hold a detail. The slowest search with a sort takes 202 ms on the copy.
  - **T4-3:** Leads (company, city, website, result, note), calls not yet sent (company, person, outcome, note, delete) and Memory (delete). A call that needed a company then waits to confirm, sorted by hand, so an edit never spends on Claude. A changed lead keeps its company key. A `lead-finder rejudge --save` would write over an edited result.
  - **T3-4:** off until Levi's OK, by the env-only `SIGN_IN_RECORDS_OK`, as `BROWSER_SPEECH_OK` works. Once on, an account older than the keep time is never shown the first sign-in prompt, because its older sign-ins are gone.
  - **Not done on that word:** the shared database's downgrade (A6), a merge, a push, a deploy, `clean copies` and any paid check. Each needs its own.
  - **Proved end to end** (a test kept outside the repo): the built website in a real browser on the real app and its test database, at 1440 and 390 px. Unlock; the username change; a reset with the switch off, then Copy sign-in details and a sign-in with what was copied; the sign-in page's line once on; all six Activity tabs and a browser signed out; all 35 Data tables; a lead's edit and Undo; a call's delete and Undo; and the three lanes in Settings. And over real HTTP, with the real Claude client, lanes and daily limit on a fake network: a prep starts while a run holds both Runs places, the 5th People request says "1 ahead", the words go once it starts, and the spending shows under the person.
  - **The checks on `8253e76`:** ruff, mypy and 3,632 fast backend tests pass. The full run then stopped at 05:24: Claude Code ended it because the laptop was low on memory (286 MB free). By then 625 of 1,603 database tests had run: 624 passed. The 1 failure, `test_browser.py`'s sign-in page test (the Property Daily browser, unchanged since the last full pass), passes when run alone. **Not run again since:** the other 978 database tests, the website's whole test run, lint over every file and the bundle report. They need a quieter laptop, and the run is restarted only on Al-khair's word.
  - **The second read** (`ba46d8f`): sign-in itself also used the first sign-in check (now the same as `/me`), a `[redacted]` key could be saved over the real text, the edits list showed ids, and one mask pattern was slow on long spaces.
  - **Overlap with PLAN-V25** (`70f6e07`): a trial merge of the committed work is clean. Both change `apps/companies/schemas.py`, `test_assistant_api.py` and the two generated contract files.
- **23 Nov 2026, M1,** on Al-khair's "please merge all of those properly in the main branch". PLAN-V25 was already on `master` (`470aa05`) and pushed.
  - **The join** (`8d173e9`): `master` merged into `plan-v26` with no conflicts. One migration head, `0029_v26_activity`, after `0027`. A fresh contract and types change nothing, and the schema map matches.
  - **The review** (a fresh `review-agent`, with the `merge-check`, `security-check` and `flow-trace` skills): Ready with notes, no blockers. Its two fixes (`a0e5086`):
    - a Data-tab company fix on a "Needs a company" call dropped PLAN-V25's call type, so a "Follow Up Call" went back to the default; it now keeps it, and the edit test checks it;
    - a Data-tab edit, delete or Undo didn't refresh Call logs and To confirm; now it does.
  - **A PLAN-V25 bug the checks found** (`9a80ae0`): the word list kept whichever spelling of a place came first ("prahran" over "Prahran"), so PLAN-V25's places test failed on this database. A capitalised spelling now wins.
  - **The checks on `9a80ae0`,** one part at a time (436 MB of memory free):
    - backend: ruff and mypy pass (475 files); 3,672 fast tests pass (25 skipped); the contract gates alone, 3 pass; 1,638 database tests pass (Companies and e2e 484, Core 750, Lead Finder 404);
    - website: lint, types, 3,190 tests and the build pass; first visit 244 kB gzip JS and 25 kB CSS, as before.
  - **Left for M4:** `engine/AGENTS.md` doesn't yet cover the three lanes, the Data tab and its edit rules, `core.admin_edits`, or `SIGN_IN_RECORDS_OK` (beside `BROWSER_SPEECH_OK`). The plan list doesn't name PLAN-V25 or PLAN-V26.
  - **For Levi (S3), from the review:** the 90-day keep time also deletes the record of which admin changed an account; `core.admin_edits` is kept for good, with the full text of a deleted call note; the public `/health` shows the keep days (empty while the switch is off).
  - **Not run:** the `design-review` skill again (last at T5-3), a browser pass, and anything paid or against real HubSpot or Claude.
  - **The main folder:** its untracked `plan/PLAN-V26.md` was the 22 Nov draft, with nothing the branch lacks. It moved out of the folder, then `master` moved to `plan-v26` by fast-forward. The dev database `leadfinder` is at `0024`, behind `master`: migrate it before the main folder's app starts.
