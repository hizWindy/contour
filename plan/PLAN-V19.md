# Improvements 2: plan, version 19

This plan builds Al-khair's Improvements 2 list of 17 Nov. Log call opens one panel that lists every company, with the search on top. The pre-read goes to teammates you pick from the HubSpot team: each one gets a HubSpot task, and a tick also emails them. You can send it to more people later, and the Meetings list says who got it and when. People get four roles, an optional position, a simple starting password made for them, and on/off ticks for each part of a module. Every small tab strip slides like the sidebar, and a subtle glass look goes on the parts that float over the page. One session builds it, in three parts, one after another.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair, for the code, the roles and every screen.
- **Last updated:** 17 Nov 2026 (one session instead of three tracks; nothing built).
- **Progress:** S0: 1 of 1. Part 1: 0 of 9. Part 2: 0 of 6. Part 3: 0 of 7. Merge and deploy: 0 of 3.
- **Sources:**
  - Al-khair's Improvements 2 list (17 Nov, in chat) and his answers the same day;
  - the code on `master` (`0c9b68f`), read on 17 Nov;
  - [engine/DESIGN.md](../engine/DESIGN.md) and `design/principles/`;
  - [PLAN-V17.md](PLAN-V17.md) (the pre-read and its send), PLAN-V9 E1 (the People tab), PLAN-V6 C4 (changing your own password).
- **Comes after:** Improvements 1 (on `master` at `0c9b68f`, pushed 17 Nov, not deployed) and PLAN-V18 (joined, not deployed). PLAN-V6 C4 moves here, as T1-6.

## Go signals

Say the line in the session. The same line starts the work, and continues it later from the first step that isn't ticked. Saying `implement v19` counts as Al-khair's word for S0.

| Say | What it does |
|---|---|
| `implement v19` | Builds Part 1 (the backend), then Part 2 (Log call and the pre-read), then Part 3 (people, access, motion and glass) |
| `merge v19` | Checks everything, then moves `master` to `plan-v19` |
| `deploy v19` | Pushes `master`, deploys, and checks it live |

You'll also answer things along the way:
- **T1-2 writes to the real HubSpot once.** It makes one test task for you, to see whether HubSpot alerts you, then deletes it. It is free, but it is a HubSpot write, so it runs only on your own word in chat.
- **Each screen waits for your look.** The session marks it "built, waiting for a look" and carries on.
- **The "Questions for you" and "Choices made for you"** stand as written unless you change them before that step starts.
- **Nothing paid.** This plan makes no Claude request.

## Questions for you

Each has a default that the build uses until you answer.

1. **The "Edit rules" tick.** No screen or route edits the Lead Finder rules today: the Rules page is read only. Default: the tick is called "Rules" and lets a person see the Rules page. It will also guard editing, once editing exists.
2. **What Staff and Viewer start with.** Default: Staff gets every tick except Rules. Viewer gets See results, Companies, Call logs and Meetings, to look only. You change any person's ticks after.
3. **When the pre-read task is due.** Default: the working day before the meeting, or today if the meeting is sooner.
4. **Where a position shows.** Default: on the People list and under the name in the profile menu. Not in emails.
5. **Only one Platform admin.** Default: yes, you. Handing it on is a server command (`engine set-platform-admin`), not a button.

## In short

| You asked | What we build | Steps |
|---|---|---|
| Log call shows every company, with the search on top | Log call opens a panel from the right: the search on top, every company below, newest activity first. Pick one, and the note slides in, in the same panel. | T2-2 |
| Send the pre-read to the people I pick, in HubSpot by default, with an email tick | The send dialog lists your HubSpot team. Each person picked gets a HubSpot task with the pre-read. "Also email them" sends the email too. | T1-2, T1-7, T1-8, T2-3 |
| After it's sent: a Sent mark, and send to more later | The list already says "Sent". It now says who got it and when. "Send to more people" reaches only the new ones. | T1-8, T2-4 |
| Roles: Platform admin, Admin, Staff, Viewer | Four roles. Only the Platform admin opens Admin settings. An Admin uses every module. | T1-3, T3-2 |
| A position, and a simple password made for each new person | An optional position. The server makes a three word password, shown once with Copy. Each person can change their own. | T1-5, T1-6, T3-3 |
| Choose what each person can use inside a module | Eight ticks, four a module. The role sets the starting ticks, and you change them per person. The server checks each one. | T1-4, T3-4 |
| The sidebar's smooth slide on every small tab strip | The six plain switches left become the sliding `Segmented`, 44px tall on a touch screen | T3-5 |
| A subtle glass look | A light blur on the layers that float over the page. Cards, tables and text stay solid. | T3-6 |

