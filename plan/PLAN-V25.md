# A smarter Assistant: plan, version 25

This plan makes the Assistant and the mic guess better and ask less. When something is unclear, the card puts its best guess first, says why, and takes it with one key, one word or one tap. It can start from the person, not only the company. It suggests what you didn't say, like a due day or a follow-up. A no-answer logs in one line, and every call gets HubSpot's call type. The mic listens for Australian names, places and office words, and catches how they're said. Nothing new is paid: most of it is code reading what Contour already copies from HubSpot. One session builds it, in five parts, one after another.

**TBC** means to be confirmed.

- **Status:** written on 22 Nov 2026 from Al-khair's chat, and checked against it the same day. Approved by Al-khair on 22 Nov (`implement v25`), and being built on `plan-v25` in `../contour-v25`.
- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 23 Nov 2026.
- **Progress:** every build step is done except T4-3, which waits on PLAN-V24's S1. The part checks (T1-3, T2-3, T3-4, T4-4, T5-2) run together before M1.
- **Sources:**
  - Al-khair's chat on 22 Nov 2026, after the PLAN-V24 deploy;
  - the code on `master` (`1d7a5ce`), read on 22 Nov;
  - a read-only count of HubSpot's calls from the last 12 months, on 22 Nov (counts only, no names or notes);
  - HubSpot's call type field, read on 22 Nov (its options only);
  - HubSpot's knowledge base, read on 22 Nov: logging a call, the calls page, and automatic links;
  - PLAN-V24's own test numbers for Moonshine and Whisper (Part 4 Log).
- **Comes after:** [PLAN-V24.md](PLAN-V24.md), live since 22 Nov 2026. Its S1, S2, M3 and M4 are still open. This plan's Part 4 waits on S1 and S2.

## Why: how the team logs calls

HubSpot holds 17,418 calls from the last 12 months, about 1,800 a month since June 2026. Counted on 22 Nov:

- **One person and their company:** 99% of calls are linked to exactly one person and that person's company. Half are also linked to a deal.
- **Mostly no answer:** 75% are "No answer" and 23% "Connected".
- **One call type:** 96% are "Prospecting Call" and 2% "Follow Up Call".
- **Few words:** 54% have no notes. When there are notes, the median is 10 words.
- **Typed by hand:** 99% are typed into HubSpot's website. No phone system logs them.

So the usual call is a quick no-answer to one person. Contour today is built for the rarer long call note: it needs the company first, every call takes the whole card, and it never sets the call type.

To be used, Contour has to be quicker than HubSpot's own Log call. There, a rep opens the person, presses Log call, picks the outcome and the type, and saves.

## Go signals

| Say | What it does |
|---|---|
| `implement v25` | Builds Part 1 (smart choices), Part 2 (start from the person), Part 3 (fill the gaps), Part 4 (the Australian layer), then Part 5 (a short memory) |
| `merge v25` | Checks everything, then moves `master` to `plan-v25` |
| `deploy v25` | Pushes `master`, deploys, and does the live test with Levi (M3) |

- Part 4 needs PLAN-V24's S1 and S2 first. If they aren't done when Part 4 comes, the session builds Part 5 and comes back to Part 4.
- Each screen waits for your look. Pushes and deploys happen only on your own word in chat.

## Decided in chat (22 Nov)

These are Al-khair's answers. They are fixed for this plan.

1. **Smart, not more screens.** The card guesses what's likely, suggests one answer with its reason, and asks only when it's unsure.
2. **Unclear means a suggestion or a short question, never a blank box.** This goes for a company, a person, a teammate, a meeting, and a task's day or subject.
3. **The person comes first.** A call is logged on the person you spoke to, with their company and deal, as HubSpot does and as the team logs 99% of calls.
4. **No Whisper for now.** Moonshine stays the model on the device, and Whisper base stays the backup that PLAN-V24's S2 can pick (its choice 23). In PLAN-V24's test on this laptop, Whisper took 3.5 s for a short command, against 0.25 to 0.35 s for Moonshine, because it always works through 30 seconds of sound.
5. **Australian, but not only.** The speech engines stay general English. An Australian layer of keywords and pronunciation sits on top.
6. **The look follows DESIGN.md.** One suggestion with its reason, at most 3 choices plus Search, the same look for everything unclear, and tap, keys and voice for each.
7. **Nothing new to pay,** as PLAN-V24 decided on 21 Nov.

