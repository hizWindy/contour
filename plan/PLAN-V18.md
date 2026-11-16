# The Companies refresh: plan, version 18

This plan makes the Companies module clearer and nicer to use, from Al-khair's list of 16 Nov. "Activity" becomes "Call logs". Meetings shows everyone's meetings by default, with three filters and a Sync button. People see that AI drafts the pre-read, and the pre-read becomes a centered form. Companies sorts by last activity. Call logs gets a real mic with a quick mic check, and a call history. Call prep opens straight on the quick facts. Every part moves smoothly, like a well made iPhone app, and every failure says what happened and what to do. Three Claude sessions build it at the same time, in three tracks that never touch the same files.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code and every screen. Levi confirms the rules marked **TBC with Levi**.
- **Last updated:** 16 Nov 2026 (S0 done: `plan-v18` made from `master`; the tracks are starting).
- **Progress:** S0: 1 of 1. Track 1: 0 of 9. Track 2: 2 of 8. Track 3: 0 of 9. Merge and deploy: 0 of 3.
- **Sources:**
  - Al-khair's list of changes (16 Nov, in chat), and the chat about Meetings the same day: the empty Meetings page, the team switch, and the Sync idea;
  - the code on `master` (`c4ebe58`), read on 16 Nov;
  - [engine/DESIGN.md](../engine/DESIGN.md) and `design/principles/`;
  - [PLAN-V17.md](PLAN-V17.md) (call notes and the pre-meeting form).
- **Comes after:** PLAN-V17. Its tracks are joined into `master`, and the live site showed Meetings on 16 Nov. V17's mic steps (T3-2 and T3-4) move here, as T3-3 to T3-5. Its other open steps (M2, M4, M6, M8 and M9) stay in PLAN-V17.

## Go signals

Say one line to each session. The same line starts a track, and continues it later from the first step that isn't ticked. Saying a go signal counts as Al-khair's word for S0.

| Session | Say | What it does |
|---|---|---|
| Session 1 | `implement v18 track1` | The backend: Meetings filters and Sync, HubSpot teams, last activity, call history, and the words |
| Session 2 | `implement v18 track2` | The website: Meetings, the pre-read form, and the Companies list |
| Session 3 | `implement v18 track3` | The website: Call logs, the mic, the history, and call prep |
| Any one | `merge v18` | Joins the three tracks into `plan-v18`, checks everything, then moves `master` to it |
| Any one | `deploy v18` | Pushes `master`, deploys, and checks it live |

You'll also answer things along the way:
- **T3-3 needs you at the keyboard,** for about 15 minutes. You say 10 short notes, so we know which voice to text tool to use.
- **T1-2 uses the real HubSpot key.** It is free, reads only, and changes nothing. It tells us whether Contour uses HubSpot teams, and which HubSpot field holds "Last activity".
- **Each screen waits for your look.** The track marks it "built, waiting for a look" and carries on.
- **The "Questions for you" and "Choices made for you"** stand as written unless you change them before that step starts.
- **One paid check:** one real pre-read draft (about US$0.03), on your own word in chat.

## Questions for you

Your list left four things open. Each has a default that the tracks use until you answer.

1. **"make sure it"** under Meetings was cut off. What should it say? Until you answer, nothing is built for it.
2. **"Teams" in the Meetings filters.** This plan reads it as "the meetings of my HubSpot team". If you meant Microsoft Teams calls (online meetings), say so: the third filter then becomes "Online", which needs no HubSpot teams (each meeting already knows Teams or in person).
3. **Call prep's AI script.** Default: it starts by itself when the panel opens, as it does today after you pick a person. That costs up to US$0.25 a company, and nothing if the company was prepped in the last 7 days. The other way: the quick facts show, and the AI waits for a "Research this call" press.
4. **The mic on a phone.** Default: the mic button shows on laptops only. On a phone, the keyboard's own mic key does the talking, as today.

## In short

| You asked | What we build | Steps |
|---|---|---|
| "Activity" is misleading: call it "Call logs" | The menu, the page, its address, Ctrl+K, Home and Settings all say "Call logs". Old links still work. | T1-8, T3-2 |
| Meetings: buttons for all, mine and team | A three way switch: All, My meetings, My team. All is the default, so nobody opens an empty page. | T1-4, T2-3 |
| A Sync button on Meetings | Sync reads HubSpot's meetings now, and the page says when it last checked | T1-5, T2-3 |
| Tell people that AI drafts the pre-read | One clear line in New pre-read and on "Draft it", and three steps that fill while the AI works | T2-4 |
| The pre-read: centered, and like a HubSpot form | One centered form: a label above each field, a grid of facts, AI text you can type into, two required blanks, and a footer with Send | T2-5 |
| Companies: the newest first, not A to Z | The list sorts by last activity, newest first | T1-3, T1-6, T2-6 |
| A real mic button, and no Win+H | The mic opens a card that says "Speak now", with live bars and a 2 second mic check | T3-3 to T3-5 |
| A well designed history of call notes | A History tab: calls by day, search, filters, and each call opens in place | T1-7, T3-6 |
| Prep call shows the quick facts at once | No "Who are you calling?" screen first. The facts are there the moment the panel opens. | T3-7 |
| Smooth, iOS like motion | "How it should look and move" below, checked at 4x CPU slowdown | every screen step |
| Good error messages | "Words for when things go wrong" below, each with a test | T1-8, T2-7, T3-8 |

**What stays the same:**
- Nothing reaches HubSpot without a person's click on a preview. Sync only reads.
- The app never records the call itself. The mic listens only while its card is open, and no recording is kept.
- Email addresses and phone numbers never go to Claude.
- One connection to HubSpot (`core/hubspot/`). No project calls HubSpot itself.
- The spending limits. Every Claude request is logged and counts toward the daily limit.

**What it costs:**
- **To build:** time only, plus the one real pre-read draft (about US$0.03).
- **To run:** nothing new.
  - Sync reads HubSpot's free API: about 10 requests a press (**TBC**: T1-5 counts them).
  - The filters and the sort read our own copy.
  - Voice to text in the browser is free.
  - Call prep costs what it does today (question 3).

## Words used here

- **Track:** one session's share of the work, on its own branch and in its own copy of the repo.
- **Call logs:** the new name for the page called "Activity" today (`/companies/activity`).
- **History:** the Call logs tab that lists every call you logged, newest first. It takes the place of "Logged".
- **Quick look:** the top of the call prep panel. It shows the facts about the company from our HubSpot copy, with no AI.
- **Mic card:** the card that rises over the page when you press the mic.
- **Mic check:** the test that runs when the mic card opens, in under 2 seconds: is there a mic, is it allowed, and does it hear you.
- **Voice to text:** turning what the rep says into words in the note box.
- **HubSpot team:** a group of HubSpot users that an admin sets up inside HubSpot, like "Sales" or "BD".
- **Last activity:** the newest call, email, meeting or note on a company, as HubSpot counts it.
- **Motion kit:** our animation parts in `engine/frontend/src/components/motion/`.

## What exists already (so nothing is built twice)

Read this before any step. Each row names what is there and the only thing this plan adds.