**What stays the same:**
- Nothing reaches HubSpot without a person's click on a preview. The send dialog is that preview.
- The pre-read email goes to Contour addresses only.
- Our copy of HubSpot keeps no owner's email. So the email tick reaches only people with a Contour account.
- One connection to HubSpot (`core/hubspot/`). No project calls HubSpot itself.
- The spending limits stay with you, now as the Platform admin.

**What it costs:**
- **To build:** time only.
- **To run:** nothing new. A pre-read task is one free HubSpot request a person (**TBC**: T1-8 counts them).

## Words used here

- **Platform admin:** the one person who runs Contour's accounts and settings. Al-khair.
- **Admin settings:** the Admin page and its nine tabs: Health, Runs, Schedules, Searches, Memory, HubSpot, Sources, People and Settings (which holds the spending limits).
- **Tick:** an on/off for one part of a module, like "Start a run". The code calls it a feature.
- **Team list:** the active HubSpot owners in our copy of HubSpot, by name only. A HubSpot owner is a HubSpot user who can own records.
- **Pre-read task:** the HubSpot task Contour makes for each person a pre-read is sent to.
- **Glass:** a see-through layer with a light blur, like the menus on an iPhone.

## What exists already (so nothing is built twice)

| Need | Already there | This plan adds |
|---|---|---|
| Log call | `call-logs/log-call.tsx`: `LogCallPicker` is a 320px popover with `CompanySearch`, which lists nothing until you type 2 letters. Then `LogCallSheet` opens `NoteView` in a 576px panel. Ctrl+K's "Log a call" opens it with `?log=1`. | One panel, with the list first |
| The company list | `GET /companies`: `q`, `limit` up to 100 and `offset`, 50 a page, newest activity first since V18. `GET /companies/search` for the picker. | Nothing. The panel reads them. |
| Sending the pre-read | `meeting_send.py`: Contour addresses only (`only_internal`). The Contour people on the meeting come ticked. A sent pre-read emails nobody again, and each send replaces `sent_to`. The copy goes as a note on the company in HubSpot. `pre-read/send-dialog.tsx` on the website. | The team list, a task each, the email tick, and send to more |
| HubSpot tasks | `TaskIn` (`core/hubspot/activities.py:243`) already takes an `owner_id`: "Who it is for". The key could write tasks on 15 Nov (`check.py`, `ACTIVITY_WRITE_KINDS`). | The pre-read task |
| The team | `hubspot_owners`: names only, never an email. `GET /hubspot/owners` is for Admins only. `users.hubspot_owner_id` links an account to an owner. | A team list for anyone with the Meetings tick |
| A sent pre-read | `MeetingFormState.status` is `sent`, and the row says "Sent" (`meetings/words.ts:80`). `pre-read/sent.tsx` says who got it and when, on the pre-read page. | Who and when on the row |
| Roles | `admin`, `staff`, `viewer` (`core/auth/models.py:43`, check `ck_users_role`). `AdminDep` (`core/api/signin.py:131`) guards People, the sign-in log, health details, sources, schedule edits and HubSpot writes. Staff and Viewer are treated the same: no route checks either. | Four roles, and Viewer looks only |
| Access | `users.apps`, checked per project by `require_app` (`core/api/access.py:65`) on each project's router, and `AppAccessDep` on runs, searches and memory. | Eight ticks |
| The People tab | `apps/lead-finder/admin/people.tsx`: `AddPerson` (the Admin types a starting password), `EditPerson` (role, project ticks, HubSpot owner, "Can sign in"). Hooks in `api/hooks/review.ts:80`. Role words in `shell/roles.ts` ("System admin"). | Four roles, position, a made password, reset, and the ticks |
| Passwords | `core/auth/passwords.py`: 14 characters at least, and "Three or four words in a row work well". Nothing makes a password. A forgotten one is reset with `engine reset-password`. | A made password, Reset password, and change your own |
| Smooth switches | `Segmented`, `TabIndicator` (in `ui/tabs.tsx` too) and `GlassMenu`. Six switches still use a plain `ToggleGroup`. `Segmented` is 40px on a touch screen, under the 44px rule. | `Segmented` in all six, 44px |
| Glass | The `--glass-*` tokens (`styles/tokens.css:145`), used only by the menu's pane. DESIGN.md allows no blur. | Glass on the floating layers |

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts.

