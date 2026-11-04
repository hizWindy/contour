# HubSpot plan, version 5: one HubSpot connection for every project

This plan connects the platform to HubSpot with the service key. It builds one shared connection in the core that reads HubSpot now and writes to it once write access arrives. The Lead Finder is the first project to use it.

- **Built by:** Al-khair Pama. **Signed off by:** Levi Young.
- **Last updated:** 2026-11-04. **TBC** means not confirmed yet.
- **Progress:** 15 of 20 steps done. Work goes on branch `plan-v5`.
- **Comes after:** [PLAN-V4.md](PLAN-V4.md), merged into `master` on 3 Nov (87dfca8). Its open steps (A1, B5, D1, D2 and the docs in D3) stay in PLAN-V4 and don't block this plan. This plan builds PLAN-V1's Phase 5, "Send to HubSpot".

## In short

- **Goal:** one HubSpot connection for the whole platform. It lives in the shared core, not inside the Lead Finder. Every project uses it: the Lead Finder now, and Call notes, Meeting prep and Deal review later. No project needs its own key, retry code or log.
- **Read now, write later:** the key can read today. Write access is expected on 4 Nov (**TBC**). We build reading first and use it (Parts B to D). We build writing too, test it on a fake HubSpot and keep it switched off. Part F switches it on after one live check.
- **What Levi gets:** the Lead Finder uses live HubSpot data instead of the 25 Oct export: the watchlist, the "already in HubSpot" check and the deal labels. Each lead card gets a "Send to HubSpot" button that adds or updates the company after a preview.
- **Order:** get ready (A), the shared connection (B), shared website parts (C), the Lead Finder on live HubSpot (D), check and merge (E), switch on writing (F).
- **Cost:** no Claude money. HubSpot API calls are free within Contour's plan limits (**TBC**).

## Words used here

- **Service key:** a secret key from HubSpot. It lets our backend read and write HubSpot data with nobody logged in. It belongs to the account, not to one user. HubSpot made it a public beta on 10 Feb 2026.
- **Scope:** one permission on the key, like `crm.objects.companies.read` (read companies).
- **Sync:** copying HubSpot records into our database. Pages and runs then read our copy, which is fast and still works when HubSpot is down.
- **Fake HubSpot:** a stand-in that tests use, like the fake Claude. It costs nothing and touches no real data.

## What we know about service keys

Checked on 3 Nov in HubSpot's developer docs (see "Sources"), plus what we saw on screen on 2 Nov.

- The key goes in each request as `Authorization: Bearer <key>`.
- Scopes can be added to a key later, with Edit on its page in HubSpot. Whether the key's text changes when scopes are added is **TBC** (F1 checks).
- A key can only get scopes its creator has. So the creator's HubSpot user needs write access first.
- **No webhooks.** HubSpot can't tell us when a record changes. We ask for what changed since the last sync instead. Our backend runs on a laptop anyway, so HubSpot couldn't reach it.
- **No call lists a key's scopes.** Our check (B2) tries one small read for each kind of data and reads HubSpot's "missing scopes" answer.
- **API versions now have dates,** like `/crm/objects/2026-09/companies`. 2026-09 is the newest. The old `/crm/v3/` paths still work until an end date HubSpot hasn't published. The version is one setting.
- **Limits** (from another site, **TBC**): about 100 requests per 10 seconds on Starter and 190 on Professional, search 5 per second, and a 429 answer when over. Contour's HubSpot plan is **TBC** ([HUBSPOT.md](../HUBSPOT.md) question 1).
- **The creator matters.** PLAN-V1 says a key stops working when its creator is removed. HubSpot's docs don't say (**TBC**). A permanent Contour admin should own it.

## How one connection serves every project

- **One door:** `engine/backend/core/hubspot/` is the only code that talks to HubSpot. Projects call it. They never hold the key.
- **Our copy:** the sync fills the tables the export fills today: `core.hubspot_companies`, `core.hubspot_offices` and `core.hubspot_deals`. They already have a `source` column, "export" now and "api" later. So matching, the watchlist and look-alikes keep working unchanged.
- **One way to write:** a project describes the change. The core shows a preview, writes after a person confirms, and logs it once.
- **Each project says what it needs:** a list of scopes in its `AppSpec`, the file where a project tells the core about itself. The Admin page then shows each project as ready, or waiting for a named scope.
- **Shared website parts:** a "Send to HubSpot" dialog, an "In HubSpot" badge and the connection page. A new project reuses them.