| Need | Already there | This plan adds |
|---|---|---|
| The page to rename | `apps/companies/activity/` (page title "Your call notes"). The route and menu item are in `apps/companies/module.tsx` (`:30`, `:81`, `:119`). | The new name and address. The page's parts stay. |
| The Meetings list | `apps/companies/meetings/`. The switch "The team's meetings" is `team=1` in the address and `mine` on the API, true by default (`api_meetings.py:122`, `params.ts:82`). | `who` in place of `mine`, and a `Segmented` control in place of the switch |
| Who I am in HubSpot | `users.hubspot_owner_id` (PLAN-V17 T1-4), read by `owners.py` `owner_id_of` | The teams of each HubSpot owner |
| Reading meetings | `core/hubspot/meetings.py`: a full read in the 6:00 am sync, and a changes read at most every 15 minutes while Meetings or Home is open (`REFRESH_EVERY`, `MeetingsRefresher`) | A full read on request, for Sync |
| The whole HubSpot sync | `POST /api/v1/hubspot/sync`, and "Sync with HubSpot" on the Companies page | Nothing. Meetings gets its own smaller Sync. |
| New pre-read | `meetings/new-pre-read.tsx`: a dialog with no word about AI | The AI line |
| The pre-read page | `meetings/pre-read/`: one column, 768px wide, sitting at the left (no `mx-auto`) | The centered form |
| The Companies list's sort | `GET /companies` sorts by `name`, `staff`, `lease` or `last_talk`. The default is `name`, A to Z (`store.py:226`). The "Last activity" column shows HubSpot's "Last contacted". | `last_activity`, as the new default |
| Free facts for call prep | `GET /companies/{key}/facts` (`api_preps.py:295`, "No Claude request is made"), read by `usePrepFacts` | Nothing. The quick look uses it. |
| The call prep panel | `prep-sheet.tsx`, 576px. Its first screen is `WhoPicker` ("Who are you calling?"), and each person there has another "Prep" button. | It opens on the quick look |
| The mic | `call-notes/note-mic.tsx`: typing only, with "press Win+H to dictate" on Windows. `LevelMeter` is in the motion kit, unused. | The mic card, the mic check, and voice to text |
| The call notes list | `GET /call-notes` with `state` (`to_confirm`, `logged`, `needs_look`) and `mine` | `history`, search and filters |
| Error words | Backend: each file's words block (PLAN-V15 "Words for errors"). Website: `src/api/words.ts`, `ErrorState`, `toastProblem` and `problemHint` (`lib/problems.ts`, which has no hints for meetings or call notes yet), and `screen-words.test.ts`. | Words and hints for every failure on these screens |
| Motion | `springs` (`snappy` 250ms, `smooth` 400ms, `soft` 350ms with bounce 0.1, `exit` 150ms), `Segmented`, `ChipGroup`, `TabIndicator`, `Reveal`, `RollingNumber`, `usePress`, `PushView`, `ListExit`, `LevelMeter`, `TickIn`, and the pre-read's `FadeSwap` | Four parts (T2-2, T3-4) |
| The mic's headers | The Caddyfile already allows the mic (`microphone=(self)`) and a WebAssembly worker. `index.html` doesn't yet (`csp.test.ts`). | `index.html`, only if the voice tool needs it |

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts. The rule ones are **TBC with Levi**.

**Names:**
1. **"Call logs"** is the page's name. Its tabs are "To confirm", "History" and "Needs a look". The address becomes `/companies/call-logs`, and the old address sends you on. The code folder is renamed to match, so the next person isn't confused.

**Meetings:**

2. **Three filters: All, My meetings, My team.** All is the default. It lists every client meeting in time order, and your own carry a small "You" mark.
3. **"My team" means the people in your HubSpot team,** from HubSpot's own teams (**TBC**: T1-2 checks whether Contour has any). If HubSpot has no teams, the filter is hidden, and Al-khair is told.
4. **Sync reads every meeting in the window now** (90 days back to 60 days ahead), so it also finds meetings that moved or were deleted. It runs at most once a minute for the whole site. The automatic reads stay: daily at 6:00 am, and at most every 15 minutes while Meetings or Home is open.
5. **The AI notice shows in three places:** the New pre-read dialog, the "Draft it" button, and the steps on the pre-read while it drafts.
6. **The pre-read is a centered form,** about 840px wide (**TBC** after the look), in HubSpot's form pattern with Contour's own colours, type and icons. The AI summaries are boxes you type into directly, with no pencil step.

**Companies:**

7. **The list sorts by last activity, newest first.** The value is the newest of HubSpot's "Last activity date" and "Last contacted" (**TBC**: T1-2 names the field). Companies with neither go last, A to Z.

**Call logs:**

8. **Voice to text: Whisper in the browser first.** It is free, and the voice never leaves the laptop. If T3-3 shows it isn't good enough, the browser's own speech service (Chrome and Edge) is the backup. That sends the voice to Google or Microsoft, so it needs Levi's OK (**TBC with Levi**). Typing always works. The Win+H line goes.
9. **The mic check runs each time the mic card opens,** in under 2 seconds. "Check my mic" also sits in Ctrl+K and in the profile menu, so a rep can test before a block of calls.
10. **History shows your own calls,** grouped by day, with search and filters. A view of the team's calls is **TBC with Levi**.

**Call prep:**

11. **Prep opens on the quick look.** The person defaults to the last person you talked to. The AI script starts by itself, as it does today after you pick someone (question 3).
12. **Phones:** the mic button shows on laptops. On a phone, the keyboard's own mic key does the talking (question 4).

## How it should look and move

The aim is a screen that feels like a well made iPhone app. Every press answers within 100ms. Things glide into place, and nothing waits without saying why. Read DESIGN.md "Motion" first. These rules add to it, and a track that breaks one stops and asks Al-khair.

### The bar for every screen here