**Roles and access:**
1. **Four roles.**
   - **Platform admin:** everything. The only one who opens Admin settings and changes the spending limits. Exactly one person.
   - **Admin:** every module and every tick. No Admin settings. Keeps what an admin does inside Relationships today: reads the team's call notes, and decides on team script notes and the team tone.
   - **Staff:** the ticks they are given.
   - **Viewer:** looks only. Can't start, log, send or change anything, whatever the ticks.
2. **Eight ticks.** Lead Finder: Start a run, See results, Rules, Send to HubSpot. Relationships: Companies, Call logs, Meetings, Call prep. A module shows in the menu when a person has at least one of its ticks.
3. **Nobody loses anything on deploy.** Today's Lead Finder tick becomes its four ticks, and the same for Relationships. The oldest admin account (Al-khair's, **TBC**: T1-3 checks) becomes the Platform admin. Any other admin stays an Admin. `apps` stays, filled from the ticks, so going back to the old build still works.
4. **The server is the guard.** Each route checks its tick and answers 403 in plain words. The website also hides what a person can't use, so they rarely meet the 403.
5. **Spending limits and settings switches** become Platform admin only (`core/api/settings.py` has no check today). The Companies page's "Sync with HubSpot" stays open to anyone with the Companies tick.

**People:**

6. **Position:** optional text, up to 80 characters, like "Sales Director".
7. **The made password:** three common words and two digits, like `maple-harbor-river-47`. The words come from a list of about 2,000 short English words in the code. The server makes it again until it passes today's rules. It shows once, with Copy, and is never logged or kept in plain text. The People tab gets "Reset password", which makes a new one and signs that person out.
8. **Change your own password** sits in the profile menu: the current password, then the new one. It signs out your other devices. The person's first sign-in shows one quiet line suggesting it. Nothing forces it.

**The pre-read:**

9. **The team list** is the active HubSpot owners, by name, with "You" on yours. The Contour people on the meeting come ticked, as today. "Add someone" by email stays, for a Contour address not in HubSpot.
10. **A HubSpot task for each person picked** who is a HubSpot owner. Subject: "Pre-read: {meeting} with {company}, {day}". Body: the pre-read in plain text, cut to fit with a link to Contour. Due the working day before the meeting (question 3). Linked to the company, and to its deal when it has exactly one open deal.
11. **"Also email them"** is one tick for the whole send, off by default. With it on, each person picked who has a Contour account also gets the email.
    - Someone added by email, with no HubSpot owner, gets the email whatever the tick says. It is the only way to reach them.
    - A HubSpot owner with no Contour account gets the task only.
12. **The note on the company** in HubSpot stays as today.
13. **Send to more people.** On a sent pre-read, "Send to more people" opens the same dialog. The people who got it show greyed, with "Got it 17 Nov". Only the new ones get a task or an email. `sent_to` keeps everyone, each with the day and how they got it.
14. **The row says who and when:** "Sent to Jo Sample and 2 more, 17 Nov".

**Log call:**

15. **Log call opens the panel at once,** 576px wide from the right, and the whole screen on a phone.
    - The search sits on top and takes the focus.
    - The list below shows the Companies page's order (newest activity first), 50 at a time, with more as you scroll.
    - From 2 letters, the list shows the matches, as today's picker does (250ms after the last key).
    - The arrow keys and Enter pick a company.
    - The note slides in, with a back arrow to the list, and the search is kept.
    - Ctrl+K's "Log a call" opens the same panel. New pre-read keeps its small picker.

**Motion and glass:**

16. **The six plain switches become `Segmented`:** `companies/filter-bar.tsx`, `lead-finder/reject-reasons.tsx`, `lead-finder/results/index.tsx`, `lead-finder/start/discovery.tsx`, `lead-finder/start/index.tsx` (two) and `lead-finder/start/tenure.tsx`. `Segmented` grows to 44px on a touch screen.
17. **Glass on the floating layers only:**
    - the top bar, only while the page scrolls under it;
    - popovers, dropdown menus, select lists and Ctrl+K;
    - the header of a side panel;
    - the dim behind a dialog gets a light blur.
    - The look: about 72% fill, a 16px blur, and the rim from `--glass-rim` (**TBC** after the look).
    - Cards, tables, forms and text stay solid, so they stay easy to read.
    - With "reduce transparency" on, or no blur support, each layer is solid.
    - Your "subtle glass" ask also counts as the OK the menu's glass was waiting for. Its **TBC** in DESIGN.md goes.

## How it should look and move

Read DESIGN.md "Motion" and PLAN-V18 "How it should look and move" first. These add to them.