Example: later, Call notes adds a note to ABC Logistics. It asks the core to "add this note to company 123". The core checks the scope, shows the preview, writes once and logs it. Call notes has no HubSpot code of its own.

### What each project needs from HubSpot

All **TBC** except the Lead Finder. Contacts are personal data, so a project that reads or writes contacts needs Levi's OK first.

| Project | Reads | Writes | When |
|---|---|---|---|
| Lead Finder | companies, offices, deals, owners, lists | companies (empty fields only), a note, the "AI suggested" list | this plan |
| Call notes | companies, contacts, deals | notes, tasks, company fields like lease expiry | next (Levi, 30 Oct) |
| Calendar | contacts | meetings, if Contour logs them in HubSpot ([HUBSPOT.md](../HUBSPOT.md) question 5) | next, mostly Outlook |
| Meeting prep | companies, contacts, deals, notes, meetings | a note with the brief, never the meeting description (the client can see it) | on hold |
| Deal review | deals, owners, notes, tasks | tasks | third |

Research and Company hub have no known HubSpot needs yet.

### Scopes

- **Read (today; A2 writes down what the key has):** `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.owners.read`, `crm.lists.read` and `crm.schemas.companies.read`. Offices are company fields, one group for each city (read on 3 Nov), so no custom-object scope is needed.
- **Write (F1):** `crm.objects.companies.write` and `crm.lists.write`. Add a notes scope if HubSpot lists one. HubSpot's docs say a note needs `crm.objects.contacts.write`, so add that only if the first note fails (PLAN-V1).
- **Not now:** contacts for other projects, import, export and CMS. `crm.schemas.companies.write` only if the backend creates the new fields itself. We recommend the admin creates them by hand (F1).

## Rules that keep it safe

1. **Read only until switched on.** A write needs the write scope and `HUBSPOT_WRITE_ENABLED=true` in `engine/.env`. It is false by default.
2. **A person confirms every write.** Preview first. Nothing is written automatically in this plan.
3. **What a person typed stays.** Right before writing, read the record again and fill only the empty fields. Everything else goes in the note.
4. **Once only.** Each write has a key. A second click returns the first result, never a second company.
5. **The key stays secret.** It lives only in `engine/.env`. It is never logged and never sent to the website, and tests and the fake backend blank it.
6. **HubSpot names stay home.** The switches `HUBSPOT_NAMES_TO_CLAUDE_OK` and `HUBSPOT_NAMES_TO_SIGNALHIRE_OK` still decide, and both are off.
7. **A HubSpot error never breaks a run.** Runs use the last synced copy. The error shows on the Admin page.
8. **The export stays as backup.** The upload on the Admin page still works.

## How to work this plan

These rules are for Al-khair and for Claude. At the start of every session: read this section, run `git switch plan-v5`, find the first step that isn't ticked, and run `brain context`.

### Mark progress as you go

- A step is done when its "Done when" is true. Tick it in the same turn, with the date and the commit: `- [x] **B1. The HubSpot client.** Done 2026-11-04, abc1234.`
- Then update **Progress** and **Last updated** at the top, and add a line to the Log.
- Half done: leave the box empty and write "Done so far:" and "Left:" under the step.
- Blocked: write "Blocked:" and why, then take the next step that isn't blocked.
- A step changed or dropped: say why in one line. Don't delete it.

### Watch the usage, and save to the brain without asking

A session that stops in the middle of a step leaves the next one starting cold. So saving is automatic: Claude saves on its own and doesn't ask Al-khair first.