- **It answers at once.** A press shows its result within 100ms. The server is told after (DESIGN.md "Act at once, undo after"). If the server says no, the result rolls back and the words say why.
- **Springs with no bounce.** Use the kit's `snappy`, `smooth` and `soft`. Only a tick may bounce, a little (`soft`).
- **Things grow from where they open.** The mic card grows from the mic button. A row opens where it is.
- **Only `transform` and `opacity` move.** Never an animated height or width. A row that opens uses Motion's `layout`, which moves by transform.
- **Leaving is quicker than arriving:** 150ms.
- **Nothing loops.** No spinner, no shimmer, no pulse. The mic's bars follow your real voice, so they are still when you are silent.
- **A move can be turned back half way.** A quick second press carries on from where the part is and never jumps (the kit's springs do this).
- **Reduced motion:** everything simply changes, at once.
- **Smooth on a slow laptop:** no dropped frames at 4x CPU slowdown in Chrome's performance panel.
- **Every state is drawn:** loading (a still skeleton at the real size, after 200ms), empty, error, waiting for access, and done.
- **Keyboard first on a laptop, touch first on a phone.** 44px targets and 16px fields on touch. Checked at 1440, 1280 and 390px, light and dark.

### What to look at

- **iOS Voice Memos and the Siri card:** the mic card and its live bars.
- **iOS Settings:** grouped fields with labels, on a calm card.
- **HubSpot's forms and record cards:** a label above each field, a star on required fields, and a grid of facts. Use Contour's colours, type and icons, not HubSpot's logo or orange.
- **Our own `Segmented` and `TabIndicator`:** the filters and the tabs.

### Each moment

| Moment | What moves | With | Reduced motion |
|---|---|---|---|
| A Meetings filter changes | The highlight slides under the new pick. The list cross fades (out 150ms, in 250ms). The rows don't move one by one. | `Segmented` (`snappy`), a cross fade | It jumps, and the list swaps |
| Sync is pressed | The icon turns once (one turn, never a loop). The label reads "Checking HubSpot". When done: "Up to date" with a tick, then "Checked 2:14 pm". New meetings fade in. | `SpinOnce` (`smooth`), `FadeSwap`, `TickIn`, `Reveal` | Only the words change |
| The AI drafts a pre-read | Three steps: "Reading HubSpot", "Writing the summaries", "Ready for you to check". Each dot fills when its real state arrives, never on a timer. The summaries cross fade in when written. | `StepTrail` (`soft`), `FadeSwap` | The dots are filled, the text swaps |
| The pre-read form opens | Its four sections rise 4px and fade in once, 40ms apart. The footer bar stays still. | `Reveal` | Simply there |
| A field saves | "Saved" fades in under the field. | 150ms, opacity | Simply there |
| The mic is pressed | The card grows from the button (from 0.96 to 1, with a fade). The page behind dims in 250ms. | `MicSheet` (`smooth`) | It appears |
| The mic check runs | Four lines tick one after another, each as its real result comes in. | `TickIn`, 40ms apart | The ticks show |
| "Speak now" | 24 bars follow your voice as `scaleY`, up to 30 times a second. Silence is still and low. A timer counts up. | `FrequencyBars` | One still bar and the word "Listening" |
| The words arrive | Each chunk fades in. No typewriter effect. | 150ms, opacity | Simply there |
| Done | The card shrinks back toward the mic button (150ms). The words are in the note box. | `exit` | It is gone |
| A mic problem | The failed check line turns Terracotta, with its fix under it. The card never shakes. | 150ms, opacity | The words show |
| A History row opens | It opens in place. The rows under it glide down as a transform. One row is open at a time. | Motion's `layout`, `smooth` | It opens at once |
| "Show older" in History | The older days rise 4px and fade in. | `Reveal` | Simply there |
| Prep is pressed | The panel slides in (250ms, as today). The quick look is already there: its facts were fetched when the pointer rested on Prep. The AI script cross fades in when it is ready. | As today, plus a prefetch | A plain swap |
| A Call logs tab changes | The underline slides. | `TabIndicator` | It jumps |

**What never moves:** the rows of a list used all day (Meetings, and History until a row is opened), anything on hover, and any list of more than 50 rows.

**New lines for DESIGN.md** (Track 3 writes them at T3-9, after Al-khair's look): the frequency bars (up to 30 updates a second, transform only), the mic card that grows from its button, `SpinOnce`, and `StepTrail`.

## Words for when things go wrong

Each problem says three things, in this order: what happened, what still works, and the one thing to do. No setting names, file names, codes or local addresses on screen (`screen-words.test.ts`). The words below are where each track starts. A track may make them shorter, never vaguer. Each track adds a test that shows every row of its table.

### The mic (Track 3)

| What went wrong | How we know | Words on screen | Buttons |
|---|---|---|---|
| No mic | No audio input in the device list | "We can't find a mic. Plug one in or switch on your headset, then try again. You can type the note meanwhile." | Try again, Type instead |
| Blocked by the browser | The browser refused (`NotAllowedError`) | "Your browser has blocked the mic for Contour HQ. Click the icon to the left of the web address, set Microphone to Allow, then try again." | Try again |
| Blocked by Windows | The browser allows it, but no sound device opens (**TBC**: T3-4 finds how to tell this apart) | "Windows has turned the mic off for your browser. In Windows Settings, open Privacy and security, then Microphone, and turn on access for apps. Then try again." | Try again |
| Another app has it | The device is busy (`NotReadableError`) | "Another app is using your mic, like Teams or Zoom. End the call there or close it, then try again." | Try again |
| Silent | The mic is open, but the sound stays near zero for 2 seconds | "Your mic is on, but we hear nothing. Check its mute switch or its volume, or pick another mic." | Pick a mic, Try again |
| An old browser | The browser has no mic support | "This browser can't use the mic. Use Chrome or Edge, or type the note." | Type instead |
| Not the secure site | The page isn't a secure page | "The mic only works on Contour HQ's usual web address." | None |
| The voice tool didn't load | The worker or its files failed | "The voice tool didn't load. Check your connection, then try again. You can type the note meanwhile." | Try again, Type instead |
| Too slow | Writing out takes more than 3 times as long as the talk | "This computer is slow to turn speech into words right now. Close some tabs, or type the note." | Type instead |
| Cut off | The mic stopped mid note, for example unplugged | "The mic stopped. What you said so far is kept." | Carry on |

### Meetings and the pre-read (Track 1 sends the sentences, Track 2 shows them)

| What went wrong | Words on screen |
|---|---|
| HubSpot's meetings aren't read yet | "Meetings can't be read from HubSpot yet. You can still start a new pre-read." (as today) |
| No permission to read meetings | "Waiting for HubSpot access to meetings. An admin adds it in HubSpot. You can still start a new pre-read." |
| HubSpot didn't answer a Sync | "HubSpot didn't answer, so this list is from 9:02 am. Try Sync again in a minute." |
| A Sync is already running | "Already checking HubSpot. It takes about 10 seconds." (**TBC**: T1-5 measures it) |
| Synced a moment ago | "Up to date. Checked a moment ago." |
| My meetings, but my account isn't linked | "Your account isn't linked to a HubSpot owner yet, so My meetings is empty. All shows everyone's. An admin can link you in Admin, People." |
| My team, but I'm in no team | "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's." |
| The draft failed: the AI limit | "The summaries weren't written: today's AI spending limit is reached. Write them yourself, or draft again tomorrow." |
| The draft failed: the AI service | "The summaries weren't written: the AI service didn't answer. Try again in a minute, or write them yourself." |
| Email isn't set up | "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up." |
| No connection | The shared connection bar, as today |

### Call logs and call prep (Track 1 sends the sentences, Track 3 shows them)

| What went wrong | Words on screen |
|---|---|
| History can't load | "Your call history couldn't be loaded. Check your connection, then try again." |
| A call couldn't be saved | "Not saved yet. Try again." with "Your note is kept for this call." (as today) |
| Sending to HubSpot failed | The "Needs a look" words, as today |
| No people at the company | "No people on record in HubSpot for this company. The script asks the switchboard for whoever looks after the office." |
| The facts can't be read | "The facts couldn't be read from our HubSpot copy. Try again in a moment." |
| Call prep is off | "Call scripts are switched off. The facts from HubSpot still show." (as today) |

## Who builds what: the agents

Each step names its agent. The track's session leads: it hands the step to that agent with the step's text and the contract part, then reads the diff and runs the checks itself.

| Agent | Steps | Its skills |
|---|---|---|
| `backend-agent` | Every Track 1 step | `api-change` for a route, `db-migration` for a table |
| `frontend-agent` | Every Track 2 and Track 3 step | `ui-build` to build, `design-review` and `speed-check` before a track check |
| `review-agent` | Each track's check step, and before `merge v18` | `merge-check`, `security-check`, `design-review` |
| `rules-agent` | None. This plan changes no Lead Finder rule. | |

- **One agent at a time in a track.** Two at once would run two test suites on one laptop.
- **The review-agent is always a new one,** given the diff and the plan step, never the builder's summary. It changes nothing.
- **A new design rule** is proposed by the `frontend-agent` and goes into DESIGN.md only after Al-khair agrees.
- **Merging, pushing, deploying and anything paid** stay with Al-khair, in his own session.

## How the tracks talk

- **At the start,** each session names itself "V18 Track 1", "V18 Track 2" or "V18 Track 3".
- **To send news,** a session finds the others with `ListAgents` and writes with `SendMessage`. Send a message when a tag is made, when a track needs a change in another track's files, or when the contract looks wrong.
- **A message is news, never a go-ahead.** Only Al-khair's own words in his own session start a merge, a push, a deploy or a paid check.
- **The record is git and this plan, not the messages.** Each track writes what it sent in its Log.
- **No waiting points.** Tracks 2 and 3 build against the contract with `mockApi`. The real parts meet at M1.

## How to work this plan

**Who owns which files.** Nothing collides if each track only changes its own files.

| Files | Owner |
|---|---|
| `engine/backend/` (all of it), migration `0024` | Track 1 |
| In `engine/frontend/src/`: `apps/companies/meetings/` (the pre-read too), `apps/companies/index.tsx`, `params.ts`, `columns.tsx`, `company-cards.tsx`, `marks.tsx` and `prefetch.ts` (the Companies list), `api/hooks/meetings.ts`, `api/hooks/meeting-summary.ts`, and two new motion files (`spin-once.tsx`, `step-trail.tsx`) with their own test files | Track 2 |
| In `engine/frontend/src/`: `apps/companies/activity/` (renamed `call-logs/`), `apps/companies/call-notes/`, `prep-sheet.tsx` and the call prep parts (`before-you-dial.tsx`, `prep-card.tsx`, `script-header.tsx`, `company-cell.tsx`), `module.tsx`, `call-note-links.tsx`, `home-card.tsx`, `apps/companies/words.ts`, `api/hooks/companies.ts`, `api/hooks/call-notes.ts`, `api/hooks/call-note-counts.ts`, `shell/` (the profile menu is `shell/user-menu.tsx`), `router.test.tsx`, two new motion files (`mic-sheet.tsx`, `frequency-bars.tsx`) with their own test files. Also `engine/frontend/index.html`, `src/test/csp.test.ts` and `engine/DESIGN.md`. | Track 3 |
| `src/components/motion/index.ts` and `src/test/mock-api.ts` | Tracks 2 and 3 both add lines. Expect a small conflict at M1: keep both sides. |
| `engine/frontend/openapi.json`, `engine/frontend/src/api/schema.d.ts` | Generated. Never edit them by hand. M1 makes them again. |
| `plan/PLAN-V18.md` | Each track edits only its own part (its steps, its Progress count, its Log) |
| `engine/AGENTS.md`, `CLAUDE.md`, `.claude/`, `projects/prep/PREP.md` | M3 only |

- **Hand written types:** until M1, Tracks 2 and 3 add the contract's new fields by hand next to the generated types, in their own files. M1 replaces them with the generated ones.
- **Motion tests:** each new motion part gets its own test file, not a block in `motion.test.tsx`, so the two website tracks never edit the same test file.
- **One migration:** only Track 1 writes one (`0024_v18_teams_activity`, after `0023_meeting_forms`). So there is no migration chain to join.
- **Table lists:** Track 1's new table goes into `TEST_TABLES` (`tests/conftest.py`), `fill_every_table` (`tests/core/test_fixtures.py`), and the `TRUNCATE` lines in `tests/core/test_first_admin.py` and `tests/core/test_auth_admin.py`.
- **`tests/core/test_contract_routes.py`** lists every route. Track 1 adds lines.
- **New packages:** none in the backend. In the website, Transformers.js only, added by Track 3, and only if T3-3 picks Whisper.
- **No track changes another's files.** If one needs a change there, it sends a message to the owner, writes the request in its Log, then carries on.
- **The contract (below) is fixed.** If a track finds it wrong, it stops and tells Al-khair.

**Branches and copies.**
- The base is `plan-v18`, made from `master` (see S0).
- Track 1: `git worktree add ../contour-v18-t1 -b plan-v18-track1 plan-v18`.
- Track 2: `git worktree add ../contour-v18-t2 -b plan-v18-track2 plan-v18`.
- Track 3: `git worktree add ../contour-v18-t3 -b plan-v18-track3 plan-v18`.
- In a new copy: run `npm ci` in `engine/frontend` once.

**Ports and databases.** Each track runs its own backend and website.

| | Backend | Website | Database | Test database suffix |
|---|---|---|---|---|
| Track 1 | `API_PORT=8061` | port 5231, proxy to 8061 | `leadfinder_v18a` | `LEADFINDER_TEST_DB_SUFFIX=_v18a` |
| Track 2 | `API_PORT=8062` | port 5232, proxy to 8062 | `leadfinder_v18b` | `_v18b` |
| Track 3 | `API_PORT=8063` | port 5233, proxy to 8063 | `leadfinder_v18c` | `_v18c` |

- Make each database once, as a copy of the dev database at migration `0023`. The dev database has 599 real meetings from HubSpot (16 Nov), which is good for looking at Meetings.
- The track's `engine/.env` holds the `POSTGRES_*` lines only. Never put `API_PORT` or `CORS_ORIGINS` in it.
- **Keys:** a track backend starts with **no Claude key** and **no HubSpot key**. Only T1-2 and T1-5's count load the HubSpot key, into the process only. Never print it.
- Leave ports 8000 and 5173 alone, and those of older plans (8041 to 8053, 5211 to 5223).

**Every session.**
- **At the start:** read this section, "What exists already" and "How it should look and move". Go to the track's worktree, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks. Use `--maxWorkers=1` for vitest while other sessions run.
- **Windows Application Control** blocks a new venv's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each. Follow the `git-workflow` skill.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the track's Progress count and add a line to its Log.
- **Screens:** follow `engine/DESIGN.md` and "How it should look and move". Screenshots go in `plan/shots/v18-t2/` or `plan/shots/v18-t3/` (git ignored).
- **No real client data in git:** tests and fixtures use made-up companies and people, like "Sample Logistics Pty Ltd" and "Jo Sample". No real note and no recording.
- **When usage runs low** (80% of the 5 hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the tracks start

- [x] **S0. The base branch.** Done 2026-11-16 by the lead session, on Al-khair's word in chat ("Please implement this all the way"), in the worktree `../contour-v18`, so the main folder stayed on `master`. The backend tests run in T1-1's baseline.
  - Make `plan-v18` from `master`. Use a temporary worktree. Don't switch the main folder's branch.
  - Its first commit holds this plan and the `CLAUDE.md` go signals.
  - In `plan/PLAN-V17.md`, add one line under T3-2 and T3-4: "Moved to PLAN-V18 (T3-3 to T3-5)."
  - **Done when:** `git branch --list plan-v18` shows it, it holds `plan/PLAN-V18.md`, and the backend tests pass on it.

## The contract

### 1. Meetings (Track 1 builds, Track 2 reads)

All under `/api/v1/companies`, behind the Companies tick, and only while Meetings are on.

**`GET /meetings`** keeps `when`, `q`, `limit` and `offset`, and changes one thing:
- `who`: `all` (the default), `mine` or `team`. It takes the place of `mine`.
  - `all`: every client meeting, in time order (soonest first for Upcoming, newest first for Past). No "mine first".
  - `mine`: the meetings I own, or attend as a Contour person.
  - `team`: the meetings whose owner, or a Contour person on them, is in one of my HubSpot teams. That includes mine.

`MeetingPage` gains:

| Field | What it is |
|---|---|
| `who` | The filter used |
| `linked` | True when my account has a HubSpot owner |
| `team_state` | `ready`, `not_linked`, `no_team` (I'm in none) or `none_in_hubspot` (HubSpot has no teams). The website hides "My team" only for `none_in_hubspot`. |
| `team_names` | My HubSpot teams' names, or an empty list |
| `checked_at` | When the last good read of HubSpot's meetings finished, or none |
| `syncing` | True while a read of HubSpot's meetings is running |
| `sync_problem` | One plain sentence when the last read failed or is waiting for a permission, or none |

`MeetingItem` gains `mine`: true when I own the meeting or attend it.

**`POST /meetings/sync`**: reads HubSpot's meetings now (choice 4). It answers at once, 202, with `MeetingsSyncOut`:
- `state`: `started`, `running` (a read was already going) or `fresh` (one finished under a minute ago, so nothing new is asked);
- `checked_at`.

Errors: 409 `meeting_forms_off`. 503 `hubspot_not_connected`: "HubSpot isn't connected, so meetings can't be read from it." A HubSpot failure doesn't fail this request: it shows in `sync_problem`.

### 2. The Companies list (Track 1 builds, Track 2 reads)

**`GET /companies`:**
- `sort` gains `last_activity`, which becomes the default. Its first order is `desc`. `name`, `staff`, `lease` and `last_talk` still work.
- `CompanyRow` gains `last_activity`: a date, or none. It is the newest of HubSpot's "Last activity date" and "Last contacted" (choice 7).

### 3. Call notes (Track 1 builds, Track 3 reads)

**`GET /call-notes`:**
- `state` gains `history`: every one of my notes, in any status, newest call first.
- New filters, for any state:
  - `q`: up to 200 characters. Each word must start a word of the company's name, the person's name, the note or the summary.
  - `outcome`: one of the call outcomes, or `none`.
  - `since` and `until`: dates, in Melbourne time.
- The answer stays `CallNotePage`, with `total`.

**`GET /call-notes/options`** gains `voice_tool`: `browser_model`, `browser_service` or `typing` (part 4).

### 4. Settings (T1-8 adds it)

| Setting | Default | What it does | On the Settings page |
|---|---|---|---|
| `voice_tool` | `browser_model` | Which voice to text tool the mic uses. `browser_model` is Whisper in the browser. `browser_service` is the browser's own speech service, which sends the voice to Google or Microsoft: only with Levi's OK (**TBC with Levi**). `typing` hides the mic. | Yes |

### 5. Words

- The Settings help and the API's descriptions say "Call logs", not "Activity".
- No route path changes. `/call-notes` stays as it is.

## Track 1: the backend (session 1)

**Progress:** 0 of 9. Every step is `backend-agent` work.

- [ ] **T1-1. Own copy and a baseline.** Make the worktree and the database. Run the backend tests once and note the counts. Note `test_companies_speed`'s time too: it was about 560ms against its 300ms limit on this laptop before this plan.

- [ ] **T1-2. Ask HubSpot two things.** Free, read only. It loads the real key into the process only.
  - **Teams:** does HubSpot's owners list give each owner's `teams`? How many owners are in a team, and the teams' names. Write names and counts in the Log, never an email.
  - **Last activity:** read the company field list. Which field is "Last activity date" (we expect `notes_last_updated`)? How many companies in our copy would have it, against "Last contacted"?
  - If HubSpot has no teams, send Track 2 a message ("My team" stays hidden) and tell Al-khair.
  - **Done when:** the Log has both answers.

- [ ] **T1-3. Teams and last activity in our copy.**
  - Migration `0024_v18_teams_activity`:
    - a new table `core.hubspot_owner_teams` (owner id, team id, team name, primary or not);
    - `core.hubspot_companies.last_activity` (a time), from the field T1-2 named;
    - an index for the History list on `companies.call_notes` (`made_by`, `called_at` newest first).
  - The sync reads both. Teams are replaced in full at each sync. `fields.yaml` and `FakeHubSpot` follow.
  - The activity writer sets `last_activity` on our copy when a call lands in HubSpot, so the list is right before the next sync.
  - Run `scripts/schema_map.py`, and add the new table to the four table lists.
  - **Done when:** tests prove teams saved and replaced, `last_activity` read, the writer's update, and that the schema map matches.

- [ ] **T1-4. Meetings: All, My meetings, My team** (the contract, part 1).
  - `who` in place of `mine`, with `all` as the default.
  - All is in time order. Each item says `mine`.
  - The page's new fields: `linked`, `team_state`, `team_names`.
  - The "not linked" sentence shows on Mine and Team only, never on All. A new sentence for "no team" ("Words for when things go wrong").
  - With sign in switched off there is no user: All works, and `linked` is false.
  - **Done when:** tests cover each `who`, an unlinked account, no team, two teams, sign in switched off, and the order.

- [ ] **T1-5. Meetings: Sync now** (the contract, part 1).
  - `POST /meetings/sync`: a full read of the window, now. It skips the 15 minute rule and the 60 second ask rule.
  - It keeps: one read at a time, the save lock (`MEETINGS_LOCK`), and the key check. A press within a minute of the last finished read answers `fresh` and asks HubSpot nothing.
  - It answers at once. The read runs in the background, and the list's `syncing` says so.
  - The list gains `checked_at` and `sync_problem`.
  - Log lines carry counts and times, never meeting titles.
  - **Measure,** with the real key in the process only: the requests and the seconds for one press on the dev copy (599 meetings). Write both in the Log, and send Track 2 the seconds for its words.
  - **Done when:** tests prove `started`, `running` and `fresh`, a failed read (the sentence shows, and the old copy stays), a missing permission, no key, and that the daily sync and a Sync never save at the same time.

- [ ] **T1-6. Companies: last activity first** (the contract, part 2).
  - `last_activity` becomes the default sort, newest first. Empty values go last, then A to Z.
  - Lead Finder rows that aren't in HubSpot have none, so they go last.
  - Old links with `sort=name` still work.
  - `test_companies_speed` must pass. If the new sort is slower, find why (the list is sorted over a joined subquery) and fix it before moving on.
  - **Done when:** tests cover the order, empty values, ties and old links, and the Log has the speed before and after.

- [ ] **T1-7. Call notes: History** (the contract, part 3).
  - `state=history`, and the filters `q`, `outcome`, `since` and `until`.
  - Only my own notes, as today. Another rep's notes never show.
  - **Done when:** tests cover each filter, the order, paging, and someone else's notes, and a speed check with 2,000 notes stays under 300ms.

- [ ] **T1-8. The words, and the voice setting.**
  - "Activity" becomes "Call logs" in the Settings help (`core/prefs/service.py:242`) and in `schemas.py:570`.
  - The new sentences in "Words for when things go wrong": Sync, no team, the two draft failures.
  - Each route's description lists every error code it can answer. Some are missing today: `meeting_time_missing` on `POST /meetings/forms`, and `no_one` and `form_sending` on the send route.
  - A test: every problem in `apps/companies/` and `core/hubspot/meetings.py` has a title and a next step, and none names a setting or a file (the scanner in `test_safe_deploys.py`).
  - The `voice_tool` setting (the contract, part 4), on the Settings page, and in `GET /call-notes/options`.
  - **Done when:** the tests pass, and the screen words scanner passes.

- [ ] **T1-9. Track 1 check.**
  - Every backend test (`RUN_GATES=1`), and `uv run engine openapi` to prove the contract builds (the generated files are made again at M1).
  - The `security-check` skill on the whole diff.
  - A fresh `review-agent` reviews the diff against this plan.
  - Tag `v18-t1`. Send the others a message.
  - **Done when:** all of it passes, and the Log says "Track 1 ready to merge".

### Track 1 Log

- (empty)

## Track 2: Meetings, the pre-read and the Companies list (session 2)

**Progress:** 2 of 8. Every step is `frontend-agent` work. It follows `engine/DESIGN.md` and "How it should look and move", uses the `ui-build` skill, and builds against the contract with `mockApi`.

- [x] **T2-1. Own copy and a baseline.** Make the worktree. Run lint, types, the tests and the build once. Note the counts and the first visit size from `node scripts/bundle-report.js`. Done 2026-11-16 on `40d9912`: the numbers are in the Track 2 Log.

- [x] **T2-2. Two motion parts** (in their own files, each with its own test file). Done 2026-11-16 (`587a837`).
  - `SpinOnce`: an icon turns once for each press. A second press while it turns carries on smoothly.
  - `StepTrail`: three steps in a row. Each dot fills when the page says its state has arrived.
  - Each follows reduced motion (`useStill`) and uses the kit's springs.
  - **Done when:** their tests pass, the design-lint test passes (nothing loops), and the late motion file's size is in the Log.

- [ ] **T2-3. Meetings: All, My meetings, My team, and Sync.** Built 2026-11-16 (`07f7547`), waiting for a look.
  - A `Segmented` control in place of the switch: "All", "My meetings", "My team". All is the default.
  - The address: `who=mine` or `who=team`. All is left out. An old link with `team=1` opens All.
  - "My team" is hidden when `team_state` is `none_in_hubspot`. Both filters are hidden while sign in is switched off. Otherwise each shows, and its empty state says why it is empty.
  - In All, my own rows carry a small "You" mark. Other rows show whose they are, as today.
  - **Sync** sits at the toolbar's right end: an outline button with the refresh icon.
    - While it runs: "Checking HubSpot", and the list asks again every 2 seconds until `syncing` is false.
    - Then "Up to date", and a quiet line under the toolbar: "Checked 2:14 pm". That line always shows once the page knows the time.
  - In `meetings/words.ts`, "on Activity" becomes "in Call logs".
  - **Done when:** tests cover each filter, the default, old links, the hidden filters, Sync's three answers, a failed Sync, and the asking that stops. Al-khair has seen it.

- [ ] **T2-4. People see that AI drafts the pre-read.** Built 2026-11-16 (`7239682`), waiting for a look.
  - **The New pre-read dialog** gets one line with an AI icon, above its buttons: "AI drafts this pre-read from what we know in HubSpot: the company, its people, calls, meetings and notes. It takes about 20 seconds. You check it before anyone gets it." Then the cost in quiet text: "About US$0.03." (**TBC**: the seconds, measured once by the real draft in T2-8.)
  - **"Draft it"** on each row says the same in short, as its description for the pointer and for screen readers: "AI drafts it. You check it before it's sent."
  - **While it drafts,** the `StepTrail` shows "Reading HubSpot", "Writing the summaries" and "Ready for you to check". Each step fills on its real trigger: the facts arrive, then the summaries are being written, then the status is "draft". A failed draft stops the trail at its step, with the reason in plain words.
  - **Done when:** tests cover the words, each step's real trigger, and a failure. Al-khair has seen it.

- [ ] **T2-5. The pre-read as a centered form.**
  - **Centered:** `mx-auto`, about 840px wide (**TBC** after the look). One card on the page's background, like a sheet of paper.
  - **HubSpot's form pattern, in Contour's look:**
    - a label above each field;
    - four sections, numbered, each with a heading and a thin line: 1 The meeting, 2 The company, 3 The summaries, 4 Your part;
    - the facts as quiet, read only fields in a two column grid (one column on a phone): date, time, Teams or in person, the company, the owner, who we meet, staff, offices, lease end, and the deal stage.
  - **The AI summaries are boxes you type into directly.** Each says "Written by AI" until you change it, then "Edited by you", with its sources under it. Each saves when you leave it, like Your part.
  - **The two blanks are required fields,** marked with a star and "Required" for screen readers.
  - **A footer bar** stays at the bottom of the form: the status on the left ("Draft, saved 2:14 pm"), and the Navy "Check and send" on the right.
  - The send dialog keeps its parts, in the same field style.
  - **Phone:** one column, and the footer sits above the safe area.
  - **Keyboard:** Tab goes from top to bottom. Ctrl+Enter opens "Check and send".
  - **Done when:** tests cover the sections, a summary edited in place, the required blanks, the footer, and the phone layout. Screenshots at 1440, 1280 and 390px, light and dark. Al-khair has seen it.

- [ ] **T2-6. Companies: the newest activity first.**
  - The default sort is `last_activity`, newest first. The "Last activity" column shows `last_activity`, and its header shows the sort arrow.
  - Old links with `sort=name` still work. Home's prefetch asks the same request as the page.
  - Phone cards say "Last activity" and follow the same order.
  - **Done when:** tests cover the default, the column, old links and the phone cards. Al-khair has seen it.

- [ ] **T2-7. Errors on Meetings and the pre-read.**
  - Every row of its table in "Words for when things go wrong", with its button.
  - `problemHint` (`lib/problems.ts`) gains hints for the meetings codes.
  - **Done when:** a test shows every row, and `screen-words.test.ts` passes.

- [ ] **T2-8. Track 2 check.**
  - Lint, types, the tests, the build and `node scripts/bundle-report.js`. The first visit may grow by 1 kB at most over T2-1.
  - The `design-review` skill on each changed screen, and `speed-check` on Meetings.
  - Each screen at 1440, 1280 and 390px, light and dark, by keyboard only, and with reduced motion.
  - 4x CPU slowdown in Chrome's performance panel: a filter change, a Sync, the drafting steps, and the form. No dropped frames.
  - One real pre-read draft, on Al-khair's word (about US$0.03). Note its seconds for T2-4's words.
  - A fresh `review-agent` gives its own `design-review`.
  - Send Track 3 the DESIGN.md lines for `SpinOnce` and `StepTrail`.
  - Tag `v18-t2`. Send the others a message.
  - **Done when:** all checks pass, and the Log says "Track 2 ready to merge".

### Track 2 Log

- 16 Nov 2026, T2-1: the worktree `../contour-v18-t2` on `plan-v18-track2`, from `40d9912`. Baseline: lint and types pass; 116 test files and 1,640 tests pass (326 s on one worker); the build passes. First visit: 232 kB gzip (722 kB raw) in 35 files, CSS 23 kB gzip, main file 212 kB raw. The late motion file (`components/motion/features`): 14 kB gzip of its own, 33 kB with what it loads. Pages, extra over the first visit: Meetings 37 kB (7.9 kB its own), the pre-read 34 kB (9.6 kB), Companies 97 kB (8.8 kB).
- 16 Nov 2026, T2-2 (`587a837`): `SpinOnce` (`motion/spin-once.tsx`) and `StepTrail` (`motion/step-trail.tsx`), each with its own test file (14 tests), exported from the motion kit's index in a block of their own. Both use only `m.*` and the kit's springs, so the late motion file stays as it was: 14 kB gzip of its own, 33 kB with what it loads; the first visit stays 232 kB. The design-lint and screen-words tests pass. The dots are SVG circles, since the `rounded-full` class is banned.
- 16 Nov 2026, T2-3 (`07f7547`), built and waiting for a look. A `Segmented` choice (All, My meetings, My team) takes the place of the switch; the address keeps `who=mine` or `who=team`, and `team=1` opens All. "My team" hides for `none_in_hubspot` (unless the address asks for it), and the choice hides while sign-in is off (`useMe` says `off`), when the list asks for All. On All and My team the rep's own rows say "You". My meetings and My team say why they are empty (not linked, no team, no teams in HubSpot), in the server's sentence when it sends one, with "Show all meetings". Sync (`meetings/sync.tsx`, `use-sync.ts`) sits at the toolbar's end; the line under the toolbar says "Checked 8:14 am" once the time is known and keeps its height before. Meetings that come with a read fade in once (50 rows or fewer). Three choices for Al-khair's look: (1) a new view fades in over 250ms and the old one goes at once, with no 150ms exit, because an exit that waits on Motion left the list stuck in tests and would on a failed load (the company dialog does the same); (2) Home's "Upcoming meetings" card keeps the rep's own meetings (`who=mine`), since its sentence counts the rep's own; (3) Sync is greyed while HubSpot isn't connected (`meetings_state` is `off`). Hand written until M1, in `api/hooks/meetings.ts`: `MeetingWho`, `MeetingListQuery`, `MeetingListItem`, `TeamState`, `MeetingListPage`, `MeetingsSyncOut`, and `untypedApi` for `POST /meetings/sync`. 142 Meetings tests pass.
- 16 Nov 2026, T2-4 (`7239682`), built and waiting for a look. New pre-read's line sits above its buttons, with the `Cpu` icon the summaries' "Written by AI" mark uses (no sparkle), and its description is now only "For a meeting that isn't in HubSpot.", so the drafting is said once. "Draft it" has its words as a tooltip and as its screen reader description. The steps (`pre-read/draft-progress.tsx`, `draftReached` in `rules.ts`) sit under the pre-read's header: no facts is step 1, facts is step 2, `draft` or `sent` is all three. They stay full once ready on that visit, and a pre-read that opens ready shows none. A failed draft's reason and Try again moved from the summaries into the steps, and the three summaries now stay, empty, so the rep can write them. For Track 1: after a failed draft, does a PATCH that fills the summaries make the form `draft`? If not, "Write them yourself" can't lead to a send (the send needs a written pre-read). The "about 20 seconds" stays TBC until a real draft (skipped tonight, see T2-8).

## Track 3: Call logs, the mic, the history and call prep (session 3)

**Progress:** 0 of 9. Every step is `frontend-agent` work. It follows `engine/DESIGN.md` and "How it should look and move", uses the `ui-build` skill, and builds against the contract with `mockApi`.

- [ ] **T3-1. Own copy and a baseline.** Make the worktree. Run lint, types, the tests and the build once. Note the counts and the first visit size from `node scripts/bundle-report.js`.

- [ ] **T3-2. Call logs, the new name.**
  - First, alone in its own commit: `git mv` the folder `apps/companies/activity/` to `apps/companies/call-logs/`.
  - The address `/companies/call-logs`. `/companies/activity` sends you on, with its tab and `log=1`. `tab=logged` becomes `tab=history`.
  - The menu says "Call logs" (pick a Lucide icon that reads as a list of calls). The crumb, the browser tab ("Call logs - Contour"), and the page title "Call logs" follow. The description: "Every call you logged. Check new ones, send them to HubSpot, and look back at old ones."
  - The tabs: "To confirm", "History" and "Needs a look".
  - Ctrl+K: "Call logs". Its keywords keep "activity", so old habits still find it. Home's buttons and the tests follow, and DESIGN.md's mentions too.
  - **Done when:** tests cover the new address, the old address with its tab, the menu, the crumb, the title, and Ctrl+K found by "activity" and by "call logs".

- [ ] **T3-3. Which voice to text tool?** Needs Al-khair at the keyboard, about 15 minutes. Free.
  - Read the current docs first: Transformers.js (the Whisper models, Web Workers, WebGPU and its fallback) and the browser's Web Speech API. Don't build from memory.
  - A throwaway test page, never merged, with the mic card's live bars. Al-khair says 10 short notes with real Australian company and people names, on his own laptop, in Chrome or Edge.
  - Try two tools:
    - **(a) Whisper in the browser,** English, base and small. Free, and the voice never leaves the laptop.
    - **(b) The browser's own speech service** (Web Speech, `en-AU`). Free, and the words come live, but the voice goes to Google or Microsoft.
  - Note for each: the names it got wrong out of 10, the seconds to the first words, the seconds to write out a 60 second note, and the download size and time to be ready.
  - **Decide (choice 8):** (a) if it gets at most 1 name wrong in 10 and writes out a 60 second note in 10 seconds or less. Else (b), but only once Levi says yes. Until then, `typing`.
  - No recording is kept. The notes' text stays out of git.
  - **Done when:** the Log has the numbers and the decision, and `voice_tool` is set to match.

- [ ] **T3-4. The mic card and the mic check.** This works before any voice tool: it shows the bars and checks the mic.
  - **The mic button:** round, 44px, in the corner of the note box on Log call, named "Speak" for screen readers. The Win+H line is gone.
  - **The card (`MicSheet`)** grows from the button. Its title moves through "Checking your mic", "Speak now", "Writing it out" and "Done".
  - **The check,** in under 2 seconds. Four lines tick as their real results come in: "Mic found", "Allowed", "We can hear you", and "Voice to text ready". A failure shows its words from the table and stops there.
  - **The bars (`FrequencyBars`):** 24 bars from the mic's own sound (`AnalyserNode`), transform only, up to 30 updates a second, and still when you are silent.
  - **Which mic:** its name, like "Headset (Jabra)", with "Change" to pick another. It is remembered on this computer.
  - **Buttons:** "Done" (Enter), "Cancel" (Esc: nothing goes in the box), and "Type instead".
  - **The mic is let go** the moment the card closes, so the browser's red dot goes too.
  - **"Check my mic"** in Ctrl+K and in the profile menu opens the card in check only mode.
  - **Done when:** tests with a fake mic cover each check line, each failure, silence, a mic change, Esc, and the mic let go on close. The bars hold 30 frames a second at 4x CPU slowdown. Al-khair has seen it.

- [ ] **T3-5. Voice to text inside the card** (the tool T3-3 picked).
  - **(a) Whisper:**
    - a Web Worker (`stt.worker.ts`) holds the model and the library. Nothing of it is in the first visit;
    - the model's files come from our own site, fetched by a build script at a fixed version with a checksum, never from another site while a rep works, and never in git;
    - it gets ready ahead: on a laptop, for people with the Companies tick, after the page is idle;
    - `index.html`'s content policy gains `'wasm-unsafe-eval'` and `worker-src 'self'`, as the Caddyfile has, and `csp.test.ts` follows;
    - whether App Platform's static site serves files this big is **TBC**. Check before building. If it can't, tell Al-khair.
  - **(b) The browser service:** Web Speech with `en-AU`, and the words come live.
  - The words arrive in chunks and fade in. Then code fixes a near miss of the company's or the person's name, and shows the fix once, like "Vitara" to "Vitera".
  - The audio is never stored. With (a), a test proves no request carries it.
  - The first visit doesn't grow.
  - **Done when:** tests with a fake tool cover each state, and Al-khair has said one real note in the real page.

- [ ] **T3-6. History.**
  - The calls are grouped by day: "Today", "Yesterday", "Mon 14 Nov". Each day's heading stays at the top while you scroll its calls.
  - **Each call is one row:** the time, the company, the person, how it went (a coloured dot and a word, never colour alone), the summary's first line, and where it stands ("In HubSpot", "To confirm", "Needs a look" or "Sending"). Small marks show its follow ups and field changes, and how it was logged (mic, typed or transcript).
  - **Press a row and it opens in place:** the whole note, the changes (old value to new), the follow ups, each step's result, "Open in HubSpot", and "Log another call with {company}".
  - **A search box** (company, person, or words in the note) and **filters:** how it went, as chips; when ("This week", "This month", "All"); and where it stands.
  - "Show older" at the bottom brings 50 more.
  - **Empty:** "No calls logged yet. Press Log call after your next call, and it shows here." With a filter on: "No call matches that. Clear the filters to see all your calls."
  - **Keys:** J and K move, Enter opens, and / goes to the search.
  - **Done when:** tests cover the day groups, a row opened, each filter, the search, "Show older", the empty and error states, and the keys. Al-khair has seen it.

- [ ] **T3-7. Prep opens on the quick look.**
  - Pressing Prep opens the panel straight on the quick look. The "Who are you calling?" screen goes.
  - **The quick look,** from `GET /companies/{key}/facts` (no AI): the company, the owner, the deal and its stage, staff, the next lease end, the last talk (when, with whom, how it went), the next meeting, and the phone number with Copy.
  - **A "Calling" row** under it names the person. It defaults to the last person we talked to, else the first person on record, else "Cold call (switchboard)". Press it to change: a short list drops down, with the people, then the cold call.
  - The script follows below, as today: the free script at once, then the AI script (choice 11). Changing the person changes the script, as picking does today.
  - **It shows at once:** the facts are fetched when the pointer rests on Prep for 150ms, or when Prep gets keyboard focus.
  - **Done when:** tests cover no first screen, each default person case, a change of person, the prefetch, and a failed facts read. Al-khair has seen it.

- [ ] **T3-8. Errors on Call logs, the mic and call prep.**
  - Every row of the mic table, and of the Call logs and call prep table, in "Words for when things go wrong", with its buttons.
  - `problemHint` gains hints for the call notes codes.
  - **Done when:** a test shows every row, and `screen-words.test.ts` passes.

- [ ] **T3-9. Track 3 check.**
  - Lint, types, the tests, the build and `node scripts/bundle-report.js`. The first visit may grow by 1 kB at most over T3-1.
  - The `design-review` skill on each changed screen, and `speed-check` on Call logs with the mic.
  - Each screen at 1440, 1280 and 390px, light and dark, by keyboard only, and with reduced motion.
  - 4x CPU slowdown in Chrome's performance panel: the mic card opening, the bars, a History row opening, and the Prep panel. No dropped frames.
  - A fresh `review-agent` gives its own `design-review`.
  - DESIGN.md gains the lines Al-khair agreed to: its own and Track 2's.
  - Tag `v18-t3`. Send the others a message.
  - **Done when:** all checks pass, and the Log says "Track 3 ready to merge".

### Track 3 Log

- (empty)

## Merge and deploy

- [ ] **M1. Join the tracks** (`merge v18`, on Al-khair's word).
  - A fresh `review-agent` runs the `merge-check` skill first. It must say Ready.
  - In a worktree on `plan-v18`: merge `plan-v18-track1`, then `-track2`, then `-track3`, each with `--no-ff`.
  - The known joins: keep both sides in `src/components/motion/index.ts` and `src/test/mock-api.ts`. Run `uv run engine openapi` and `npm run types`, then replace the hand written types with the generated ones.
  - Run every test and build on the joined branch.
  - Then move `master`: `git merge --ff-only plan-v18` in the main folder. If it won't fast-forward, stop and ask.
  - **Done when:** every test and build passes on `plan-v18`, and `master` has moved to it.

- [ ] **M2. Deploy and check live** (`deploy v18`, on Al-khair's word).
  - Push, deploy, and watch the log. Migration `0024` runs on deploy.
  - Check live:
    - Meetings opens on All and shows meetings. Sync says "Checked" with the time.
    - Companies lists the newest activity first.
    - `/companies/activity` sends you on to Call logs.
    - The mic check passes on Al-khair's laptop, and one spoken note lands in the box (if the voice tool is on).
    - Prep opens straight on the quick look.
  - **Done when:** each check above is in the Log.

- [ ] **M3. Docs.**
  - `engine/AGENTS.md`: Call logs, the Meetings filters and Sync, the voice tool, and the quick look.
  - `CLAUDE.md` and `projects/prep/PREP.md`.
  - A short note for the team on what changed, written with `/plain`, sent on Al-khair's word.
  - **Done when:** no doc calls the page "Activity", and the note is sent or skipped on Al-khair's word.

## Waiting on

- **Levi:**
  - **The browser's speech service,** only if T3-3 picks it: his OK for the voice to go to Google or Microsoft.
  - **HubSpot teams,** if T1-2 finds none: whether Contour wants them set up in HubSpot.
  - **A team view of call logs:** who may see other people's calls.
  - **The contacts permission** (`crm.objects.contacts.read`, PLAN-V17 W1): without it, the quick look and History show no people's names.
- **Al-khair:**
  - the answers to "Questions for you";
  - T3-3 at the keyboard, and a look at each screen;
  - OK for the new DESIGN.md lines;
  - the one paid draft, the merge and the deploy.

## Risks

- **Whisper is too big or too slow on the team's laptops.** T3-3 measures it before anything is built on it. The backup needs Levi's OK. Typing always works.
- **App Platform may not serve the model's files.** T3-5 checks before building.
- **Contour may have no HubSpot teams.** Then "My team" stays hidden, and nothing else changes.
- **Sorting by last activity could slow the Companies list.** T1-6 measures it and must pass the speed test.
- **The AI script starts by itself in call prep,** so a rep who only wants to look costs up to US$0.25 a company. A prep in the last 7 days is reused for free. Question 3 can turn it into a button.
- **The live bars on a slow laptop.** Transform only, at most 30 updates a second, and checked at 4x CPU slowdown.
- **PLAN-V17's open steps** may touch the same files later. Finish or park them before M1, or merge `master` into the tracks first.

## Not in this plan

- **A view of the team's call logs.** It waits for Levi.
- **Calls logged straight in HubSpot** don't show in History. The company's own page keeps its "Call history".
- **A paid speech service,** like Deepgram. Only if both tools in T3-3 fail, in its own plan, with Levi's OK.
- **A phone app.**
- **Found while planning, for their own tasks:**
  - Any signed in account can change the Settings switches and spending limits (`core/api/settings.py` has no Admin check). This matters once reps have their own accounts.
  - The HubSpot check doesn't test the permission to write meeting notes (`core/hubspot/check.py`, `ACTIVITY_WRITE_KINDS` has no `meetings`). So a missing permission would show only when a pre-read is sent.

## Log

- 16 Nov 2026: plan written from Al-khair's list of changes. Nothing built.
- 16 Nov 2026: Al-khair said "Please implement this all the way" and went to sleep. S0 done. The lead session runs the three tracks with one agent each, and is the go-between for their messages (the tracks write requests in their Logs). Steps that need Al-khair (T3-3 at the keyboard, each look, the paid draft) are marked waiting, and the tracks carry on around them. No push and no deploy without `deploy v18`.