- **The Log call panel** slides in over 400ms (`smooth`). The list to the note is a `PushView`: the note comes in from the right, the list leaves to the left, and Back reverses it.
- **Each switch's pill** slides as the sidebar's does (`layoutId`, so only `transform` and `opacity` move). With reduced motion it simply moves.
- **A glass layer** fades in with its layer and out in 150ms. Its blur never animates.
- **The made password** appears in place, with no slide. Copy turns into "Copied" for 2 seconds.
- **The check:** each screen at 1440px and 390px, light and dark, and the slides at 4x CPU slowdown with no dropped frames. The top bar's blur while scrolling is part of that check.

## Words for when things go wrong

The server's words show as they come. Each line gets a test.

- **No tick:** "You don't have access to Call logs. Ask Al-khair to turn it on." The name is the Platform admin's, read from the accounts.
- **A Viewer tries to change something:** "Viewers can look but not change things. Ask Al-khair if you need more."
- **Admin settings without the role:** "Only the Platform admin can open Admin settings."
- **A task didn't go:** "Jo Sample's HubSpot task didn't go. The email still went." Try again tries the task only.
- **HubSpot isn't connected:** "HubSpot isn't connected, so no tasks can go. Tick 'Also email them' to send it by email."
- **The team list didn't load:** "The team list didn't load. Add people by email, or try again."
- **The wrong current password:** "That isn't your current password."

## Who builds it

One session builds every step, in order. Any coding tool can follow this plan: Claude Code, Gemini or another.

- **Read first:** `engine/AGENTS.md` (the commands, the folder map and the coding practices), and `engine/DESIGN.md` for screens.
- **The how-to files** in `.claude/skills/` are plain Markdown, so any tool can read them:
  - a route: `api-change/SKILL.md`; the migration: `db-migration/SKILL.md`;
  - a screen: `ui-build/SKILL.md`, then `design-review/SKILL.md` and `speed-check/SKILL.md` before a part's check;
  - commits: `git-workflow/SKILL.md`; T1-3 to T1-8: `security-check/SKILL.md`.
- **The independent check** at M1 comes from a session that didn't build it, like Claude Code's `review-agent` with `merge-check`. It changes nothing.
- **Merging, pushing, deploying and any HubSpot write** stay with Al-khair's own word in chat.

## How to work this plan

**The order.** Part 1 first, because the website's types come from it. Then Part 2, then Part 3.

- **Types:** T2-1 makes the contract file and the website's types from Part 1. Never edit `engine/frontend/openapi.json` or `src/api/schema.d.ts` by hand.
- **One migration:** `0025_v19_roles_access`, after `0024_v18_teams_activity`.
- **Route lists:** `tests/core/test_contract_routes.py` lists every route. Part 1 adds lines, and a new test fails any route with no tick or role check (T1-4).
- **New packages:** none in the backend or the website. The word list is a plain file in the backend.
- **Change only what a step needs.** No tidying of other files on the way. `engine/AGENTS.md`, `CLAUDE.md` and `.claude/` change at M3 only.
- **The contract (below) is fixed.** If it looks wrong, stop and tell Al-khair.

**The branch and the copy.**
- One branch, `plan-v19`, made from `master`, in its own copy: `git worktree add ../contour-v19 -b plan-v19 master` (see S0). The main folder stays on `master`.
- In the new copy: run `npm ci` in `engine/frontend` once.

**The port and the database.**
- Backend `API_PORT=8071`. Website on port 5241, with its proxy to 8071. Database `leadfinder_v19`. Test database suffix `LEADFINDER_TEST_DB_SUFFIX=_v19`.
- Make the database once, as a copy of the dev database at migration `0024`.
- The copy's `engine/.env` holds the `POSTGRES_*` lines only. Never put `API_PORT` or `CORS_ORIGINS` in it.
- **Keys:** the backend starts with **no Claude key** and **no HubSpot key**. A Windows user setting can still hand it `ANTHROPIC_API_KEY` (PLAN-V18 M1 Log), so remove it in the start command. Only T1-2 loads the HubSpot key, into the process only. Never print it.
- **Sign in on:** roles and ticks only show with sign in on. T3-1 makes made-up accounts, one of each role.
- Leave ports 8000 and 5173 alone, and those of older plans (8041 to 8064, 5211 to 5234).