- **Check:** call `get_usage` (the tool `mcp__ccd_session_mgmt__get_usage` in the Claude desktop app) at the start of each step, after each commit, and before anything long, like a full test run, a browser check or a live sync. It shows three numbers: the 5-hour limit, the weekly limit and how full this session is. On 3 Nov the account was on the Pro plan, and a session compacts itself at 97% full.
- **At 80%** on any of the three: run the `brain-save` skill now. Then carry on in small steps.
- **At 90%:** save again. Finish the step only if it is small. Otherwise write "Done so far" and "Left" under it.
- **At 95%:** start nothing. Tick what is done, add a Log line, save one line with `brain inbox`, and stop.
- **Safety net:** step A3 adds a hook that writes a line to the brain by itself just before the session compacts. It covers a missed check. It can't see the 5-hour or weekly limits, so the checks above still matter.
- If `get_usage` can't be read, save at the end of every Part.

**What to save**

1. **In this plan:** the ticks, any "Done so far" notes and a Log line.
2. **In the AI Brain (`brain-save`):** the step you were on, the next step, the branch and last commit, decisions with their reasons, surprises and Levi's answers.
3. **Almost no room left:** one line, like `brain inbox "contour PLAN-V5 paused: done A1 to B2, next B3, branch plan-v5, last commit abc1234"`.
4. **Never save** keys, passwords, contact names or the contents of HubSpot records.

### Other rules

- **In order, one step at a time.** Part D waits for Parts B and C. Part F can start as soon as write access arrives and B5 is done.
- **Writes to HubSpot** marks a step that changes Contour's real HubSpot. Run it only when Al-khair says so. Live reads change nothing and cost nothing, so they need no OK.
- **One heavy test run at a time.** The backend tests and the website tests together run out of memory on this laptop.
- **Restart the backend** after a change to the code or a rules file. It reads them once, at start.
- **Windows App Control** blocked `lead-finder` on 3 Nov (os error 4551). If `uv run` is blocked, stop and tell Al-khair. Don't work around it.
- **Commits** are small, one step each, on `plan-v5`. Push only when Al-khair asks. Merging is his call.
- **A choice still open with Levi** is not a hard rule. Build our recommendation and mark it **TBC**.

## Part A: Get ready

- [x] **A1. Branch and baseline.** Done 2026-11-04, 19bc6d7.
  - Make `plan-v5` from `master` (87dfca8). This plan is its first commit.
  - Run the backend suite with `RUN_GATES=1`, then the website checks, one at a time. The last numbers were backend 2,517 passed and 25 skipped, and website 700 tests.
  - Restart the real backend once (`backend` in `.claude/launch.json`). It still runs code from before PLAN-V4. The restart also applies migrations 0007 and 0008.
  - **Done when:** the numbers are in the Log, and the backend runs `master`'s code.
  - On 4 Nov `plan-v5` was moved up to `master` (90467b1), because `master` had 2 newer commits. No backend was running, and the database was already at 0008, so no restart was needed.

- [ ] **A2. Put the key in, and list its scopes.** Al-khair, by hand.
  - Put the key in `engine/.env` as `HUBSPOT_SERVICE_KEY=`. Add the empty line to `engine/.env.example`.
  - From the key's page in HubSpot, write the scope names in the Log. Names only, never the key.
  - Ask the admin who created the key (it should be a permanent admin) and which plan Contour has. Where offices live is answered: company fields (Log, 3 Nov).
  - **Done when:** the key is in, and the scopes and answers are in the Log.
  - Done so far: the key is in `engine/.env`, and `engine/.env.example` documents it and the other HubSpot settings. The scopes are in the Log (4 Nov, from `engine hubspot-check`). HubSpot's limit headers point to the Professional plan.
  - Left (Al-khair): ask the admin who created the key, and confirm the plan.

- [x] **A3. Save to the brain on its own.** Done 2026-11-04 (local settings, not in git).
  - Add a `PreCompact` hook in `.claude/settings.local.json`. It runs just before Claude Code compacts the session.
  - The hook runs `brain inbox "contour auto-save before compact: branch <branch>, last commit <commit>; read plan/PLAN-V5.md Log"`, with git filling in the branch and commit.
  - Use the `update-config` skill. It goes in local settings because the `brain` command exists only on this laptop.
  - **Done when:** the hook has run once in a test, and its line shows in the brain inbox.

## Part B: The shared connection (core)