## Words used here

- **Suggestion:** the card's one best guess, with its reason. Enter, "yes" or a tap takes it.
- **Reason:** a few plain words on why, like "You meet them at 2 pm."
- **Sure, likely, unsure:** how confident code is. It sets what the card does (choice 1).
- **Quick log:** a call that is only an outcome, like "No answer", logged in one line with the hold and Undo, and no card.
- **Call type:** HubSpot's field "Call and meeting type" (`hs_activity_type`).
- **Word list:** Australian places and office words, with the team's names, that the mic listens for.
- **Sounds like:** matching a heard word to a name by its sound, not only its spelling.
- **Our copy:** what the daily sync copies from HubSpot: companies, people, deals, and the calls of the last 2 years.

## What exists already (so nothing is built twice)

All of it is on `master` (`1d7a5ce`). Website paths are under `engine/frontend/src/apps/`, and backend paths under `engine/backend/`.

| Need | Already there | This plan changes |
|---|---|---|
| Choices for a company | `apps/companies/assistant_find.py`: the company on screen, learned names, our copy, then HubSpot's own search. Two or more give choices, ordered by how close the name is. The card shows "Which Sample?", one button each, with industry and city (`assistant/card/company.tsx`). "the second one" picks by voice (`card/choose.ts`). | Ordered by what's likely, with one suggestion and its reason |
| The person | `apps/companies/store.py` `people_of`: the company's people in our copy, newest activity first. Found by name only inside the found company (`assistant_find.py`). | Also found without the company (Part 2) |
| A task's day | `assistant_find.py` `task_due`: never a weekend or the past. A day that can't be read becomes the next working day, with "Check the date: ..." (`assistant_card.py`). | A suggested day, with two other choices |
| Unclear words | The `unclear` answer stops before the card; Claude's `unsure` line shows on it (`assistant_form.py`) | Nothing |
| The call sent to HubSpot | `core/hubspot/activities.py` `_create_of`: time, title, notes, outcome, outbound, owner. Linked to the company, the person if picked, and the deal if any. No call type. | Sets the call type (Part 3) |
| Sending | The card, then the 5-second hold with Undo (`assistant/card/hold.tsx`) | A quick log skips the card for an outcome-only call (Part 3, **TBC**) |
| The name fix | `companies/call-notes/mic/name-fix.ts`: spelling only. Same first letter, at most 1 letter off (2 for 8 letters or more), capitalised words, names only. | Sounds like, and the word list (Part 4) |
| Name hints | Chrome's on-device mode with the names as phrases: built and off (`ON_DEVICE_HINTS`, `voice-tool.ts`), waiting for PLAN-V24's S1 | On, if S1 agrees, with the word list (Part 4) |
| Speech language | `en-AU` for everyone (`SPEECH_LANG`, `voice-tool.ts`) | A choice per person, `en-AU` by default (Part 4) |
| Learning | Learned names (PLAN-V23, `assistant_learned.py`): a company found by hand teaches the words heard, for the team | Also learns from a suggestion turned down (**TBC**) |
| Data for guesses | Our copy: companies (owner, last contacted, city), people (last activity), calls (who, when, outcome), deals (stage, close date). Today's meetings, as Today shows them. The page on screen. | Read by the ranking |
| A conversation | Each turn is read alone (PLAN-V24, "Not in this plan") | A short memory (Part 5) |

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts.

**Smart choices (Part 1):**
1. **Three levels.**
   - **Sure:** the card uses it at once, with Change and Undo (DESIGN.md, "Act at once, undo after"). Sure means the company on screen when the words fit it, a learned name, or one match that is also the rep's own company.
   - **Likely:** one suggestion with its reason. Enter, "yes" or a tap takes it. Likely means the top choice has a signal the others don't, like a meeting today.
   - **Unsure:** up to 3 choices plus Search, as "Which Sample?" works today.