**Every session.**
- **At the start:** read this section, "What exists already" and "Choices made for you". Go to `../contour-v19`, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks. The laptop is short of memory.
- **Windows Application Control** blocks a new copy's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `uv run python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each. Follow `.claude/skills/git-workflow/SKILL.md`.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the part's Progress count and add a line to its Log.
- **Screens:** follow `engine/DESIGN.md` and "How it should look and move". Screenshots go in `plan/shots/v19/` (git ignored).
- **No real client data in git:** tests and fixtures use made-up companies and people, like "Sample Logistics Pty Ltd" and "Jo Sample". No real password in any file, log or screenshot.
- **When usage runs low** (80% of the 5 hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the build starts

- [x] **S0. The base branch.** (17 Nov 2026)
  - Make `plan-v19` from `master` in the worktree `../contour-v19`. Don't switch the main folder's branch. *(Note: `../contour-v19` / `plan-v19` was already in use by another active session, so built in isolated worktree `../contour-v19-imp2` on branch `plan-v19-imp2`, DB `leadfinder_v19_imp2`, ports `8072`/`5242`.)*
  - Its first commit holds this plan and the `CLAUDE.md` go signals.
  - In `plan/PLAN-V6.md`, add one line under C4: "Moved to PLAN-V19 (T1-6)."
  - **Done when:** `git branch --list plan-v19` shows it, it holds `plan/PLAN-V19.md`, and the backend tests pass on it.

## The contract

### 1. Who I am (Part 1 builds, Part 3 reads)

`GET /api/v1/auth/me` adds:
- `role`: `platform_admin`, `admin`, `staff` or `viewer`.
- `features`: the ticks this person has, like `["lead_finder.results", "companies.call_logs"]`. A Platform admin and an Admin get all eight.
- `position`: text or null.
- `platform_admin_name`: the Platform admin's name, for the "Ask Al-khair" words.

`apps` stays, filled from `features`.

The eight ticks: `lead_finder.start_run`, `lead_finder.results`, `lead_finder.rules`, `lead_finder.send_to_hubspot`, `companies.companies`, `companies.call_logs`, `companies.meetings`, `companies.call_prep`.

### 2. People (Part 1 builds, Part 3 reads)

All Platform admin only.
- `GET /people`: each row adds `position` and `features`.
- `POST /people`: `name`, `email`, `role` (not `platform_admin`), `position` (optional), `features` (optional: left out, the role's starting ticks). No password. The answer adds `starting_password`, in this answer only.
- `PATCH /people/{id}`: also `position` and `features`.
- `POST /people/{id}/password`: makes a new password and signs that person out. It answers `{ "starting_password": "..." }`, once.
- `POST /auth/password` (anyone signed in): `current` and `new`. 204, or 422 `wrong_password`, or the password rules' 422.

### 3. The team and the send (Part 1 builds, Part 2 reads)

Under `/api/v1/companies`, behind the Meetings tick.
- `GET /team`: `[{ owner_id, name, has_account, is_me }]`, by name. Never an email.
- The send preview (`POST /meetings/forms/{form_id}/preview`, as today) takes `owner_ids`, `emails` (added addresses) and `email_them`. For each person it answers `name`, `task` (true or false), `email` (true or false), `why` (in the server's words) and `already` (the day they got it, or null).
- The send (`POST /meetings/forms/{form_id}/send`, as today) takes the same three. On a sent pre-read, only people not in `sent_to` get anything.
- `sent_to` rows add `owner_id`, `at`, `task` (`sent`, `waiting`, `failed` or `none`) and `email` (true or false).
- `MeetingFormState` (the list row) adds `sent_at`, `sent_count` and `sent_names` (up to two names).
- `POST /meetings/forms/{form_id}/tasks/retry`: tries the failed tasks again, with no email.

### 4. Words

New error codes, each with a title and a detail in the server's words: `feature_not_allowed`, `viewer_read_only`, `platform_admin_only`, `wrong_password`, `task_failed`, `team_unavailable`.

## Part 1: the backend

Read first: `.claude/skills/api-change/SKILL.md` and `.claude/skills/db-migration/SKILL.md`.

- [ ] **T1-1. A baseline.** Make the database. Run the backend tests, and the website's lint, types, tests and build, once. Note the counts and the first visit size from `node scripts/bundle-report.js`.

- [ ] **T1-2. Does HubSpot alert on a task?** On Al-khair's word in chat only: it writes to the real HubSpot.
  - Make one task assigned to Al-khair's HubSpot owner, due today, subject "Contour test: please ignore". Through `core/hubspot/` and the activity writer, as a real send would.
  - Al-khair says whether HubSpot alerted him (the bell, an email, or neither). Then delete the task.
  - **Done when:** the Log says what alerted him. If nothing did, Al-khair decides before T2-3's look whether tasks stay the default.

- [ ] **T1-3. Four roles** (the contract, part 1).
  - Migration `0025`: `platform_admin` joins `ck_users_role`. At most one Platform admin (a partial unique index). The oldest active admin becomes it.
  - A role ladder in one place, and `PlatformAdminDep`. Every route that serves Admin settings uses it, and so does any change to spending limits and settings switches (`core/api/settings.py`).
  - `AdminDep` keeps its other uses for Admins and the Platform admin: reading the team's call notes, and team script notes and tone.
  - The CLI: `engine set-platform-admin <email>`. Nobody can change their own role, and nobody can make a second Platform admin through the API.
  - Sign in off still opens everything, as today.
  - **Done when:** tests show each role at each guarded route, the migration runs both ways on a copy, and the dev database's Platform admin is named in the Log.

- [ ] **T1-4. Eight ticks** (the contract, part 1).
  - Migration `0025` adds `users.features` and fills it from `apps` (choice 3).
  - `need(feature)` on each route group. Lead Finder: Start a run is `POST /runs`, `/runs/estimate`, `GET /run-options`, recheck and `POST /research`. See results is `api_leads.py`, the review reads and `runs_read.py`. Rules is `GET /rules`. Send to HubSpot is `api_hubspot.py` and review send. Relationships: Companies is `api.py`'s list, facets and one company. Call logs is `api_notes.py`. Meetings is `api_meetings.py` and `/team`. Call prep is `api_preps.py`, `/search` and `api_script.py`.
  - The test set and the round's schedule (`api_round.py` PUT) are Admin settings, so they are Platform admin only. The watchlist goes with See results (**TBC**).
  - HubSpot (`core/api/hubspot.py`): `POST /sync`, its status and cancel need the Companies tick, for "Sync with HubSpot" on Companies. `/import`, `/profiles/rebuild`, `/writes` and `/owners` are Platform admin only. Today most of these have no check at all.
  - A Viewer gets 403 `viewer_read_only` on every change. Their own password, sign out and their own display settings still work.
  - A new test lists every route with its tick or role, so a new route with neither fails.
  - **Done when:** the route test passes, and a Staff account with only Call logs gets 403 on Meetings and 200 on call notes.

- [ ] **T1-5. Position and the made password** (the contract, part 2).
  - `users.position` (up to 80 characters) in migration `0025`.
  - The word list (about 2,000 short common words, **TBC**: the source and its licence go in the Log) and the maker: three words and two digits, made again until `check_rules` passes.
  - `POST /people` without a password, and `POST /people/{id}/password`. The password is in the answer only: never in a log, the audit entry or an error.
  - **Done when:** 1,000 made passwords all pass the rules, and a test shows none in the logs.

- [ ] **T1-6. Change your own password** (PLAN-V6 C4; the contract, part 2).
  - `POST /auth/password` checks the current password, counts a wrong one toward the lock (as sign in does), checks the rules, and signs out the person's other sessions.
  - **Done when:** tests cover a wrong current password, a refused new one, and the other sessions ending.

- [ ] **T1-7. The team list** (the contract, part 3). `GET /companies/team` from `hubspot_owners` and the accounts' links.
  - **Done when:** it answers with names only, and a test checks that no email is in it.

- [ ] **T1-8. Send with tasks, the email tick, and send to more** (the contract, part 3).
  - The preview and the send take `owner_ids`, `emails` and `email_them`. Owners become accounts' addresses through `users.hubspot_owner_id`. Every address still goes through `only_internal`.
  - One task a person, through the activity writer (`TaskIn` with `owner_id`). Choices 10 and 11.
  - Each person's task and email is saved in `sent_to`. A failed task doesn't stop the others or the email.
  - A sent pre-read takes a send again: only the new people get anything. The email's key holds the new addresses, so a retry can't send it twice.
  - The list row's `sent_at`, `sent_count` and `sent_names`. Count the HubSpot requests a send makes.
  - **Done when:** tests cover the task only, the email only, both, a failed task, its retry, a second send to new people, and a second press while it sends (409, as today).

- [ ] **T1-9. Words, and the Part 1 check.**
  - The error codes in the contract, part 4.
  - `uv run engine openapi`, to check the contract builds.
  - Go through `.claude/skills/security-check/SKILL.md` for T1-3 to T1-8, and fix what it finds.
  - **Done when:** every backend test passes, and the security pass has nothing open.

### Part 1 Log

- (none yet)

## Part 2: Log call and the pre-read

Read first: `.claude/skills/ui-build/SKILL.md` and `engine/DESIGN.md`.

- [ ] **T2-1. The website's types.** Run `uv run engine openapi` and `npm run types`, so the website gets Part 1's contract.
  - **Done when:** `src/api/contract.test.ts` passes.

- [ ] **T2-2. Log call: one panel with every company** (choice 15).
  - In `call-logs/log-call.tsx`, the popover goes. A new `call-logs/company-list.tsx` reads `GET /companies` page by page and `GET /companies/search` from 2 letters.
  - `NoteView` gets a back arrow when it is opened from the list.
  - Hidden for a Viewer.
  - **Done when:** Log call opens the panel with the search focused and the newest companies listed; 2 letters filter; the arrow keys and Enter pick; Back returns to the list with the search kept; Esc closes; it is the whole screen at 390px; Ctrl+K's "Log a call" opens it. Screenshots at 1440px and 390px, light and dark. No dropped frames at 4x CPU. Built, waiting for a look.

- [ ] **T2-3. The send dialog: the team, tasks and the email tick** (choices 9 to 11).
  - The people come from `GET /companies/team`, the meeting's Contour people ticked. "Add someone" stays.
  - Each row says what that person gets: "HubSpot task", "Email" or both, in the server's words.
  - The "Also email them" tick, off. The button counts the people: "Send to 3 people".
  - The preview shows the task's subject and due day, and the email.
  - **Done when:** tests cover each kind of person in choice 11, and the screens at 1440px and 390px. Built, waiting for a look.

- [ ] **T2-4. Who got it, and send to more** (choices 13 and 14).
  - The Meetings row: "Sent to Jo Sample and 2 more, 17 Nov".
  - The pre-read page: each person, with their task and email, and Try again for a failed task.
  - "Send to more people" opens the dialog, with those who got it greyed and "Got it 17 Nov".
  - **Done when:** tests cover a second send to new people only, and a task retry. Built, waiting for a look.

- [ ] **T2-5. Errors on these screens.** The lines in "Words for when things go wrong" that touch Log call, the team list and the send, each with a test.

- [ ] **T2-6. Part 2 check.** Lint, types, every test, the build and the first visit size (within 1,024 B of T1-1, **TBC** if the list needs more). Go through `.claude/skills/design-review/SKILL.md` for Part 2's screens.
  - **Done when:** each passes, and the design pass has nothing open.

### Part 2 Log

- (none yet)

## Part 3: people, access, motion and glass

Read first: `.claude/skills/ui-build/SKILL.md` and `engine/DESIGN.md`.

- [ ] **T3-1. Test accounts.** Turn sign in on for the copy's backend. Make made-up accounts in `leadfinder_v19`: one of each role, and a Staff with only Call logs.
  - **Done when:** each can sign in, and the Log names them (never their passwords).

- [ ] **T3-2. Four roles, and Admin settings for the Platform admin** (choice 1).
  - `shell/roles.ts`: "Platform admin", "Admin", "Staff", "Viewer".
  - The Admin settings link shows for the Platform admin only. A direct link shows "Only the Platform admin can open Admin settings."
  - The People tab's role choice offers Admin, Staff and Viewer.
  - **Done when:** tests sign in as each role and check the menu, Ctrl+K and a direct link. Built, waiting for a look.

- [ ] **T3-3. Adding a person, and passwords** (choices 6 to 8).
  - `AddPerson`: Name, Email, Position (optional), Role, then the ticks. No password field.
  - After Add, the made password shows once, with Copy and a line: "Send this to Jo yourself. It won't show again."
  - "Reset password" on each person, behind a real confirmation.
  - "Change password" in the profile menu, and the one quiet line at a first sign-in.
  - The position on the People list and in the profile menu.
  - **Done when:** tests cover Add, Copy, Reset and Change password, and no password stays in the page once the sheet closes. Built, waiting for a look.

- [ ] **T3-4. The ticks, and hiding what a person can't use** (choices 2 to 4).
  - `EditPerson` and `AddPerson`: the eight ticks in two groups. Picking a role fills its starting ticks. Admin shows every tick on, greyed.
  - `src/auth/can.ts`: `can(feature)`, read from `/auth/me`.
  - Hidden without the tick: the module in the menu, Home and Ctrl+K; the Start, Results and Rules pages; Send to HubSpot on a lead; Prep call. A direct link to a page without the tick shows "You don't have access to {page}. Ask {name} to turn it on."
  - Hidden for a Viewer: every button that changes something, beyond the ones Part 2 hid.
  - **Done when:** tests sign in as a Staff with only Call logs, and as a Viewer, and check each place above. Built, waiting for a look.

- [ ] **T3-5. Every small switch slides** (choice 16). The six switches become `Segmented`, and `Segmented` is 44px on a touch screen.
  - **Done when:** no `ToggleGroup type="single"` is left in `apps/`, each switch keeps its keyboard keys, and the tests pass. Built, waiting for a look.

- [ ] **T3-6. Subtle glass** (choice 17).
  - New `--glass-*` lines in `styles/tokens.css`, and the glass on the layers in choice 17, in `components/ui/` and `shell/top-bar.tsx`.
  - DESIGN.md: "Glass" says where it is allowed and where it isn't. The menu's **TBC** goes.
  - **Done when:** screenshots at 1440px and 390px, light and dark; reduce transparency shows solid layers; scrolling under the top bar and opening Ctrl+K drop no frames at 4x CPU. Built, waiting for a look.

- [ ] **T3-7. Part 3 check.** Lint, types, every test, the build and the first visit size. Go through `.claude/skills/design-review/SKILL.md` and `.claude/skills/security-check/SKILL.md` (the password on screen).
  - **Done when:** each passes, and both passes have nothing open.

### Part 3 Log

- (none yet)

## Merge and deploy

- [ ] **M1. Check, then move `master`** (`merge v19`, on Al-khair's word).
  - A fresh review from a session that didn't build it (in Claude Code: `review-agent` with `merge-check`). It must say Ready.
  - Run every test and build on `plan-v19`, then a browser pass with sign in on, as each role.
  - Then move `master`: a backup branch `backup/master-before-v19` first, then `git merge --ff-only plan-v19` in the main folder. If it won't fast-forward, stop and ask.
  - **Done when:** every test and build passes on `plan-v19`, and `master` has moved to it.

- [ ] **M2. Deploy and check live** (`deploy v19`, on Al-khair's word).
  - Push, deploy, and watch the log. Migration `0025` runs on deploy.
  - Check live:
    - Al-khair is the Platform admin and opens Admin settings.
    - Every other account keeps what it could use before.
    - Log call opens the panel with the companies listed.
    - One pre-read sent to Al-khair only makes his HubSpot task (a HubSpot write: on his word).
    - The glass shows, and `/sw.js` and `/manifest.webmanifest` answer 200 (from Improvements 1).
  - **Done when:** each check above is in the Log.

- [ ] **M3. Docs.**
  - `engine/AGENTS.md`: the roles, the ticks and `need(feature)`, the made password, and the pre-read task.
  - `CLAUDE.md`: this plan's open steps.
  - A short note for the team on what changed, written with `/plain`, sent on Al-khair's word.
  - **Done when:** the docs name the four roles, and the note is sent or skipped on Al-khair's word.

## Waiting on

- **Al-khair:**
  - the answers to "Questions for you";
  - his word for T1-2 (one test task in HubSpot), and what alerted him;
  - a look at each screen, with sign in on;
  - `merge v19` and `deploy v19`.
- **Levi:** nothing in this plan needs his OK. He may want to know that each pre-read now adds HubSpot tasks.

## Risks

- **Locking yourself out.** A wrong migration could leave no Platform admin. T1-3 tests it both ways, and `engine set-platform-admin` on the server is the way back.
- **A route left unguarded.** T1-4's route test fails any route with no tick or role.
- **HubSpot may not alert on a task made through the API.** T1-2 checks before the screens are built on it. The task still shows in the person's HubSpot task list.
- **More tasks in HubSpot.** One a person a pre-read. Sending again to the same person makes none.
- **Glass can slow phones.** The blur is only on small floating layers, the top bar blurs only while scrolled, and each is checked at 4x CPU.
- **A three word password is easier to guess than a long random one.** It is shown once, sign in locks after failed tries (as today), and each person can change it.

## Not in this plan

- New pre-read keeps its small company picker.
- Ticks inside Admin settings: it is the Platform admin's alone.
- More than one Platform admin, and sign in with Microsoft or Google.
- A screen that edits the Lead Finder rules (question 1).
- Companies takes 0.3 to 1.2 s to open at 4x CPU (from Improvements 1). It needs its own speed task.
- A view of the team's call logs for Staff (it waits for Levi, from PLAN-V18).

## Log

- 17 Nov 2026: plan written from Al-khair's Improvements 2 list and his answers: an Admin uses every module but not Admin settings; the eight ticks; after a send, who got it on the list and send to more; a HubSpot task as the alert. Nothing built.
- 17 Nov 2026: Al-khair chose one session instead of three tracks, to build it with Gemini. The tracks became Parts 1 to 3, built in order, and the steps name plain how-to files instead of Claude's agents. The steps and choices are unchanged.
- 17 Nov 2026 (S0): Created isolated worktree `../contour-v19-imp2` on branch `plan-v19-imp2` from `master` (`0c9b68f`) because `../contour-v19` (`plan-v19`) was already active on a separate issue. Fast backend suite passed (`3442 passed, 28 skipped`, `-m "not integration"`).