- [x] **B1. The HubSpot client.** Done 2026-11-04, a61b7c4. `core/hubspot/client.py`, built like the Signal Hire client.
  - A `HubSpot` protocol, the real `HttpHubSpot` (on `httpx2`) and a `FakeHubSpot` for tests. Projects use the protocol, so tests never reach HubSpot.
  - Settings, set in `engine/.env` only: `HUBSPOT_SERVICE_KEY`, `HUBSPOT_API_VERSION` (2026-09, **TBC**) and `HUBSPOT_WRITE_ENABLED` (false).
  - It reads pages of 100 records and stays under the limits: about 8 requests a second, and 4 a second for search (**TBC**).
  - A 429 or a server error is tried again, at most 3 times, after the wait HubSpot asks for. A write that timed out is never sent again blind. First the client checks whether it landed: for a company, a search by domain.
  - Clear errors: `HubSpotUnavailable`, `HubSpotMissingScope` (it names the scope) and `HubSpotNotFound`.
  - **Done when:** tests cover paging, a 429, a missing scope, a timed-out write, and the key never appearing in a log line.

- [x] **B2. The connection check.** Free, read only. Done 2026-11-04, a61b7c4.
  - A command, `uv run --no-sync engine hubspot-check`, and a route, `GET /api/v1/hubspot/status`.
  - It reads one record of each kind (companies, deals, owners, lists and company fields) and marks each scope yes, no or not known.
  - For a write scope, it sends a change to a company that doesn't exist (id 0). "Missing scope" means no. "Not found" means yes. Nothing can change. Which answer HubSpot gives first is **TBC**: check on the day.
  - The answer never shows the key, only "key set" or "key missing".
  - **Done when:** tests on the fake HubSpot pass, and one live check is in the Log (today: reads yes, writes no).

- [x] **B3. Each project says what it needs.** Done 2026-11-04, a61b7c4.
  - Add `hubspot_needs` to `AppSpec`: the scopes a project needs to read and the scopes it needs to write. The Lead Finder's are in the table above.
  - The core joins those needs with B2's check. Example: "Lead Finder: reading ready. Sending waits for `crm.objects.companies.write`."
  - **Done when:** tests show each state for a given set of scopes.

- [x] **B4. The sync.** Free, read only. Done 2026-11-04, a61b7c4 and 1be6df0.
  - First read Contour's company and deal fields from HubSpot, which is free. Write which HubSpot field fills which column in `core/hubspot/fields.yaml`. Contour's own field names, like LinkedIn staff and lease expiry, are **TBC** until then.
  - Copy companies, deals, owners and offices into the `core.hubspot_*` tables, with `source` set to "api". A company from the export is replaced by the one with the same `hubspot_id`.
  - The first sync reads everything. Later ones read only what changed since the last sync. A full sync once a week catches deleted records (**TBC**).
  - Rebuild the memory profiles of the companies that changed. `rebuild_profiles` already exists.
  - Migration 0009 adds `core.hubspot_syncs` (one row per sync: times, counts and any error), `core.hubspot_owners`, and a "changed in HubSpot" time on companies and deals.
  - A person starts it, with the command `engine hubspot-sync` or a button (C1). It also runs at backend start when the last sync is over 24 hours old (**TBC**). There is no timer, because the platform has none yet.
  - **Done when:** tests on the fake cover the first sync, a changes-only sync, owner names, a 429 in the middle, and export rows being replaced. One live sync is in the Log, with its counts beside the export's: 100 companies on 25 Oct, which may have been capped (**TBC**).
  - Built: `fields.yaml` (from the 3 Nov field list), `mapping.py`, `sync.py`, migration 0009, `engine hubspot-sync`, `POST /hubspot/sync`, and the tests. A sync at start runs when the last good one is over 24 hours old (`HUBSPOT_SYNC_MAX_AGE_HOURS`), and a full one once a week (`HUBSPOT_FULL_SYNC_DAYS`). The live syncs are in the Log.

