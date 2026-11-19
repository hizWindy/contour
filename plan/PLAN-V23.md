# Assistant refinements: plan, version 23

This plan refines the Assistant that PLAN-V22 built. The mic gets better at names: it is told which names to listen for, it fixes a misheard name on every page, and it learns from each fix. People get an alert in HubSpot when Contour gives them a task or a pre-read. Staff without a HubSpot user get accounts that fit them. And the Assistant gets smoother in a dozen small places. One session builds it, in four parts, one after another.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 19 Nov 2026 (written, nothing built).
- **Progress:** Before the build: 0 of 3. Part 1: 0 of 7. Part 2: 0 of 5. Part 3: 0 of 5. Part 4: 0 of 6. M1 to M4: 0 of 4.
- **Sources:**
  - Al-khair's ideas and answers in chat on 19 Nov (the second session that day);
  - the meeting with Levi on 18 Nov (Gemini's notes in `minutes of meeting/`);
  - the code on `plan-v22` (`7a92e31`), read on 19 Nov, and the "TBC at Al-khair's look" lines in [PLAN-V22.md](PLAN-V22.md)'s Log;
  - HubSpot's API docs (the tasks guide, and the older engagements page), MDN and Chrome's notes on the Web Speech API, and Deepgram's and Microsoft's speech docs, all read on 19 Nov.
- **Comes after:** [PLAN-V22.md](PLAN-V22.md). Its `merge v22` started on 19 Nov (the join at 18:46) and must finish first, because this plan changes its code. PLAN-V19's T1-2 (the HubSpot alert test) moves here, as S2.

## Go signals

Say the line in the session. The same line starts the work, and continues it later from the first step that isn't ticked. Saying `implement v23` counts as Al-khair's word for S0.

| Say | What it does |
|---|---|
| `implement v23` | Builds Part 1 (names and hearing), Part 2 (alerts), Part 3 (staff without HubSpot), then Part 4 (the Assistant's feel) |
| `merge v23` | Checks everything, then moves `master` to `plan-v23` |
| `deploy v23` | Pushes `master`, deploys, and does the live steps in M3 |

You'll also answer things along the way:
- **S1 needs you at the keyboard** for about 25 minutes. It is free.
- **S2 writes one test task to the real HubSpot.** It is free, and runs only on your word in chat.
- **Each screen waits for your look.** The session marks it "built, waiting for a look" and carries on.
- **The choices below** stand unless you change them before that step starts.
- **HubSpot writes, emails and live switches** happen only on your own word in chat.

## Decided in chat (19 Nov)

These are Al-khair's answers. They are fixed for this plan.

1. **Names are smart and dynamic, not fixed keywords.** Only "send it" and "cancel" on the card stay fixed words: they must be fast, need no AI, and a mistake there costs the most. Everything else adapts to who is speaking and what is on screen.
2. **Three layers for names:**
   - **Hear:** each time V is pressed, a short list of the names this person is most likely to say goes to the speech service as hints.
   - **Fix:** a misheard name is fixed against that list on every page, not only on a company's page. Then against the whole HubSpot copy, as now.
   - **Learn:** when a rep corrects a name on the card, the pair is kept for the whole team.
3. **People must get an alert in their HubSpot** when Contour gives them a task or a pre-read.
4. **Staff without a HubSpot user get their own mark** on their account: a "HubSpot user" field, with "No HubSpot user" as a choice. It is a field, not a fifth role. A role says how much someone may do. This field says where their work lands.
5. **Today shows HubSpot tasks only to people with a HubSpot user.** Each part of Today shows only if that person can have something in it.
6. **What staff without HubSpot can and can't do** is in the next section.
7. **This plan holds the decisions above and the refinements to the Assistant's user experience** (Part 4).

## Staff without HubSpot: what they can and can't do

Example: Jo Sample, a designer, logs a call with a client. Jo has a Contour account and no HubSpot login.

**They can:**
1. Speak or type commands, and log calls and meetings. Calls go to HubSpot on the company, its person and its open deal, with "Logged by {name}, {position}, in Contour." at the top (T3-2).
2. Change company fields through a call, like a lease end, after checking the card like anyone else (**TBC with Levi**: should non-sales staff?).
3. Give a task to a teammate who has HubSpot ("add a task for Sam").
4. Make and send pre-reads (with the Meetings tick), and email teammates, once email is on live.
5. Look up companies and use call prep, if they have those ticks.

**They can't:**
1. Have HubSpot tasks. None show on Today, they can't tick one done, nobody can give them one, and they can't make one for themselves (T3-2 refuses it).
2. Get a pre-read as a HubSpot task. They get it by email, and on Today (T2-3).
3. Use "My meetings", "My team" or quiet deals. Those go by HubSpot user.
4. Open HubSpot. "Open in HubSpot" is hidden for them (T3-4).
5. Own their calls in HubSpot. Their calls have no owner, so the "Logged by" line says who.

## Words used here

- **Hint list:** the short list of names sent to the speech service, so it listens for them. Example: Northwind, James Sample, Sam.
- **On-device mode:** Chrome turns speech into words on the laptop itself, so nothing leaves the laptop. It is experimental in Chrome (**TBC** for Australian English).
- **Learned name:** a pair the team taught the mic, like "North Wind" means Northwind.
- **Reminder:** HubSpot's own alert for a task, sent at a set time. It comes by HubSpot's bell, email or phone app, as each person's HubSpot settings say.
- **FYI task:** a HubSpot task that tells a company's owner that someone else logged a call. Ticking it done is all it asks.
- **No HubSpot user:** an account marked as having no HubSpot login, like Jo's.

## What exists already (so nothing is built twice)

Read this before any step. All of it is on `plan-v22`.

| Need | Already there | This plan adds |
|---|---|---|
| Hearing | `call-notes/mic/voice-tool.ts`: the browser's speech service, `en-AU`, with no hints. Chrome may take a hint list (`phrases`) only in on-device mode (`processLocally`). Both are experimental. | The hint list, in on-device mode if S1 says it works |
| Fixing names | `call-notes/mic/name-fix.ts` fixes a word 1 letter off a name (2 for 8 letters or more), with the same first letter. Its names come from `voice/names.ts`: only the company on screen and its people. Elsewhere, the command step matches against our copy with a close-name score of 90 of 100 (`match_fuzzy_min`). | The hint list on every page, and learned names first |
| Finding the company | `find_company` in `apps/companies/assistant_find.py` searches our HubSpot copy only. No match says "We couldn't find 'North Wind' in HubSpot. Pick the company." | A live HubSpot search, then "Add to HubSpot" |
| Making a company in HubSpot | The Lead Finder's writer looks for a duplicate first, then creates (`core/hubspot/writer.py`) | The same check, for a company added from the card |
| Tasks | Every task goes through `core/hubspot/activities.py`, with no reminder: the pre-read's tasks (`meeting_send.py`), a call's follow-ups (`note_batch.py`) and the Assistant's tasks (`assistant_tasks.py`). HubSpot's docs say a task made through the API sends no "assigned to you" alert. | `hs_task_reminders` on each task |
| Email | `core/email/sender.py`. Live, `EMAIL_PROVIDER` is `log`, so nothing is sent. Resend needs `EMAIL_API_KEY`, `EMAIL_FROM` and DNS records on contourinteriors.com.au. | Nothing in code. M3 switches it on. |
| Accounts | Add person (`PersonIn` in `core/api/people.py`) takes a name, email, username, position, role and ticks. The HubSpot link is set later (`set_hubspot_owner`). An empty link means both "has none" and "not linked yet". The signed-in answer (`UserOut`) has no HubSpot field. | The "HubSpot user" field, and the website told about it |
| A task for someone with no HubSpot user | A task for themselves, or a follow-up on their own call, goes to HubSpot with no owner, so nobody sees it (`assistant_tasks.py`, `activities.py`) | Refused, with plain words |
| Today | `apps/companies/today.py`: no HubSpot link gives `no_owner`, and "Today needs your account linked to HubSpot. Ask {admin} to link it." | A `none` state, and pre-reads sent to you |
| The card and V | Cancel on a call card says "Not sent. The call waits in Call logs." The call card changes only by voice. V does nothing while any dialog, menu or list box is open (`voice/keys.ts`), so not over call prep. A tap starts V, and 1.5 seconds of silence or V again stops it. | "Later", typing in every box, V over call prep, hold V and an off switch |

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts. The rule ones are **TBC with Levi**.

**Names and hearing (Part 1):**
1. **The hint list** holds at most 50 names (**TBC** after S1), most likely first:
   - the company on screen, its people, its open deal and its next meeting;
   - my meetings today and tomorrow, and my tasks due;
   - the companies I own, or called in the last 30 days;
   - my teammates' names;
   - companies the mic often gets wrong (they have learned names), and a few fixed words: "fitout", "test fit", "pre-read", "follow up".

   Deepgram's docs advise 20 to 50 terms, and Microsoft's take 500 at most. A long list can make a service hear names nobody said.
2. **The hint list goes to the speech service only in on-device mode,** and only if S1 shows it works for Australian English. Then the voice and the names never leave the laptop. The server mode gets no hints. The list still drives the fix (layer 2).
3. **Learned names are saved only after the card is sent,** for the whole team. They hold words, never audio. A learned name comes before the close-name match. The same words taught for two companies give both as choices. An Admin can remove one in Settings.
4. **Unclear words stop before the card,** with "We didn't catch that clearly. You said: '{words}'. Say it again, or fix the words." The words stay in the bar's text line, so the rep can fix them and press Enter. It happens when the command step answers `unclear`, or when the speech service's own confidence is under a level S1 sets (**TBC**).
5. **A company not in our copy:** search HubSpot live first (one free request), and read it into our copy if it is there. If HubSpot doesn't have it either, the card offers "Add {name} to HubSpot", with the city if one was said. It uses the Lead Finder's duplicate check, and it goes from the card like any send.
6. **Hold V:** hold V and talk, let go to stop. A tap works as now. "Held" means V is still down after 0.4 seconds (**TBC**).

**Alerts (Part 2):**

7. **A reminder on every task Contour makes:**
   - for someone else (a pre-read, a teammate's follow-up, "add a task for Sam"): 2 minutes after the send. It stands in for the "you have a task" alert HubSpot won't send.
   - for yourself: at 9:00 am on its due day, the time the task is due.

   S2 checks that it fires. If HubSpot takes more than one reminder time, other people's tasks also get the 9:00 am one.
8. **The company's owner gets an FYI task** when someone else's call on their company reaches HubSpot. It reads "FYI: {name} logged a call with {company}", with the call's summary and a link to it in Contour. It is due today, with a reminder. On by default, with a switch to turn it off (**TBC with Levi**, W4).
9. **Pre-reads show on Today** for each person they were sent to, with or without HubSpot.
10. **A late afternoon nudge** for calls not sent yet: at 4:30 pm on weekdays, an email to each person with calls waiting, like "7 calls aren't in HubSpot yet." It stays off until email is on and the job is switched on (**TBC**: the time).
11. **The send dialog says what alerts people:** "Each gets a HubSpot task and a HubSpot alert." "Also email them" stays as it is.

**Staff without HubSpot (Part 3):**

12. **The "HubSpot user" field on Add person:** pick their HubSpot user from the team list, with the closest name suggested, or pick "No HubSpot user". It is required for a new person, and can be changed in People. Existing accounts show "Not set" until someone picks.
13. **"No HubSpot user" starts on the Call logs tick only,** plus Meetings if they write pre-reads. PLAN-V22 choice 4 says the same. Today, the Staff role also starts with the Lead Finder's ticks.
14. **Their calls in HubSpot** have no owner, and the call's text starts "Logged by {name}, {position}, in Contour." (**TBC with Levi**, W5: or put them under the company's owner.)
15. **A task for themselves is refused:** "You don't have a HubSpot user, so this task can't go to HubSpot. Give it to a teammate." On a call card, a follow-up needs a teammate in its "For" box before Send.
16. **Today for them:** calls to confirm, those that need a look, pre-reads sent to them, and "Press V to log a call". No tasks, meetings, deals or link message.

**The Assistant's feel (Part 4):** each step there names where its item came from: PLAN-V22's look notes, or this chat.

## Words for when things go wrong

Each problem says what happened, what still works, and the one thing to do. No setting names, file names or codes on screen (`screen-words.test.ts`).

| What went wrong | Words on screen | Buttons |
|---|---|---|
| The words are too unclear | "We didn't catch that clearly. You said: '{words}'. Say it again, or fix the words." | Say it again, and the text line |
| The company is in HubSpot but not in our copy | "{name} is new in HubSpot. We'll use it." | None |
| The company isn't in HubSpot | "{name} isn't in HubSpot. Add it, or pick another company." | Add to HubSpot, the search list |
| HubSpot has a company like it | "HubSpot already has {other name}. Use it, or add {name} anyway." | Use {other name}, Add anyway |
| Adding companies is off | "Adding companies to HubSpot is off for now. Pick a company that's there." | The search list |
| A task for yourself, with no HubSpot user | "You don't have a HubSpot user, so this task can't go to HubSpot. Give it to a teammate." | The team list |
| A follow-up with no one to do it | "Who should do this follow-up? Pick a teammate." | The team list |
| A call kept for later | "Kept in Call logs, to send with the others." | Open Call logs |

## What it costs

- **To build:** time only.
- **To run:** nothing new.
  - A reminder is one more field on a request we already make.
  - The live company search and an FYI task are each one free HubSpot request.
  - The hint list and learned names are free.
  - Resend is already paid for (Levi, 2 Nov).
- **If S1 fails the bar,** a paid speech service with name hints becomes the next plan, not this one. Estimate: under US$0.15 a rep a day, at 40 short commands (**TBC**).

## Who builds it

One session builds every step, in order: S0, Part 1, Part 2, Part 3, then Part 4. S1 and S2 can happen any time before the steps that need them (T1-5 and T2-1).

- **Backend steps** are `backend-agent` work. They follow the `api-change` skill, `db-migration` for T1-2, and `security-check` for T1-4, T3-1 and T3-2.
- **Website steps** are `frontend-agent` work. They follow `engine/DESIGN.md` and the `ui-build` skill, and build against the contract with `mockApi`.
- **M1's independent check** is a fresh `review-agent` with the `merge-check` skill. It changes nothing.
- **Merging, pushing, deploying, HubSpot writes, emails and live switches** stay with Al-khair's own word in chat.

## How to work this plan

**The copy.**
- One branch, `plan-v23`, made from `master` after `merge v22` has moved it, in its own copy: `git worktree add ../contour-v23 -b plan-v23 master`. The main folder stays on `master`.
- In the new copy: `uv sync --frozen` in `engine/backend`, and `npm ci` in `engine/frontend`.

**Ports and database.**
- Backend `API_PORT=8101`. Website on port 5271, with its proxy to 8101. Database `leadfinder_v23`, a copy of the dev database at the newest migration. Test database suffix `LEADFINDER_TEST_DB_SUFFIX=_v23`.
- The copy's `engine/.env` holds the `POSTGRES_*` lines only. `API_PORT` and `CORS_ORIGINS` go on the command line.
- **No Claude key and no HubSpot key,** except for S2 and the checks Al-khair asks for, loaded into that process only. `ANTHROPIC_API_KEY` is also a Windows user setting on this laptop, so blank it for the process. Never print a key.
- Leave ports 8000 and 5173 alone, and those of older plans (8041 to 8091, 5211 to 5262).

**What to expect.**
- **One migration,** `0026_v23_names_and_hubspot_user`, made in T1-2: the learned names table, and the accounts' "No HubSpot user" mark (T3-1 uses it). It follows `0025_v19_roles_access`, because PLAN-V22 made none. S0 checks that.
- **No new package.**
- **The contract and the website's types** are made again after each part's backend steps (`uv run --no-sync engine openapi`, then `npm run types`). Never edit `openapi.json` or `src/api/schema.d.ts` by hand.
- **Change only what a step needs.** `engine/AGENTS.md`, `engine/DESIGN.md` and `.claude/` change at M4 only. `CLAUDE.md` changes at S0 and M4 only.

**Every working session.**
- **At the start:** read this section, "Decided in chat" and "Choices made for you". Go to `../contour-v23`, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks. The laptop is short of memory.
- **Windows Application Control** blocks a new copy's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `uv run python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each. Follow the `git-workflow` skill.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the Progress line and add a line to that part's Log.
- **No real client data in git:** tests use made-up companies and people, like "Sample Logistics Pty Ltd" and "Jo Sample". No recording is ever kept.
- **Screens:** screenshots go in `plan/shots/v23/`, which git ignores.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the build starts

- [ ] **S0. The branch and the copy.** Waits for `merge v22`.
  - Make `plan-v23` from `master` in `../contour-v23`. Don't switch the main folder's branch.
  - Its first commit holds this plan and a line for it in `CLAUDE.md`. The plan was written in the main folder and not committed, so copy it in, then delete the main folder's untracked copy. (`CLAUDE.md` wasn't touched in the main folder, so `merge v22` could move `master`.)
  - Make the database `leadfinder_v23`, and check the newest migration.
  - Check `git log` and the worktrees for open work on the same files (PLAN-V22's open look steps).
  - Read the live switches on the live site (looking only) and write them in the Log: the email provider, HubSpot writing, the AI sort, `voice_tool`, and whether the key can create companies.
  - **Done when:** `git branch --list plan-v23` shows it, it holds `plan/PLAN-V23.md`, the fast backend tests pass on it, and the Log has the live switches.
- [ ] **S1. The voice and names test.** Needs Al-khair at the keyboard, about 25 minutes. Free. If PLAN-V22's S1 is done by then, reuse its numbers and do only the hint part.
  - Read the current Web Speech API docs first (`phrases`, `processLocally`, and how Chrome checks and installs a language). Don't build from memory.
  - A throwaway test page, never merged: Chrome's on-device mode with a hint list of 50 names from the dev copy, then the server mode with no hints.
  - Al-khair says 10 commands with real Australian company and people names, in Chrome, and in Edge if it has an on-device mode.
  - For each mode, note: the names wrong out of 10 (as heard, and after the fix), the seconds to the first words, the seconds from the last word to the final words, whether 1.5 seconds of silence cut him off, and the service's confidence on each command. For on-device mode, also the language download's size and time.
  - **Decide:** hints in on-device mode if they get at most 1 name wrong in 10 after the fix, with the first words within 1 second (**TBC**). Else the server mode stays, T1-5 sends no hints (the list still drives the fix), and a paid service is the next plan.
  - No recording is kept. Only the numbers go in the Log.
  - **Done when:** the Log has the numbers and the decision, and choices 1, 2 and 4 match them.
- [ ] **S2. The HubSpot alert test** (moved from PLAN-V19 T1-2). Only on Al-khair's word in chat, because it writes to the real HubSpot. Free.
  - Make one task for Al-khair's HubSpot user, subject "Contour test: please ignore", due today, with a reminder 2 minutes ahead. Send it through `core/hubspot/` and the activity writer, as a real send would.
  - Al-khair says what alerted him, and when: the bell, an email, the phone app, or nothing. Did anything come when the task was made, before the reminder?
  - Try a second reminder time on the same task (**TBC** whether HubSpot takes two).
  - Run the free `engine hubspot-check`: can the key create companies, for "Add to HubSpot"?
  - Delete the test task.
  - **Done when:** the Log says what alerted him, and choice 7 matches it. If nothing alerted him, stop Part 2 and ask.

## The contract

All new routes sit under `/api/v1/companies/assistant/`. A route that changes something refuses a Viewer (`need(..., write=True)`). Each new route goes in `tests/core/test_contract_routes.py`.

### 1. The hint list (T1-1)

`GET /assistant/names`, with `company_key` (optional: the company on screen).
- `names`: at most `name_hints_max`, most likely first. Each has `text`, `kind` (`company`, `person`, `teammate` or `word`) and a `company_key` where it has one.
- Kept for 5 minutes a person.

### 2. Learned names (T1-2)

- `POST /assistant/learned`: `heard` (1 to 80 characters) and `company_key`. Saved only when they differ, case and spaces aside. 204.
- `GET /assistant/learned` and `DELETE /assistant/learned/{id}`, for Admins.

### 3. The command step (T1-3)

- `action` gains `unclear`. Then `read_back` holds the words as heard.
- `company` gains `from_hubspot` (found by the live search, and now in our copy) and `can_add` (found nowhere, with the name as heard).
- Learned names are tried before the close-name match.

### 4. Adding a company (T1-4)

`POST /assistant/companies/preview`, then `POST /assistant/companies` (with an Idempotency-Key).
- In: `name` (1 to 120 characters) and `city` (optional).
- The preview gives `similar`: HubSpot companies with a close name.
- The send makes the company in HubSpot and in our copy, and answers its `company_key`.
- Errors: 409 `hubspot_writing_off`, 409 `company_exists` (the same name and city), 429 `too_many_companies` (5 a minute a person, **TBC**).

### 5. Alerts (T2-1 to T2-3)

- No new route for reminders or FYI tasks.
- The pre-read send's preview gains the line "Each gets a HubSpot task and a HubSpot alert."
- `GET /assistant/today` gains `pre_reads`: the pre-reads sent to me, for meetings from today on. Each has the meeting's title, its time, the company, who sent it, and the `form_id`.

### 6. The HubSpot user mark (T3-1)

- Add person (`PersonIn`) gains `hubspot_owner_id` or `no_hubspot_user: true`. A new person needs one of the two (422 `hubspot_choice_missing`).
- The HubSpot link change in People also takes "No HubSpot user".
- The People answer and the signed-in answer (`UserOut`) gain `hubspot`: `linked`, `none` or `not_set`.

### 7. Tasks and Today (T3-2, T3-3)

- 409 `no_hubspot_user`: a task for yourself, or a call's follow-up with no teammate, from someone with no HubSpot user.
- `GET /assistant/today`: `tasks_state` gains `none`.

### 8. Settings

| Setting | Default | What it does | On the Settings page |
|---|---|---|---|
| `name_hints_max` | 50 (**TBC** after S1) | The most names in the hint list | Yes |
| `notify_owner_calls` | On (**TBC with Levi**) | An FYI task for the company's owner when someone else's call reaches HubSpot | Yes |
| `calls_nudge_at` | 16:30, off | The late afternoon email about calls not sent yet | Yes |

## Part 1: names and hearing

**Progress:** 0 of 7.

- [ ] **T1-1. The hint list** (backend). `apps/companies/assistant_names.py` and its route.
  - Choice 1's order, from our copy, Today's reads and the learned names. No HubSpot request.
  - **Done when:** tests with made-up data pass: the screen's company and its people come first; another rep's companies stay out unless I called them; teammates are in; the list stops at `name_hints_max`; and a second ask inside 5 minutes reads nothing new.
- [ ] **T1-2. Learned names** (backend, with the plan's one migration).
  - The migration `0026_v23_names_and_hubspot_user`: the learned names table, and the accounts' "No HubSpot user" mark.
  - The routes of contract part 2. Settings lists the learned names, with Remove.
  - **Done when:** tests pass: a pair is saved once; the same words for two companies give both; an Admin removes one; a Viewer can't save one; and the migration goes up and down cleanly.
- [ ] **T1-3. The command step finds better** (backend).
  - Learned names first, then the close-name match, then a live HubSpot search, which reads a found company into our copy.
  - `unclear` when the words don't make a command (choice 4).
  - **Done when:** FakeClaude and fake HubSpot tests pass: "North Wind" with a learned pair finds Northwind; a company only in HubSpot is found and is then in our copy; nothing anywhere gives `can_add`; garbled words give `unclear`; and none of these writes to HubSpot.
- [ ] **T1-4. Adding a company** (backend). Contract part 4, through the writer's duplicate check.
  - **Done when:** tests pass: a close name in HubSpot shows in `similar`; the same name and city gives 409; writing off gives 409; a repeated key makes one company; the new company is in our copy at once; and each write is a row in `core.hubspot_writes`.
- [ ] **T1-5. Hearing on the website.**
  - The hint list loads with the voice bar (after the page is idle, or on the first V), and the name fix uses it on every page.
  - In on-device mode, only if S1 picked it, the hints go to the speech service.
  - After a send where the rep picked the company by hand, the card saves the learned name.
  - Hold V (choice 6).
  - **Done when:** tests with a fake mic and a fake voice tool pass: hints reach the tool only in on-device mode; "Vitara" becomes "Vitera" on Today, not only on the company's page; a hand-picked company saves a learned name only after the send; hold V stops on release, and a tap works as before. The first visit grows by 1 kB at most.
- [ ] **T1-6. The card when a name goes wrong** (website).
  - The unclear stop in the bar. "We'll use it" for a company new in HubSpot. "Add to HubSpot", with the similar names.
  - **Done when:** tests cover each Part 1 row of "Words for when things go wrong", and Al-khair has seen it.
- [ ] **T1-7. Part 1 check.** Backend: ruff, ruff format, mypy, the fast tests, the Companies tests and the contract gate (`RUN_GATES=1`). Website: lint, types, the tests, the build and `node scripts/bundle-report.js`. The `design-review` skill on the bar and the card.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 1 Log

- Nothing yet.

## Part 2: alerts

**Progress:** 0 of 5. Needs S2 first.

- [ ] **T2-1. A reminder on every task** (backend, `core/hubspot/activities.py`). Choice 7, as S2 found it.
  - **Done when:** tests pass: a pre-read task, a teammate's follow-up and "add a task for Sam" get the 2 minute reminder; my own task gets 9:00 am on its day; a reminder never falls in the past; and the time is in milliseconds, as HubSpot wants.
- [ ] **T2-2. FYI tasks for the company's owner** (backend). Choice 8, after a call lands in HubSpot.
  - **Done when:** tests pass: a call by someone who isn't the owner makes one FYI task for the owner, linked to the company; the owner's own call makes none; a company with no owner makes none; the switch off makes none; and a resend makes no second one.
- [ ] **T2-3. Pre-reads on Today, and the nudge** (backend).
  - `pre_reads` in Today (contract part 5), found by HubSpot user or by email address.
  - The 4:30 pm nudge as a job that is off until switched on (choice 10).
  - **Done when:** tests pass: a pre-read sent to me by HubSpot user or by email shows; one for a past meeting doesn't; the nudge emails only people with calls waiting, once a day; and with email off it sends nothing and logs why.
- [ ] **T2-4. Alerts on the website.** Today's "Pre-reads for you" part, the send dialog's line (choice 11), and the three settings on the Settings page.
  - **Done when:** tests pass, and Al-khair has seen it.
- [ ] **T2-5. Part 2 check.** As T1-7.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 2 Log

- Nothing yet.

## Part 3: staff without HubSpot

**Progress:** 0 of 5.

- [ ] **T3-1. The HubSpot user mark** (backend). Contract part 6, with the column from T1-2.
  - "No HubSpot user" starts with the Call logs tick (choice 13).
  - **Done when:** tests pass: a new person with neither choice gives 422; "No HubSpot user" gives `none` and Call logs only; an old account with no link gives `not_set`; and linking later gives `linked`.
- [ ] **T3-2. Tasks and calls for them** (backend). Choices 14 and 15.
  - **Done when:** tests pass: a task for myself, as `none`, gives 409 `no_hubspot_user` and writes nothing; "for Sam" still works; a call's follow-up with no teammate gives 409; a call by a `none` account starts "Logged by Jo Sample, Designer, in Contour." and has no owner; and a `linked` account's call has no such line.
- [ ] **T3-3. Today for them** (backend). `tasks_state: none` (choice 16).
  - **Done when:** tests pass: a `none` account's Today asks HubSpot nothing and shows calls and pre-reads; and a `not_set` account still gets the link message.
- [ ] **T3-4. The website.**
  - People: the "HubSpot user" field, the suggested name, and "Not set".
  - Today shows only the parts that apply.
  - "Open in HubSpot" is hidden for `none`.
  - The call card's "For" box, and the words.
  - **Done when:** tests cover each, at 1440 and 390px, and Al-khair has seen it.
- [ ] **T3-5. Part 3 check.** As T1-7, plus the `security-check` skill on T3-1 and T3-2.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 3 Log

- Nothing yet.

## Part 4: the Assistant's feel

**Progress:** 0 of 6. Website only. Each item names where it came from.

- [ ] **T4-1. V where it's needed.**
  - **V over call prep,** with the prepped company as the default. Right after a call is when a rep needs V most. (PLAN-V22 Log: V does nothing while call prep's panel is open.)
  - **"Use V to speak"** on or off, with the sliding switch in the profile menu, kept in this browser. "Speak (V)" says "Speak" when it is off. WCAG 2.2 rule 2.1.4 asks for this: a one-letter shortcut must be able to be switched off. (This chat.)
  - **Done when:** tests pass: V over call prep opens the bar with that company; V in a prep box still types a "v"; with V off, V does nothing and "Speak" still works; and the switch stays after a reload.
- [ ] **T4-2. The card.**
  - **Typing in every box of the call card,** not only by voice. PLAN-V22 says typing always works wherever voice does. (PLAN-V22 Log: the call card is read-only.)
  - **"Later" instead of "Cancel" on a call,** and Esc does the same: "Kept in Call logs, to send with the others." It fits Levi's 9 Nov ask to confirm in one go after about 10 calls. (PLAN-V22 Log: Cancel already keeps the call.)
  - **"New pre-read" from a command opens its dialog,** with the company filled in. (PLAN-V22 Log: it opens Meetings and stops there.)
  - **Done when:** tests pass: each box of the call card takes typing; Esc and "Later" keep the call in To confirm, with its words; and "make a pre-read for Sample Logistics" with no meeting ahead opens New pre-read with the company filled in.
- [ ] **T4-3. Today.**
  - **"Add task" and "Email the team" buttons** that open the card empty. They need no AI, so they work when the AI is off or busy. Ctrl+K finds them too. (This chat.)
  - **After L, the focus goes back to the row.** (PLAN-V22 Log: it goes to the page.)
  - **"Try saying" uses your own next company,** the first company in your hint list, instead of "Acme". (This chat.)
  - **Done when:** tests pass: both buttons open the card empty with the AI off; Ctrl+K finds them; after L, the focus is on the row; and "Try saying" names the first company of the hint list.
- [ ] **T4-4. Phone and speed.**
  - **On a phone, the pinned Speak button hides** while the bar is open. (PLAN-V22 Log.)
  - **The card's first frame takes under 50ms at 4x CPU slowdown,** down from 110 to 150ms. Draw the card a moment later, in a React transition, as PLAN-V22's check proposed.
  - **Done when:** tests pass, and the Log has the 4x CPU numbers from the production build.
- [ ] **T4-5. Reaching everything.**
  - **A "Skip to the page" link,** so a keyboard user doesn't Tab 18 times before Today's rows. (PLAN-V22 Log.)
  - **Toast buttons 44px tall on touch screens,** app-wide. They are 32px now. (PLAN-V22's review proposed it.)
  - **A real screen reader pass** (NVDA on Windows, **TBC**): it reads "Listening", the read-back, the unclear stop and the alerts. PLAN-V22 checked these from the code only.
  - **Done when:** tests pass for the link and the buttons, and the Log has the screen reader pass.
- [ ] **T4-6. Part 4 check.** As T1-7, plus the `speed-check` skill. Each screen at 1440, 1280, 768 and 390px, light and dark, by keyboard only, and with reduced motion.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 4 Log

- Nothing yet.

## Merge, checks and going live

- [ ] **M1. Merge** (`merge v23`, on Al-khair's word). Make the contract and the website's types again. Run the full backend and website checks, the `merge-check` skill and a fresh `review-agent`. Then move `master` to `plan-v23` with `git merge --ff-only`. If it won't fast-forward, stop and ask.
  - **Done when:** everything passes and `master` has moved.
- [ ] **M2. Deploy** (`deploy v23`). Push `master` and deploy to App Platform. The migration runs on deploy.
  - **Done when:** the live site answers on the new version, and the Log says so.
- [ ] **M3. The live steps,** each on Al-khair's word.
  1. Email on: the Resend key, a sender address and the DNS records (waits on W3). Then one team email to Al-khair's own address.
  2. One pre-read sent to Al-khair and one teammate: a HubSpot alert for each, and the email.
  3. One call from a test account with "No HubSpot user", on the test company (**TBC**: which company): the "Logged by" line, and the owner's FYI task.
  4. "Add to HubSpot" with a made-up company, then delete it in HubSpot.
  - **Done when:** each check is in the Log.
- [ ] **M4. The docs.** `CLAUDE.md` (this plan's line), the map in `engine/AGENTS.md`, `engine/DESIGN.md` (hold V, the V switch and the unclear stop, on Al-khair's OK), and a short team note written with `/plain`, sent on Al-khair's word. The note covers how to use V and hold V, and how each person switches on task alerts in their own HubSpot notification settings (**TBC**: the exact place). Then a save to the AI Brain.
  - **Done when:** the docs are in, and the note is sent.

## Waiting on

- **Levi:**
  - **W1. His OK for what reps say or type to go to Claude** (from PLAN-V22). The AI sort is already on live.
  - **W2. That the voice goes to Google or Microsoft** (Al-khair said yes on 19 Nov). With hints in on-device mode, neither the voice nor the names leave the laptop.
  - **W3. Email:** access to Contour's Resend account, a sender address (like `hq@contourinteriors.com.au`, **TBC**), and DNS records on contourinteriors.com.au. The code names Dawn or IT for the DNS (**TBC**).
  - **W4. FYI tasks for owners:** one per call, none, or one a day.
  - **W5. Staff without HubSpot:** whose name their calls go under; whether they may change company fields; and whether reps need to give them tasks (then a task kept in Contour, or a Teams message, in a later plan).
- **Al-khair:** S1 and S2, a look at each screen, the merge, the deploy, the live steps and the team note.

## Risks

- **On-device mode isn't ready for Australian English, or is slow.** S1 finds out first. The fix and learn layers work without it.
- **A wrong learned name.** It is saved only after a send, it changes one set of words only, and an Admin can remove it.
- **Too many alerts.** FYI tasks could flood a busy owner. A switch turns them off, and Levi decides (W4).
- **Duplicates from "Add to HubSpot".** The duplicate check, the similar names and the card catch most of them.
- **V over call prep fires while typing.** The typing check still rules: V in a box types a "v".
- **HubSpot ignores the reminder for API tasks too.** S2 finds out before Part 2 is built. Then email and Today carry the alerts until a later plan (Teams, or web push).

## Not in this plan

- **The Assistant does more** (the next plan):
  - several actions in one sentence (Levi's 18 Nov example had a call, a task and an email);
  - questions answered in the bar, like "When did we last call Northwind?";
  - deal actions, like "move Northwind to proposal". They need Levi's list of fields and HubSpot's permission to change deals.
- **Microsoft 365:** Teams alerts, Outlook meetings, email from the rep's own mailbox, and Teams transcripts. Its own plan, once Contour's Microsoft admin gives access.
- **Web push alerts** from the installable app.
- **A paid speech service** (Azure AI Speech in Australia, or Deepgram), only if S1 fails.
- **Calls that log themselves** from the phone system (**TBC**: what reps dial with), HubSpot workflows (they need a Professional plan; Contour's plan is **TBC**), Levi's daily team summary, and a PDF of the pre-read.
- **The pre-read's format** stays as it is: a HubSpot task for each person and a note on the company, never a Word file.

## Log

- 19 Nov 2026: written from Al-khair's chat on 19 Nov (the second session that day). Nothing built. Not committed: S0 copies it into `plan-v23`. `CLAUDE.md` gets its line at S0, so the main folder stays clean for `merge v22`.