2. **What makes a guess likely, strongest first (TBC):** on screen; a meeting with the rep today or tomorrow; a learned name; the rep's own company; called by the rep in the last 30 days; an open deal; HubSpot's last contacted date; then how close the name is.
3. **One reason, the strongest,** in plain words: "On screen.", "You meet them at 2 pm.", "Yours.", "You called them on Tuesday.", "Open deal." (DESIGN.md principle 1, "Show the work")
4. **At most 3 choices, plus Search.** Each shows the one detail that tells it apart: the city, the owner, or the last call. (principles 02 #15; 01 #19)
5. **One part for every unclear thing:** the company, the person, a teammate, a meeting and a day. (DESIGN.md principle 5)
6. **Three ways to answer:** a tap; the keys 1, 2, 3 and Enter; or voice: "yes", "the second one", or a name. Send stays the card's one Navy button, and Enter goes to an open choice before it sends, as now. (DESIGN.md principle 7)
7. **Plain words and the house look.** Never "AI", "smart" or a sparkle. The 10px corner, never a pill. The suggestion in normal text, its reason in the quieter colour. The highlight slides between choices (`layoutId`), and with reduced motion it simply moves. (DESIGN.md, "Words on screen", "Motion" and "Banned")

**Start from the person (Part 2):**
8. **A person named with no company** is searched among the people of every company the rep can see, in our copy. "Log a call with Jo Sample" suggests "Jo Sample at Northwind?"
9. **People are ranked** by the rep's own companies, calls with that person in the last 30 days, then last activity.
10. **The company and the open deal come from the person.**
11. **A person found nowhere** opens the card's people search. A company name heard with it still gives "Needs a company", as now.

**Fill the gaps (Part 3):**
12. **The call type on every call.** "Prospecting Call" by default, and "Follow Up Call" when the rep says so. "Agent/Networking Phone Call" when the rep says "networking call". It shows on the card and changes by voice or tap. When the default should be "Follow Up Call" is **TBC with Levi**.
13. **A clear task.** A task that's unclear gets a suggestion, not a blank box (**TBC with Levi**):
    - no day said: the next working day, as today's rule does, with "In a week" and "Pick a day" beside it;
    - no subject: one from the call, like "Follow up with Jo Sample";
    - "for Sam" with two Sams on the team: Part 1's choices.
14. **A follow-up nudge.** A "Connected" call with no follow-up gets "No follow-up yet. Add one for {day}?" Not for "No answer" (**TBC with Levi**).
15. **A quick log.** A call that is only an outcome (No answer, Left voicemail, Busy or Wrong number), with a sure person and company, skips the card. The hold's toast says exactly what goes, and Undo opens the card. Any words, follow-up, field change or doubt still opens the card.
    - This bends DESIGN.md principle 3 ("a preview shows before you send"): the toast is the preview. **Al-khair decides** (A2).

**The Australian layer (Part 4):**
16. **The word list:**
    - places: the cities and suburbs in our copy's company addresses;
    - office words: fitout, NLA, CBD, tenancy, sqm and "make good" (**TBC with Levi**);
    - the team's names, which the hint list holds already.
    It goes to Chrome's hints when they're on, and to the name fix, which runs on every engine.
17. **Sounds like.** The name fix also matches by sound, with today's guards: capitalised words, distinctive words, never an everyday word. A short "said like" list sits beside it, like "Pran" for Prahran, and grows from the team's corrections (**TBC**).
18. **Chrome's hints on,** if S1 shows Chrome's on-device speech works for `en-AU` on the team's laptops.
19. **A speech language per person** in the profile menu. English (Australia) stays the default, beside English (UK), (US), (India) and (New Zealand) (**TBC**). It's kept in this browser, and only the browser's service uses it. The model on the device stays English only.
20. **No Whisper for now.** PLAN-V24's S2 compares Moonshine and Whisper base with the word list included.

**A short memory (Part 5):**
21. **The last turn is remembered** for the conversation: its company, person and card. So "same company", "her", "them" and "and Jo too" work. Code keeps it. Claude gets only the last turn's names as heard (**TBC**), never the whole talk.

## Words on screen

The words are **TBC** at Al-khair's look.

| When | Words on screen | Buttons |
|---|---|---|
| A likely company | "Sample Logistics? You meet them at 2 pm." | Use it (Enter), Not this one |
| Unsure | "Which Sample?", with up to 3 choices | 1, 2, 3, Search |
| A sure pick, used at once | "Sample Logistics. On screen." | Change, Undo |
| A person with no company | "Jo Sample at Northwind? You called her on Tuesday." | Use it (Enter), Not this one |
| A person found nowhere | "There's no 'Jo Sample' in HubSpot. Say the company, or pick the person." | The people search |
| A quick log | "Logging No answer with Jo Sample, Northwind." | Undo |
| A follow-up nudge | "No follow-up yet. Add one for Friday?" | Add it, No |
| A day not said | "Due Monday?" | In a week, Pick a day |
| A task with no subject | "Follow up with Jo Sample?" | Use it, Type it |

## What it costs

- **To build:** time only.
- **To run:** nothing new.
  - The ranking, the person search and the word list are code on our copy. They make no Claude request.
  - The person search may fall back to HubSpot's own search, one free request, as companies do (**TBC**).
  - Part 5 adds a few words to each command's Claude request: well under a tenth of a cent, as now.
- **New packages:** none planned. A sound key is small enough to write in code (**TBC**).

## Who builds it

One session builds every step, in order: S0, Part 1, Part 2, Part 3, Part 4, then Part 5. The parts touch the same find, card and mic files, so two sessions would wait on each other.

- **Backend steps** (the ranking, the person search, the call type, the memory) are `backend-agent` work, with the `api-change` skill, and `db-migration` for the call type.
- **Website steps** (the suggestion part, the quick log, the menu rows) are `frontend-agent` work, with the `ui-build` and `design-review` skills.
- **One migration,** `0028_v25_call_type`: `call_notes` gains the call type (**TBC**).
- **The contract changes:** a choice gains its level and reason; a call gains its call type; a command gains the last turn (Part 5). Make the website's types again after each.
- **M1's independent check** is a fresh `review-agent` with the `merge-check` skill.

## How to work this plan

As [PLAN-V24](PLAN-V24.md)'s "How to work this plan", with these changes:

- **The copy:** `git worktree add ../contour-v25 -b plan-v25 master`.
- **Ports and database:** backend `API_PORT=8121`, website 5291, database `leadfinder_v25` (a copy of the dev database at `0027_v24_call_needs_company`), test suffix `_v25`. Leave 8000, 5173, and older plans' ports (8041 to 8111, 5211 to 5281) alone.
- **No Claude key and no HubSpot key** in the copy. Blank `ANTHROPIC_API_KEY` for the process.
- **Made-up names only** in tests and in this plan, like "Sample Logistics Pty Ltd", "Northwind" and "Jo Sample". Check any new example name against our copy before a commit, with a count only (see the `github` skill, "Never on GitHub").
- **The main folder** needs `npm ci` in `engine/frontend` before its own app can load the voice model (it wasn't run after PLAN-V24's merge).

## Before the build starts

- [x] **S0. The branch and the copy.** Done 22 Nov 2026 (this plan's first commit on `plan-v25`).
  - Make `plan-v25` from `master` in `../contour-v25`. Its first commit holds this plan.
  - Add the plan's line to the plan list wherever it is when S0 runs. Al-khair's move of the list from `CLAUDE.md` to `AGENTS.md` is still uncommitted in the main folder: ask first.
  - Make the database `leadfinder_v25`, and check the newest migration (`0027`).
  - **Done when:** `plan-v25` holds this plan, and the fast backend tests and the website tests pass on it.
- [ ] **S1. Levi's answers** (**TBC with Levi**), about 15 minutes:
  - when a call's type should be "Follow Up Call" by default (choice 12);
  - whether a quick log may skip the card (choice 15);
  - the suggested days for a task (choice 13), and whether a connected call always needs a follow-up (choice 14);
  - which office words go in the word list (choice 16).
  - **Done when:** the Log has his answers, and choices 12 to 16 match them.
- [ ] **S2. Check the live copy** (read-only, counts only): how many people and calls our copy holds, and how old the newest are. Part 2 and choice 2's "called in the last 30 days" need them.
  - **Done when:** the Log has the counts.

## Part 1: smart choices

- [x] **T1-1. Rank and say why.** Done 22 Nov 2026 (`6cbf12c`). (`apps/companies/assistant_find.py`, and a new file beside it for the ranking). Choices 1 to 3.
  - **Done when:** tests with made-up companies pass: each signal puts its company first in the order of choice 2; each choice carries its level and one reason; the three levels come out as choice 1 says; a learned name stays sure; and nothing new is asked of Claude. The contract and the website's types are made again.
- [x] **T1-2. The suggestion part.** Done 23 Nov 2026 (`9f4906c`). (`assistant/card/`). Choices 4 to 7.
  - **Done when:** tests at 1440 and 390 px pass: a likely pick shows one suggestion with its reason; Enter, "yes" or a tap takes it; "Not this one" shows up to 3 choices and Search; the keys 1 to 3 pick; a sure pick is used at once with Change and Undo; a screen reader hears the suggestion once; and the same part serves a company, a person, a teammate and a meeting.
- [ ] **T1-3. Part 1 check.** Website: lint, types, tests, build, `node scripts/bundle-report.js`. Backend: ruff, mypy, the fast tests and the Companies tests. The `design-review` skill on the card.
  - **Done when:** all pass, the first visit grew by 1 kB at most, and the numbers are in the Log.

## Part 2: start from the person

- [x] **T2-1. Find a person without the company.** Done 22 Nov 2026 (`70f6e07`). (`assistant_find.py`, `store.py`). Choices 8 to 10.
  - **Done when:** tests pass: "Log a call with Jo Sample" with no company finds her, her company and its open deal; two Jo Samples give choices with their companies; ranking follows choice 9; a person the rep can't see is never offered; and a company said with the person still wins.
- [x] **T2-2. The card for a person found first.** Done 23 Nov 2026 (`9f4906c`). (`assistant/card/`). Choice 11.
  - **Done when:** tests pass: the suggestion reads "Jo Sample at Northwind?"; taking it fills the company and the person; a person found nowhere opens the people search; and "Needs a company" works as before.
- [ ] **T2-3. Part 2 check.** As T1-3.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 3: fill the gaps

- [x] **T3-1. The call type.** Done 23 Nov 2026 (`6f401c8`, `9f4906c`), with no migration (see the Log). (`core/hubspot/activities.py`, the call notes routes, the migration, the card). Choice 12.
  - **Done when:** tests with the fake HubSpot pass: every call sent carries `hs_activity_type`; the default is "Prospecting Call"; "make it a follow-up call" changes it; a type HubSpot doesn't list is refused; and the migration goes up and down cleanly.
- [x] **T3-2. A clear task and a follow-up nudge.** Done 23 Nov 2026 (`6f401c8`, `9f4906c`). (`assistant_card.py`, the card). Choices 13 and 14.
  - **Done when:** tests pass: a task with no day suggests one, with two other choices; a task with no subject suggests one from the call; two teammates with the same name give choices; a connected call with no follow-up shows the nudge; "yes" adds it; and a no-answer gets no nudge.
- [x] **T3-3. The quick log.** Done 23 Nov 2026 (`6f401c8`, `9f4906c`). (`assistant/card/`, `hold.tsx`). Choice 15, after Al-khair decides A2.
  - **Done when:** tests pass: "No answer, Jo Sample" with a sure person sends after the hold with no card; the toast names the outcome, person and company; Undo opens the card; and words, a follow-up or any doubt still open the card.
- [ ] **T3-4. Part 3 check.** As T1-3, plus the contract gate (`RUN_GATES=1`) and the `security-check` skill on the HubSpot write.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 4: the Australian layer

Needs PLAN-V24's S1 and S2 first.

- [x] **T4-1. The word list.** Done 23 Nov 2026 (`6f401c8`, `b878c1f`). (a list file beside `name-fix.ts`, and the hint list). Choice 16.
  - **Done when:** tests pass: the places come from our copy; the office words come from the list; the name fix and Chrome's hints both get them; and the first visit doesn't grow.
- [x] **T4-2. Sounds like.** Done 23 Nov 2026 (`b878c1f`). (`companies/call-notes/mic/name-fix.ts`). Choice 17.
  - **Done when:** tests pass: "Pran" becomes Prahran; a name said the Australian way is fixed; no everyday word ever changes ("shall" never becomes "Shell"); and every fix still shows once on the card.
- [ ] **T4-3. Hints on, and a language per person.** (`voice-tool.ts`, the profile menu). Choices 18 and 19.
  - **Done when:** tests pass: the hints go on only where S1 said yes; the language row lists the choices; English (Australia) is the default; and the choice stays after a reload.
- [ ] **T4-4. Part 4 check.** As T1-3.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 5: a short memory

- [x] **T5-1. The last turn.** Done 23 Nov 2026 (`6f401c8`, `01a1dce`). (the bar's session, the command route, `assistant.py`). Choice 21.
  - **Done when:** tests pass: "same company" uses the last turn's company; "and Jo too" adds a second call with the same company; the memory ends with the conversation; and Claude gets no more than the last turn's names.
- [ ] **T5-2. Part 5 check.** As T1-3.
  - **Done when:** all pass, and the numbers are in the Log.

## Merge, checks and going live

- [ ] **M1. Merge** (`merge v25`, on Al-khair's word). Full checks, the `merge-check` skill and a fresh `review-agent`. Then `git merge --ff-only plan-v25` in the main folder.
- [ ] **M2. Deploy** (`deploy v25`). Push `master` and deploy. The migration runs on deploy.
- [ ] **M3. The live test with Levi:**
  1. A company said loosely: the right one comes first, with its reason.
  2. "Log a call with" a person only: their company is found.
  3. Three no-answers in one conversation, as quick logs.
  4. A task with no day: the suggested day.
  5. Australian places and names in his own words: what the mic got wrong.
- [ ] **M4. The docs.** The plan list, `engine/AGENTS.md`, `engine/DESIGN.md` (the suggestion part, on Al-khair's OK), and a short team note written with `/plain`, sent on Al-khair's word.

## Waiting on

- **Levi:** S1's four answers (choices 12 to 16), and PLAN-V24's W2, still open.
- **Al-khair:**
  - ~~**A1.** Approve this plan, or change it.~~ Approved 22 Nov (`implement v25`).
  - ~~**A2.** May a quick log skip the card?~~ Yes (22 Nov): the toast is the preview, and Undo opens the card.
  - **A3.** PLAN-V24's S1 and S2, before Part 4. Still open on 22 Nov: Al-khair said to build T4-1 and T4-2 now, and leave T4-3 until S1 is done.

## Risks

- **A confident wrong guess.** Only clear cases are sure. The reason shows, Change and Undo are there, and each correction teaches.
- **Two people with the same name.** They show as choices, each with their company.
- **A day-old copy.** The sync is daily, so a person added today may be missing. HubSpot's own search is the fallback (**TBC**).
- **Sounds like changes a real word.** The name fix's guards stay, with the everyday-word list.
- **A misheard outcome in a quick log.** The toast names it, and Undo is there for 5 seconds.

## Not in this plan

- Whisper as the default (PLAN-V24's S2 may still pick it).
- Whisper for long call notes only, a middle path, if S2 shows it hears Australian names better. That's for a later plan.
- Talking back: spoken questions and answers.
- Logging several calls in one line ("No answer from Jo, Sam and Lee").
- A phone dialer, or logging from the phone's own call list.
- A paid speech service, or training our own speech model.

## Log

- 22 Nov 2026: drafted from Al-khair's chat: smart suggestions with a reason, start from the person, fill the gaps, a quick log with the call type, the Australian layer of keywords and pronunciation, and no Whisper for now. Nothing built yet.
- 22 Nov 2026: checked against the chat, on Al-khair's ask. Added the "never a blank box" rule, the person-first decision, Whisper's numbers, a suggested subject for a task, and the house look for choices.
- 22 Nov 2026, S0: Al-khair's answers before the build: A1 approved; A2 yes (a quick log may skip the card); Part 4 builds T4-1 and T4-2 now and leaves T4-3 until PLAN-V24's S1; the plan's line goes in `CLAUDE.md`, where the list is on `master` (his move to `AGENTS.md` stays uncommitted in the main folder). `plan-v25` made from `master` (`ff0f658`) in `../contour-v25`. Database `leadfinder_v25` copied from `leadfinder_v24`, at `0027_v24_call_needs_company`, the newest migration. Baseline: backend fast tests 3,558 passed and 28 skipped; the website tests pass.
- 22 Nov 2026, S0: HubSpot's call type options couldn't be read again from here (the connector lacks `crm.objects.calls.read`). The three types this plan names are used as their own values: **TBC**, checked with the app's key before `deploy v25`.
- 22 Nov 2026, T1-1 (`6cbf12c`): `assistant_rank.py` ranks matches by choice 2's signals, read from our copy in four small queries (no Claude request). How the levels read: one match is sure, as before (so no new question for the usual case); among several, the only one of the rep's own is sure (used at once, the others kept for Change), a signal only the top one has is likely, and none or a shared one is unsure. Reasons: "On screen.", "Picked for these words before.", "You meet them at 2 pm." (or "tomorrow at"), "Yours.", "You called them on Monday.", "Open deal.". The detail is the city, else "Owner: ...", else "Last call 12 Nov". At most 3 choices now, for companies, people, meetings and teammates. Teammates and meetings carry a level too (found sure, choices unsure). 14 new tests; 8 older ones changed for the new fields, the 3-choice cap and the ranked order.
- 22 Nov 2026, T2-1 (`70f6e07`): a call with a person and no company said searches every company's people in our copy (an inner join, so a company the rep can't open is never offered). Each choice brings its company. One that stands out is likely ("Jo Sample at Northwind Sample Pty Ltd? You called them on Monday."). The one on screen wins when it has the person, and gives way when it doesn't. The open deal follows the company when the call is sent, as it did (`one_open_deal`). The reason says "them", never "her": we don't know a person's pronouns. 7 new tests.
- 23 Nov 2026, T3-1 to T3-3, T4-1, T5-1 backend (`6f401c8`): the call type is kept in the call's card JSON (`call.call_type`), not a new column, so there is no migration 0028: a call's card already travels with it, and the batch reads it from there (`call_type_of`, Prospecting Call when none). A type HubSpot doesn't list is refused (422). Task suggestions: no day said gives the next working day as `due_level: likely`, with a week after; no subject gives "Follow up with {company}". The quick log is judged by code: an outcome only (No answer, Left voicemail, Busy, Wrong number), a sure company, a found person, no follow-up and no doubt. The last turn: "same company", "the same", "her", "them" and "too" use it; Claude gets only the names as heard (prompt `assistant-3`). The hint list gives up to 200 places from our copy's companies and offices. 9 older tests changed for `call_type` and the prompt version. Checks: ruff and mypy clean; the Companies and HubSpot activity tests 781 passed after the fixes; the hook's fast tests passed.
- 23 Nov 2026, T4-1, T4-2 website (`b878c1f`): the office words and a said-like list in `au-words.ts`; the name fix matches by sound the Australian way, only when one name sounds like the word, never for an everyday word.
- 23 Nov 2026, T1-2, T2-2, T3-1 to T3-3 website (`9f4906c`): built by two frontend agents and reviewed here. The call type is a Segmented choice on the call card and in Call logs' edit form. The quick log saves the call at once, holds 5 seconds with "Logging No answer with Jo Sample, Northwind." and Undo, waits up to 60 seconds for the sort (TBC), then sends as the card's Send does. **TBC:** the three call types' labels; a suggested day or subject doesn't stop a send; the quick log keeps the words, so the sort still asks Claude (a few seconds). Not yet seen in a browser.
- 23 Nov 2026, T5-1 website (`01a1dce`): the bar keeps the last turn until it closes and sends it with each command.
- 23 Nov 2026, checks so far: website lint 0 problems, types 0 errors, the build passes, the first visit 243 kB of JavaScript (gzip) in 41 files (the same as PLAN-V24). The full website test run was stopped twice by Claude Code for low memory (1.3 GB free of 15.6 GB); 511 of 514 tests in the 17 files it reached passed, and the 3 that failed pass now (2 needed the new `last_turn`, 1 timed out under the memory pressure). The full run, `RUN_GATES=1` and the `security-check` are still to run, before M1.