- [x] **B5. The writer, built and switched off.** Done 2026-11-04, a61b7c4.
  - `core/hubspot/writer.py`. A project gives a list of changes. The core shows a preview, then writes after a person confirms.
  - The changes for now: create a company, fill a company's empty fields, add a note to a company, and add a company to a list.
  - Before writing, it reads the record again and drops any field that has a value now (rule 3).
  - Every write is saved in `core.hubspot_writes` (also migration 0009): its key, the project, the change, the HubSpot ids, the result and when. A repeat with the same key returns the first result.
  - After a write, our copy of that company is updated at once.
  - It is off when `HUBSPOT_WRITE_ENABLED` is false or the scope is missing. Then the preview still works, and writing answers "Waiting for write access".
  - Routes: `POST /api/v1/hubspot/writes/{id}/apply` and `GET /api/v1/hubspot/writes` (the log).
  - **Done when:** tests on the fake cover each change, the empty-fields rule, a double click, writing switched off, a missing scope and a timeout.

## Part C: Shared website parts

- [x] **C1. The HubSpot connection page.** Admin, HubSpot tab. Done 2026-11-04, 1be6df0 and da104e4.
  - It shows whether the key is set, each scope (yes, no or not known), each project's state, the last sync with its counts and errors, a "Sync now" button, whether writing is on, and the last 50 writes with links to HubSpot.
  - The export upload stays, folded under "Backup: upload an export".
  - **Done when:** the website tests pass, and the page looks right on the fake backend on a desktop, a phone and in dark colours.
  - Checked in the browser on the fake backend (it now has a `FakeHubSpot` made from the export, with writing on): desktop light, desktop dark and phone dark, no sideways scroll, no console errors. "Sync now" ran a sync from the fake and gave the export's numbers exactly (100 companies, 185 offices, 12 deals).

- [x] **C2. Parts any project can use.** In `src/components/hubspot/`. Done 2026-11-04, 1be6df0.
  - `SendToHubSpotDialog` shows a preview (a new company or an update, each field, the note and the list) and a Confirm button. While writing is off it says "Waiting for write access" and still shows the preview.
  - `InHubSpotBadge` shows the label, the owner and a link to the record.
  - `useHubSpotStatus` gives any page the connection state.
  - **Done when:** website tests cover each part, with writing on and off.

## Part D: The Lead Finder on live HubSpot

- [x] **D1. Watchlist and matching on synced data.** Done 2026-11-04, da104e4.
  - Both already read the `core.hubspot_*` tables. Check they give the same answers on synced rows. The API can give different values from the export, like a lifecycle stage id instead of its name.
  - **Done when:** the watchlist from a live sync is compared with [EXPORT.md](../projects/leads/research/EXPORT.md) (47 Watch on 25 Oct), and the Log explains the differences.

- [x] **D2. Labels from live deals.** Done 2026-11-04, da104e4 (`lead-finder relabel`).
  - New, In HubSpot (with the owner), Open deal (never suggest), Dissolved deal (wait 12 months) and Possible match, from the synced deals and their stages. Stage ids become names through the pipelines HubSpot gives.
  - **Done when:** tests cover each label, and the dev leads show the right labels after a live sync.

- [x] **D3. What a lead sends.** Done 2026-11-04, a61b7c4 (`apps/lead_finder/hubspot_send.py`).
  - The map is already in `apps/lead_finder/rules/hubspot_map.yaml`: name, domain, city, state, industry and staff, plus 7 new fields (AI suggested, trigger, trigger date, source link, score, result and research date) and the list "AI suggested".
  - HubSpot's formats: the state as VIC, SA or WA, the industry from HubSpot's own list, and the website as a plain domain.
  - The note has the trigger with its link, the score, the result and a link to the lead card (**TBC** with Levi).
  - Until the 7 new fields exist (F1), their values go in the note.
  - **Done when:** tests show the changes for a sample lead, both new and already in HubSpot.

- [x] **D4. The "Send to HubSpot" button.** Done 2026-11-04, 1be6df0.
  - On the lead card and in the Results panel. The routes are the ones PLAN-V1 named: `POST /api/v1/lead-finder/leads/{id}/hubspot/preview` and `.../hubspot/send`.
  - After a send, the lead's status is `sent` (the status exists already and only this sets it), and the card links to the HubSpot record.
  - **Done when:** the website tests pass, and a send works on the fake backend in the browser, on a desktop, a phone and in dark colours.
  - Done so far: the routes, the `sent` status and their tests (a61b7c4). A third route, `GET .../hubspot`, gives the lead's newest write, so the card can show its link. The button (`lead/send-lead.tsx`, on the card and so in the Results panel) and its tests (1be6df0).
  - Checked in the browser on the fake backend: the preview showed each field and what happens to it, Confirm sent it (company, note and list all done), the lead showed "Sent", the card linked to the record, and the write log listed it.

## Part E: Check and merge

- [x] **E1. The full check.** Done 2026-11-04.
  - The backend suite with `RUN_GATES=1`, then the website checks, one at a time.
  - **Done when:** everything passes, and the numbers are in the Log.

- [x] **E2. A live read check.** Free. Done 2026-11-04.
  - Run `hubspot-check` and a sync on Contour's HubSpot. Look at the labels on 5 leads by hand.
  - **Done when:** the Log has the counts and anything that was wrong.

- [ ] **E3. Docs, then merge.**
  - Done so far (1be6df0): HUBSPOT.md section 13, AGENTS.md ("How a project uses HubSpot", commands, safety) and the README. Left: the AI Brain after the last steps, and the merge (Al-khair's call).
  - Update [HUBSPOT.md](../HUBSPOT.md) section 13 (service keys replace private apps), [AGENTS.md](../engine/AGENTS.md) (how a new project uses HubSpot), the engine README and the AI Brain.
  - Merge `plan-v5` into `master` (Al-khair's call). Writing stays off until F3, so merging before Part F is safe.
  - **Done when:** it is merged, and the Log says so.

## Part F: Switch on writing

This starts when write access arrives, expected 4 Nov (**TBC**).

- [ ] **F1. The admin sets up HubSpot.** Al-khair asks the admin.
  - Add the write scopes to the key (see "Scopes"). If the key's text changes, update `engine/.env`.
  - Create the 7 company fields with the names in `hubspot_map.yaml`, and the list "AI suggested".
  - **Done when:** `hubspot-check` shows the write scopes as yes, and the fields and the list exist.

- [ ] **F2. One live write.** **Writes to HubSpot.** Only when Al-khair says so.
  - If the admin can make a free HubSpot test account, test there first (**TBC**). Otherwise use one real lead that Al-khair picks.
  - Preview, confirm, then check in HubSpot: the company, its fields, the note and the list. Click again and check that no duplicate appears.
  - **Done when:** the Log says what was written, with the link.

- [ ] **F3. Switch it on.**
  - Set `HUBSPOT_WRITE_ENABLED=true`, restart the backend, and write it in the Log.
  - **Done when:** the Send button works for every lead, with a preview.

## Later, not in this plan

- **Contacts:** read and write contacts for Call notes and Meeting prep, and Signal Hire's contact on a click (PLAN-V4 Part E). This needs Levi's OK, a Spam Act check and the contacts scopes.
- **Tasks and notes for other projects:** add them to the writer when Call notes and Deal review start.
- **Changes the moment they happen (webhooks):** a service key can't do this. It needs a HubSpot project app and a public web address, so it comes after hosting.
- **A sync timer:** when the platform gets its timer.
- **Outlook:** the same pattern (one connection in the core, needs declared per project) for Calendar and Call notes.

## Waiting on

- **Levi (new, 4 Nov):** which deal stages count as an open deal. Today any deal that isn't Dissolved does, so of the 1,167 live companies marked "Open deal" only 480 have a deal still open: 310 have only Closed lost (and Dissolved) deals, and 377 have a won deal ("Ordered - Contract Signed") and nothing open. Our recommendation (**TBC**): Closed lost counts like Dissolved (wait 12 months unless a new trigger), and a won deal is a customer (never suggested as a new lead, but useful for the customer-connection job).

- **The HubSpot admin (through Levi):** the write scopes (expected 4 Nov), the 7 new fields and the list, Contour's HubSpot plan, and a test account (**TBC**).
- **Levi:** the OK to use HubSpot data (still **TBC**), and what the note should say.
- **Al-khair:** the key in `engine/.env` (A2), and the go-ahead for F2.

## Risks

- **Service keys are a beta.** HubSpot may change them. The check (B2) shows it at once, and the export upload stays as a backup.
- **Contour's field names are unknown.** B4 reads them first. A wrong map shows as empty columns, not wrong data.
- **A write goes wrong in the real CRM.** Preview and confirm, empty fields only, once-only keys, the write log, and one test write (F2) first.
- **The key's creator leaves.** The key may stop working (**TBC**). Ask that a permanent admin creates it.
- **Data is only as fresh as the last sync.** There are no webhooks. The page shows the sync time, and "Sync now" is one click.

## Log

Newest first. One line for each tick, pause or surprise.

- 2026-11-04: E1 ticked: backend 2,602 passed and 25 skipped (4 min 16 s; a first run had 2 failures because the fake backend's test left HUBSPOT_WRITE_ENABLED=true for later tests, fixed by restoring every name it sets) with `RUN_GATES=1`; website lint (0 warnings), types, 708 tests and the build. E2 ticked: `engine hubspot-check` (reads yes, writes no) and two live full syncs (Log below). 5 relabelled leads checked against live HubSpot (free reads): all 5 are in HubSpot; the open-deal one has deals at 'Contour Validated Deal' and 'Unqualified Information Deal', right; a second is "Open deal" only through a Closed lost deal (see Waiting on, Levi); leads with no website saved matched by name, and where both have a website they agree.
- 2026-11-04: D1 and D2 ticked (da104e4). D1: HubSpot's API gives industry labels with punctuation ("Hospital & Health Care"), the export and watchlist.yaml without ("Hospital Health Care"), so 8 hospitals left the Director list and miners and food makers counted as office-based. The industry comparison now ignores punctuation, "&" and "and". On the live copy the same 100 companies then give the export's lists exactly (47 Watch, 11 likely, 15 Director, 7 open deals); one company moved from "no office" to "no staff number" because HubSpot changed since 25 Oct. Whole live copy: 1,480 Watch (993 likely office-based), 593 Director, 1,167 open deal, 7,388 too small or no staff number (2,627 with no number), 3,285 with no office in a city we cover. D2: `lead-finder relabel` matched the 52 dev leads again: 35 were in HubSpot already (15 open deal, 9 dissolved deal, 5 in HubSpot, 6 possible match), saved with `--yes`. Results and scores stay as researched.
- 2026-11-04: C1 and D4 ticked: browser check on the fake backend (desktop light and dark, phone dark), and a send on the fake HubSpot.

- 2026-11-04: Paused at 88% of the 5-hour limit (brain saved at 81%). Next, in order: the browser check of C1 and D4 on the fake backend; D1 and D2 (script ready: watchlist and lead labels on the synced copy, read only); E1 (full backend run with `RUN_GATES=1`, then the website checks, one at a time); E2; then the merge, Al-khair's call. The second full sync (row 2, with the fix) finished well in 9 min 9 s: 22,760 offices and 13,885 profiles.
- 2026-11-04: B4 ticked, C2 ticked (1be6df0). First live full sync (row 1): 9 min 36 s; read 13,913 companies, 8,943 deals, 61 owners (26 active, 35 archived); saved 13,913 companies, 43,482 offices, 8,038 deals; 905 deals have no company and were left out; 13,885 profiles (28 companies have no name); 0 removed (the export's 100 companies are all still in HubSpot, so the export WAS capped at 100). Warnings: 25 texts cut to fit, 1 odd value. Surprise: 20,722 of the offices were only a "Staff on LinkedIn" of 0 in an otherwise empty city group, which would have given thousands of companies a fake office in Adelaide, Brisbane or Perth (watchlist and "same city" matching). The export never listed such groups, so a zero count alone is no longer an office (1be6df0). The second full sync (row 2) saved 22,760 offices, exactly 43,482 minus 20,722.

- 2026-11-04: B1, B2, B3, B5 and D3 ticked (a61b7c4, one commit because the files are shared). Backend 2,587 passed in a full run (1 more failed only because a second test run used the same test database at the same time; it passes alone). Live check, free (`engine hubspot-check`): reads yes for companies, deals (and stages), owners, lists and company fields; writes no for `crm.objects.companies.write` and `crm.lists.write`. Project line: "Lead Finder: reading ready. Sending waits for crm.objects.companies.write, crm.lists.write." Migration 0009 is applied to the dev database, and `engine/schema/SCHEMA-0009.md` is saved.
- 2026-11-04: Design choices, with reasons. (1) Owner ids are soft links, not foreign keys: HubSpot's owner list may lack an id, and one bad row must not stop a 14,000-company sync. (2) A sync saves in one transaction, so a failure leaves the old copy whole. (3) A full sync removes companies HubSpot no longer has, whatever brought them in, but never after an empty read. (4) Offices get 4 new columns (size in m2, size bracket, quality, staff text), saved but not used by any rule yet. (5) Deals with no company (9 of 20 in a sample) are left out and counted.

- 2026-11-04: A3 ticked. The `PreCompact` hook is in `.claude/settings.local.json` (git-ignored). Its command ran once in a test and wrote "contour auto-save before compact: branch plan-v5, last commit 90467b1; ..." to the brain inbox. Claude Code only loads a new settings file in a new session, so it works from the next session on.
- 2026-11-04: Live read, free (a probe; no record contents kept). Contour's HubSpot has **13,913 companies and 8,943 deals**, so the 25 Oct export (100 companies) was capped. HubSpot's own limit headers say 190 requests per 10 seconds, 19 a second and 625,000 a day, which is the Professional plan (**TBC** with the admin). The dated paths (`2026-09`) work for objects, search, owners, lists, pipelines and account details. Each record comes with its own HubSpot link. Reads work: companies, deals, owners, lists, company fields, deal stages. Writes don't yet: a change to company 0 and to list 0 both answered "missing scopes" (`crm.objects.companies.write`, `crm.lists.write`). A note needs `crm.objects.companies.write` (or contacts or deals write), so no contacts scope is needed.
- 2026-11-04: A1 ticked. Baseline on `plan-v5` at 90467b1: backend 2,517 passed and 25 skipped with `RUN_GATES=1` (3 min 34 s); website lint (0 warnings), types, 700 tests and the build pass. The uncommitted schema map from 3 Nov (`scripts/schema_map.py`, `engine/schema/SCHEMA-0008.md`) was committed first (19bc6d7). Its `--check` passed.

- 2026-11-03: Contour's HubSpot field list read with the read key, free (`engine/backend/scripts/hubspot_schema.py`; the answer is in `scripts/out/`, git-ignored). 364 company fields (119 are Contour's own), 516 deal fields (227) and 3 deal pipelines (Sales, Leads, Whales). Offices are company fields in one group per city: Melbourne, Adelaide, Brisbane, Sydney, `other_office_1` (labelled Perth) and `other_office_2`. Each has city, street, level, last moved, lease expiry, staff on LinkedIn, office size and quality. Traps for B4 and D2: industry is stored as a code (`COMPUTER_SOFTWARE`, the export showed "Computer Software"); some stage ids reuse HubSpot's built-in names with other labels ('Dissolved' is `contractsent`, 'Ordered - Contract Signed' is `closedwon`, 'Qualified Deal' is `presentationscheduled`), so labels must come from the stage id; "Number of Staff" per office is text, not a number; Perth's LinkedIn field is `staff_on_linkedin__perth_`. The 7 `contour_ai_*` fields don't exist yet (F1). Reading custom objects got a 403 (no scope), and none is needed. The backend settings now have `hubspot_service_key` (secret, removed from logs, blanked in tests).

- 2026-11-03: Plan written. Facts found the same day: the key reads, and write access is expected on 4 Nov. Service keys have no webhooks and no call that lists their scopes. API version 2026-09 is the newest. `hubspot_map.yaml` and the `sent` lead status already exist. No step started.

## Sources

- [Service keys enter public beta](https://developers.hubspot.com/changelog/service-keys) (HubSpot changelog)
- [Make API requests using a service key](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys) (HubSpot docs)
- [API reference overview: date versions](https://developers.hubspot.com/docs/api-reference/latest/overview) (HubSpot docs)
- [HubSpot API limits](https://getknit.dev/blog/hubspot-api) (Knit, not HubSpot, so the numbers are **TBC**)
