# The Companies refresh: plan, version 18

This plan makes the Companies module clearer and nicer to use, from Al-khair's list of 16 Nov. "Activity" becomes "Call logs". Meetings shows everyone's meetings by default, with three filters and a Sync button. People see that AI drafts the pre-read, and the pre-read becomes a centered form. Companies sorts by last activity. Call logs gets a real mic with a quick mic check, and a call history. Call prep opens straight on the quick facts. Every part moves smoothly, like a well made iPhone app, and every failure says what happened and what to do. Three Claude sessions build it at the same time, in three tracks that never touch the same files.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama. **Signed off by:** Al-khair for the code and every screen. Levi confirms the rules marked **TBC with Levi**.
- **Last updated:** 16 Nov 2026 (M1 done: the three tracks joined into `plan-v18`, every check passed, and `master` moved to it; not deployed).
- **Progress:** S0: 1 of 1. Track 1: 9 of 9. Track 2: 4 of 8. Track 3: 4 of 9. Merge and deploy: 1 of 3.
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

**Progress:** 9 of 9. Every step is `backend-agent` work.

- [x] **T1-1. Own copy and a baseline.** Done 2026-11-16, on `40d9912` (see the Log). Make the worktree and the database. Run the backend tests once and note the counts. Note `test_companies_speed`'s time too: it was about 560ms against its 300ms limit on this laptop before this plan.

- [x] **T1-2. Ask HubSpot two things.** Done 2026-11-16, read only, no code (see the Log). Free, read only. It loads the real key into the process only.
  - **Teams:** does HubSpot's owners list give each owner's `teams`? How many owners are in a team, and the teams' names. Write names and counts in the Log, never an email.
  - **Last activity:** read the company field list. Which field is "Last activity date" (we expect `notes_last_updated`)? How many companies in our copy would have it, against "Last contacted"?
  - If HubSpot has no teams, send Track 2 a message ("My team" stays hidden) and tell Al-khair.
  - **Done when:** the Log has both answers.

- [x] **T1-3. Teams and last activity in our copy.** Done 2026-11-16 (`a5a4518`).
  - Migration `0024_v18_teams_activity`:
    - a new table `core.hubspot_owner_teams` (owner id, team id, team name, primary or not);
    - `core.hubspot_companies.last_activity` (a time), from the field T1-2 named;
    - an index for the History list on `companies.call_notes` (`made_by`, `called_at` newest first).
  - The sync reads both. Teams are replaced in full at each sync. `fields.yaml` and `FakeHubSpot` follow.
  - The activity writer sets `last_activity` on our copy when a call lands in HubSpot, so the list is right before the next sync.
  - Run `scripts/schema_map.py`, and add the new table to the four table lists.
  - **Done when:** tests prove teams saved and replaced, `last_activity` read, the writer's update, and that the schema map matches.

- [x] **T1-4. Meetings: All, My meetings, My team** (the contract, part 1). Done 2026-11-16 (`88e8274`).
  - `who` in place of `mine`, with `all` as the default.
  - All is in time order. Each item says `mine`.
  - The page's new fields: `linked`, `team_state`, `team_names`.
  - The "not linked" sentence shows on Mine and Team only, never on All. A new sentence for "no team" ("Words for when things go wrong").
  - With sign in switched off there is no user: All works, and `linked` is false.
  - **Done when:** tests cover each `who`, an unlinked account, no team, two teams, sign in switched off, and the order.

- [x] **T1-5. Meetings: Sync now** (the contract, part 1). Done 2026-11-16 (`854c94e`).
  - `POST /meetings/sync`: a full read of the window, now. It skips the 15 minute rule and the 60 second ask rule.
  - It keeps: one read at a time, the save lock (`MEETINGS_LOCK`), and the key check. A press within a minute of the last finished read answers `fresh` and asks HubSpot nothing.
  - It answers at once. The read runs in the background, and the list's `syncing` says so.
  - The list gains `checked_at` and `sync_problem`.
  - Log lines carry counts and times, never meeting titles.
  - **Measure,** with the real key in the process only: the requests and the seconds for one press on the dev copy (599 meetings). Write both in the Log, and send Track 2 the seconds for its words.
  - **Done when:** tests prove `started`, `running` and `fresh`, a failed read (the sentence shows, and the old copy stays), a missing permission, no key, and that the daily sync and a Sync never save at the same time.

- [x] **T1-6. Companies: last activity first** (the contract, part 2). Done 2026-11-16 (`57fc0e2`).
  - `last_activity` becomes the default sort, newest first. Empty values go last, then A to Z.
  - Lead Finder rows that aren't in HubSpot have none, so they go last.
  - Old links with `sort=name` still work.
  - `test_companies_speed` must pass. If the new sort is slower, find why (the list is sorted over a joined subquery) and fix it before moving on.
  - **Done when:** tests cover the order, empty values, ties and old links, and the Log has the speed before and after.

- [x] **T1-7. Call notes: History** (the contract, part 3). Done 2026-11-16 (`4a7e821`).
  - `state=history`, and the filters `q`, `outcome`, `since` and `until`.
  - Only my own notes, as today. Another rep's notes never show.
  - **Done when:** tests cover each filter, the order, paging, and someone else's notes, and a speed check with 2,000 notes stays under 300ms.

- [x] **T1-8. The words, and the voice setting.** Done 2026-11-16 (`503dd9c`, `bdcdcde`).
  - "Activity" becomes "Call logs" in the Settings help (`core/prefs/service.py:242`) and in `schemas.py:570`.
  - The new sentences in "Words for when things go wrong": Sync, no team, the two draft failures.
  - Each route's description lists every error code it can answer. Some are missing today: `meeting_time_missing` on `POST /meetings/forms`, and `no_one` and `form_sending` on the send route.
  - A test: every problem in `apps/companies/` and `core/hubspot/meetings.py` has a title and a next step, and none names a setting or a file (the scanner in `test_safe_deploys.py`).
  - The `voice_tool` setting (the contract, part 4), on the Settings page, and in `GET /call-notes/options`.
  - **Done when:** the tests pass, and the screen words scanner passes.

- [x] **T1-9. Track 1 check.** Done 2026-11-16 (tag `v18-t1`). review-agent: run by the lead at M1.
  - Every backend test (`RUN_GATES=1`), and `uv run engine openapi` to prove the contract builds (the generated files are made again at M1).
  - The `security-check` skill on the whole diff.
  - A fresh `review-agent` reviews the diff against this plan.
  - Tag `v18-t1`. Send the others a message.
  - **Done when:** all of it passes, and the Log says "Track 1 ready to merge".

### Track 1 Log

- 16 Nov 2026, T1-1: the baseline on `40d9912`, all backend tests with `RUN_GATES=1` on `leadfinder_test_v18a`: 4,634 passed, 1 failed, 25 skipped, in 15 min 54 s. The one failure is `test_companies_speed`: `city=Perth&deal=open` took 543 ms against its 300 ms limit. Its other pages took 39 to 51 ms (the default list, by name, 39 ms), and the prep box 44 ms.
- 16 Nov 2026, T1-2, read only, with the real key in the process only:
  - **Teams: yes.** HubSpot's owners list gives each owner's `teams` (an id, a name, and whether it is the main one), in the dated API and in v3. 26 active owners, 11 of them in a team, none in two: Admin (6), Business Development (4) and Archive Team (1). None of the 35 archived owners is in a team. HubSpot's own list of teams needs a permission the key doesn't have (`settings.users.teams.read`); the owners list is enough, so it isn't needed. So "My team" stays, and `team_state` is `ready` for the 11 and `no_team` for the other 15.
  - **Last activity: `notes_last_updated`** ("Last Activity Date", a date and time). Of HubSpot's 13,918 companies, 12,900 have it and 10,253 have "Last contacted" (`notes_last_contacted`). Every company with Last contacted has Last activity date too, and 2,647 have Last activity date only. In a sample of 200 with both, Last activity date was newer in 33 and the same in 167, never older. Our copy has 13,919 companies, 10,253 with Last contacted. So the list's `last_activity` is in effect HubSpot's Last activity date, with Last contacted as the fallback.
- 16 Nov 2026, T1-3 (`a5a4518`): migration `0024_v18_teams_activity` (the teams table, `core.hubspot_companies.last_activity`, and the History index on `companies.call_notes`), applied to `leadfinder_v18a`, with `engine/schema/SCHEMA-0024.md` (`--check` matches). The sync replaces every owner's teams each time. A company's `last_activity` never moves back: a save keeps the newer of ours and HubSpot's, so a call our copy noted when it landed stays, and an export leaves it alone. Whether a changes sync sees a new activity at once depends on HubSpot moving the company's modified date (**TBC**); the full sync always does. 356 tests that T1-3 touches pass, and 177 more that read our copy.
- 16 Nov 2026, T1-4 (`88e8274`): `who` (`all`, `mine`, `team`) in place of `mine`, as the contract says. All, My meetings and My team read the whole window, then pick in code, always in time order. Each item has `mine`. Sentences: "not linked" on My meetings (and its My team twin, which says "My team is empty"), "no team", and two the plan didn't list: HubSpot has no teams (for an old `who=team` link while the website hides the filter) and nobody signed in (sign in switched off: My meetings and My team are empty, All works, `linked` is false, `team_state` is `not_linked`). The new `MeetingPage` and `MeetingItem` fields are optional in the website's types (`optional_in_types`, as PLAN-V14 to V17 did): the API always sends them. A company's record marks my own meetings too. The summary of the route says "Client meetings" now.
- 16 Nov 2026, T1-5 (`854c94e`): `POST /companies/meetings/sync` and the list's `checked_at`, `syncing` and `sync_problem`. "One read at a time" is kept in the backend's memory (one backend runs for a database): while any read of HubSpot's meetings runs (the daily one, a refresh or a Sync), Sync answers `running` and a refresh skips itself. `fresh` needs the newest read to be a good one under a minute old, so after a failed read a press reads again at once. A HubSpot failure never fails the press: the list's `sync_problem` says "HubSpot didn't answer, so this list is from 6:00 pm. Try Sync again in a minute." (the time in Melbourne, with "yesterday" or the date when it isn't today), or the waiting words when a permission is missing. The 503 detail is the contract's sentence plus one next step: "An admin can connect it on the HubSpot page in Admin."
- 16 Nov 2026, **T1-5's measure** (the real key in the process only, read only, the full read Sync runs, on `leadfinder_v18a`): one press is **15 requests** (3 search pages and 12 link reads, 6 for companies and 6 for people) and took **10.2, 12.5 and 13.2 seconds** in three presses. The first press of the day took 64 s and 17 requests: 2 search pages were asked again after HubSpot was slow (which answer it gave is not confirmed). The copy went from 599 to 597 meetings (6 changed, 2 left the window). **For Track 2's words:** "Already checking HubSpot. It takes about 15 seconds." The time goes on the link reads, one after another; reading companies and people side by side would save about 3 seconds (not done: not in this plan).
- 16 Nov 2026, T1-6 (`57fc0e2`): `last_activity` is the default sort, newest first, as a Melbourne day; an empty one goes last, then A to Z by name, then by key; `order=asc` starts with the oldest and keeps the empty ones last. Lead Finder rows have none. **Speed, `test_companies_speed`, best of 3:** before (the baseline's full run) the default list by name took 39 ms and `city=Perth&deal=open` 543 ms; after (the test alone) the new default takes 37 to 40 ms, `sort=last_activity&offset=5000` 45 to 48 ms, `sort=name` 39 ms and `city=Perth&deal=open` 65 ms. The new sort isn't slower. The slow one was the city filter, not the sort: "city = x OR EXISTS (an office there)" made Postgres guess a cost of 116,000 (30 times too high), so it compiled the query (JIT) on every page, which took about 75 ms alone and 543 ms while the laptop was busy. The city filter is now one list of ids (`IN (... UNION ...)`), with a cost near 2,000 and no compiling. The full run at T1-9 checks it again.
- 16 Nov 2026, T1-7 (`4a7e821`): `state=history` and the filters `q`, `outcome`, `since` and `until`, for any state. History is always the caller's own notes, even for an Admin who asks for everyone's (`mine=false`); with sign in switched off every note shows, as everything else does then. `q` uses the same words rule as Meetings: each word must start a word of the company's name, the person's name, the note or the summary (a mark inside a word counts, like O'Brien; marks around it don't). `outcome=none` is a note with no outcome picked. `since` after `until` answers 422 `dates_out_of_order` ("Pick a start day on or before the end day."), a word the contract didn't name. **Speed** with 2,000 of my notes and 1,000 of another rep's (best of 3): History 19 ms, its page 31 (offset 1,500) 20 ms, a search for two words 34 ms, an outcome since a day 21 ms. The limit is 300 ms.
- 16 Nov 2026, T1-8 (`503dd9c`, `bdcdcde`): "Call logs" in the Settings help and in `CallNoteOptions.enabled`. The `voice_tool` setting (`browser_model` by default, `browser_service`, `typing`) is on the Settings page and in `GET /call-notes/options`. The sentences Track 2 shows: "Meetings can't be read from HubSpot yet. You can still start a new pre-read.", the waiting one, the two draft failures (the AI limit, and the AI service, with "is busy", "took too long" and "isn't set up" in the same pattern), and "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send it once email is set up.". `POST /meetings/forms` now names `meeting_time_missing`, and the send route `no_one` and `form_sending`. **A next step on every problem:** a new test (`tests/companies/test_problem_words.py`) reads every `Problem`, `refused` and `HubSpotError` in `apps/companies/` and `core/hubspot/meetings.py`; 22 details had none and now end with one, like "Go back to the list and pick it again." (company, note, call prep and pre-read not found), "Change it in HubSpot instead." (a note already sent), "Press Sync, then look for it again." (a meeting not found) and "Ask an Admin." The admin's sync warning keeps the permission's name; the Meetings page gets the plain one. **Asked by Track 2, through the lead** (`bdcdcde`): a failed pre-read whose three summaries the rep has written is a draft again (its error goes), so "write them yourself" leads to a send; with one or two written it stays failed. No new field.
- 16 Nov 2026, T1-9: **every backend test with `RUN_GATES=1`: 4,682 passed, 0 failed, 25 skipped, in 12 min 29 s** (the baseline was 4,634 passed and 1 failed). `uv run engine openapi` builds the contract (the gate passed on it); the generated `openapi.json` was put back, for M1 to make again with `npm run types`. `test_companies_speed` passed in the full run too (the whole test took 2.4 s, against 4.7 s at the baseline), so the city filter's fix holds on a busy run. The `security-check` skill on `plan-v18...plan-v18-track1`: no blocker. No key, token or real address is in the diff; the T1-2 and T1-5 scripts read the HubSpot key into their own process only, with writing off, and stay outside git. HubSpot is only read (the owners list, the company fields, and the meetings search and links); the one write path, the activity writer, now also moves our copy's `last_activity`. The new route `POST /companies/meetings/sync` sits behind the sign-in guard and the Companies tick, like every Companies route. History shows only the caller's own notes, and its search escapes every mark, so a search can't become a pattern. Log lines carry counts and seconds only. One note, not a blocker: after a failed read, Sync reads again at once, so many presses in a row each cost about 15 HubSpot requests; one read at a time and HubSpot's own pace keep it small. review-agent: run by the lead at M1.
- 16 Nov 2026, **for the other tracks (the lead passes it on; no message was sent):**
  - **Track 2:** Sync takes about 15 seconds ("Already checking HubSpot. It takes about 15 seconds."). `fresh` comes only after a good read; after a failed one a press reads again. `sentence` now holds the whole not ready sentence, "You can still start a new pre-read." included, so don't add it twice. The 503 detail is the contract's sentence plus "An admin can connect it on the HubSpot page in Admin." With sign in switched off, `team_state` is `not_linked` and My meetings and My team say "Nobody is signed in ...". An old `who=team` link while HubSpot has no teams says "HubSpot has no teams yet ...". A failed pre-read is a draft again once its three summaries are written. `CompanyRow.last_activity` is a Melbourne day, or null.
  - **Track 3:** `GET /call-notes?state=history` with `q`, `outcome` (`none` too), `since` and `until`; days the wrong way round answer 422 `dates_out_of_order` ("Pick a start day on or before the end day."), a code the contract didn't list. `GET /call-notes/options` has `voice_tool`.
  - **Both, at M1:** every new field on an answer that existed (`MeetingPage`, `MeetingItem.mine`, `CompanyRow.last_activity`, `CallNoteOptions.voice_tool`) is optional in the generated types, as PLAN-V14 to V17 did; the API always sends it. Many problems' details now end with a next step, so a website test that copied an old detail word for word may need the new one. The Settings page puts `voice_tool` in its default group until `src/apps/lead-finder/admin/settings-groups.ts` (no V18 track owns it) maps it to `notes`; it shows the raw choices (`browser_model`, `browser_service`, `typing`) unless the website names them.
- 16 Nov 2026: **Track 1 ready to merge.**

## Track 2: Meetings, the pre-read and the Companies list (session 2)

**Progress:** 4 of 8 (T2-3 to T2-6 are built and wait for a look). Every step is `frontend-agent` work. It follows `engine/DESIGN.md` and "How it should look and move", uses the `ui-build` skill, and builds against the contract with `mockApi`.

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

- [ ] **T2-5. The pre-read as a centered form.** Built 2026-11-16 (`36ea3d4`), waiting for a look and the screenshots.
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

- [ ] **T2-6. Companies: the newest activity first.** Built 2026-11-16 (`8faf704`), waiting for a look.
  - The default sort is `last_activity`, newest first. The "Last activity" column shows `last_activity`, and its header shows the sort arrow.
  - Old links with `sort=name` still work. Home's prefetch asks the same request as the page.
  - Phone cards say "Last activity" and follow the same order.
  - **Done when:** tests cover the default, the column, old links and the phone cards. Al-khair has seen it.

- [x] **T2-7. Errors on Meetings and the pre-read.** Done 2026-11-16 (`c603834`).
  - Every row of its table in "Words for when things go wrong", with its button.
  - `problemHint` (`lib/problems.ts`) gains hints for the meetings codes.
  - **Done when:** a test shows every row, and `screen-words.test.ts` passes.

- [x] **T2-8. Track 2 check.** Done 2026-11-16 (`4e564e6`), with four checks left to the lead session at M1 (see the Log).
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
- 16 Nov 2026, T2-5 (`36ea3d4`), built and waiting for a look. One card, `max-w-[52.5rem]` (840px, TBC), `mx-auto`, with Back and the header in the same column. Sections (`pre-read/form-section.tsx`): 1 The meeting (Date, Time, Teams or in person from the form's own copy, so they show at once; then Who we meet and Contour people), 2 The company (the company as a link, then the server's facts in its order; any new fact label goes here), 3 The summaries (boxes typed into, saved when left, `use-blank.ts` and `SaveNote` for "Saving." and "Saved."), 4 Your part (two blanks with a star and `aria-required`). The footer (`FormFooter`) is sticky at the form's bottom, fixed on a phone, and is gone while the pre-read is sent and unchanged, as the bar was. The draft's steps sit at the top of the card. The send dialog's "Add someone" label now has the form's label style. 70 pre-read tests pass. Two points for the look: the footer's status repeats the header's status word (the plan asks for it in the footer; the header's stays for its tick when sent), and the facts' "When" is split into Date and Time on the website. The screenshots at 1440, 1280 and 390px, light and dark, wait for the lead session's browser check after M1.
- 16 Nov 2026, T2-6 (`8faf704`), built and waiting for a look. `last_activity` is the default sort (`DEFAULT_SORT`, first order `desc`), so a plain list has a plain address and `sort=name` is now written when chosen. The "Last activity" column has the id `last_activity` and shows `last_activity` through a new `LastActivity` mark (Ochre after 6 months with no activity, "None on record" when there is none); `sort=last_talk` still works, but no column shows its arrow. Phone cards say "Last activity". Home's card asks with `HOME_COMPANIES`, the same `listQuery` as the page. Hand written until M1, in `apps/companies/params.ts`: `lastActivityOf(row)` and the cast of `sort` in `listQuery`. 6 tests in `list-sort.test.tsx`; the Companies and Home tests pass.
- 16 Nov 2026, T2-7 (`c603834`): every row of "Meetings and the pre-read" shows with its button, and a describe in `meetings.test.tsx` (8 tests), `pre-read.test.tsx` (the two draft failures) and `send.test.tsx` (email not set up) walks through them. Where each shows: not read yet and no permission in the waiting line, with New pre-read; Sync's failure, running and "a moment ago" in the line under the toolbar, with Sync; not linked and no team as the empty state of My meetings and My team, with "Show all meetings"; the draft's failures in the draft's steps, with Try again; email not set up in the send dialog, with a new "Copy the pre-read" (it copies the email's subject and plain text); no connection as the quiet line that points at the connection bar. `problemHint` gains four hints, only where the server's words have no next step: `hubspot_not_connected`, `meeting_not_found`, `form_not_found` and `email_not_set_up`. For M1: `lib/problems.ts` isn't in the table of owners, and Track 3's T3-8 adds its hints there too; Track 2's are a block of their own at the top of `HINTS`. The words for a press while Sync runs, and for "a moment ago", are the website's own (`MeetingsSyncOut` has no sentence); the rest come from Track 1. The screen-words test passes.
- 16 Nov 2026, T2-8 (`4e564e6`). Lint, types and Prettier pass; 119 test files and 1,698 tests pass (335 s on one worker; T2-1 had 116 and 1,640); the build passes. First visit: 232 kB gzip (723 kB raw) in 35 files, CSS 23 kB: no growth in gzip over T2-1 (the raw main file is 1 kB bigger, from the four hints in `lib/problems.ts`). The late motion file stays 14 kB of its own, 33 kB with what it loads.
  - `speed-check` on Meetings: the page is 39 kB over the first visit (37 at T2-1; its own file 9.5 kB, was 7.9), the pre-read 36 kB (34; 11 kB, was 9.6), Companies 98 kB (97), Home's meetings card 19 kB (17). No new library. Searches still wait 250ms; the list asks every 2 seconds only while HubSpot is being read, and stops after. Lighthouse not run: it needs a browser.
  - `design-review` on Meetings, New pre-read, the pre-read and Companies: the design-lint, contrast, screen-words, icons and fonts tests pass (263 tests). Fixed in `4e564e6`: two gaps of 20px in the pre-read are now 24px (DESIGN.md "Spacing"), and the footer's status has its icon (DESIGN.md "Every status has an icon and a word"). Ideas for Al-khair's look (TBC): (1) the footer's status repeats the header's word, as the plan asks (principles 03 #2, "Say it once"); (2) "My team" shows until the first list says HubSpot has no teams, then goes: one small shift on a first visit, only if Contour has no teams; (3) a new list fades in with no 150ms fade out of the old one (T2-3); (4) `Segmented` is 40px tall on touch (`touch:min-h-10` in the kit), under the plan's 44px: a change to the kit, which isn't Track 2's file; (5) `new-pre-read.tsx` and `log-meeting.tsx` keep PLAN-V17's 20px gaps (`gap-5`, `p-5`), not changed here.
  - Keyboard and reduced motion are proven by tests (the choices' arrows, Tab saves a field, Ctrl+Enter, Sync, the steps, the form's sections, the new rows), not by hand.
  - **Skipped tonight, on the lead's overnight rules:** each screen in a browser at 1440, 1280 and 390px, light and dark (the lead checks them after M1); the 4x CPU trace in Chrome (the lead, after M1); the one real pre-read draft, about US$0.03, which waits for Al-khair's word (so "about 20 seconds" stays TBC); and a fresh `review-agent` (the lead runs it at M1). No message to the other sessions: the lead carries this Log.
  - **DESIGN.md lines for Track 3** (T3-9, after Al-khair's look), for "Motion":
    - **An icon that turns once** (`SpinOnce`): a refresh icon turns one full turn for each press, on `smooth` (400ms, no bounce), as on Meetings' Sync. A second press while it turns carries on from where it is and ends one turn further. It never loops, and the words beside it say what is going on ("Checking HubSpot"). With reduced motion it stays still. (PLAN-V18 T2-2, T2-3)
    - **Steps that fill as they arrive** (`StepTrail`): a few steps in a row, like the pre-read's "Reading HubSpot", "Writing the summaries" and "Ready for you to check". A dot fills only when the server says its state has arrived, never on a timer: it grows from its centre on `soft`, and the line to it fills along on `snappy`, both as a scale. The fill is the accent, as progress is. A failure stops the trail at its step, with a Terracotta cross and the reason beside it. With reduced motion the dots are simply filled. (PLAN-V18 T2-2, T2-4)
  - **For M1:** replace the hand written types in `api/hooks/meetings.ts` (`MeetingWho`, `MeetingListQuery`, `MeetingListItem`, `TeamState`, `MeetingListPage`, `MeetingsSyncOut`, `untypedApi`) and `apps/companies/params.ts` (`lastActivityOf`, the cast of `sort` in `listQuery`) with the generated ones. The shared files: `components/motion/index.ts` gains one block at its end; `lib/problems.ts` one block at the top of `HINTS`; `src/test/mock-api.ts` is untouched.
  - Track 2 ready to merge.

## Track 3: Call logs, the mic, the history and call prep (session 3)

**Progress:** 4 of 9. Every step is `frontend-agent` work. It follows `engine/DESIGN.md` and "How it should look and move", uses the `ui-build` skill, and builds against the contract with `mockApi`.

- [x] **T3-1. Own copy and a baseline.** Make the worktree. Run lint, types, the tests and the build once. Note the counts and the first visit size from `node scripts/bundle-report.js`. Done 2026-11-16 on `40d9912` (numbers in the Log).

- [x] **T3-2. Call logs, the new name.** Done 2026-11-16: `59ac46d` (the `git mv` alone) and `fb9673a`.
  - First, alone in its own commit: `git mv` the folder `apps/companies/activity/` to `apps/companies/call-logs/`.
  - The address `/companies/call-logs`. `/companies/activity` sends you on, with its tab and `log=1`. `tab=logged` becomes `tab=history`.
  - The menu says "Call logs" (pick a Lucide icon that reads as a list of calls). The crumb, the browser tab ("Call logs - Contour"), and the page title "Call logs" follow. The description: "Every call you logged. Check new ones, send them to HubSpot, and look back at old ones."
  - The tabs: "To confirm", "History" and "Needs a look".
  - Ctrl+K: "Call logs". Its keywords keep "activity", so old habits still find it. Home's buttons and the tests follow, and DESIGN.md's mentions too.
  - **Done when:** tests cover the new address, the old address with its tab, the menu, the crumb, the title, and Ctrl+K found by "activity" and by "call logs".

- [ ] **T3-3. Which voice to text tool?** Needs Al-khair at the keyboard, about 15 minutes. Free. Waits for Al-khair at the keyboard.
  - Read the current docs first: Transformers.js (the Whisper models, Web Workers, WebGPU and its fallback) and the browser's Web Speech API. Don't build from memory.
  - A throwaway test page, never merged, with the mic card's live bars. Al-khair says 10 short notes with real Australian company and people names, on his own laptop, in Chrome or Edge.
  - Try two tools:
    - **(a) Whisper in the browser,** English, base and small. Free, and the voice never leaves the laptop.
    - **(b) The browser's own speech service** (Web Speech, `en-AU`). Free, and the words come live, but the voice goes to Google or Microsoft.
  - Note for each: the names it got wrong out of 10, the seconds to the first words, the seconds to write out a 60 second note, and the download size and time to be ready.
  - **Decide (choice 8):** (a) if it gets at most 1 name wrong in 10 and writes out a 60 second note in 10 seconds or less. Else (b), but only once Levi says yes. Until then, `typing`.
  - No recording is kept. The notes' text stays out of git.
  - **Done when:** the Log has the numbers and the decision, and `voice_tool` is set to match.

- [ ] **T3-4. The mic card and the mic check.** This works before any voice tool: it shows the bars and checks the mic. Built 2026-11-16 (`1ec532d`, `3e75301`, `dda777a`, `625d6ec`), waiting for a look. The 30 frames a second at 4x CPU slowdown is not measured yet (no browser tonight).
  - **The mic button:** round, 44px, in the corner of the note box on Log call, named "Speak" for screen readers. The Win+H line is gone.
  - **The card (`MicSheet`)** grows from the button. Its title moves through "Checking your mic", "Speak now", "Writing it out" and "Done".
  - **The check,** in under 2 seconds. Four lines tick as their real results come in: "Mic found", "Allowed", "We can hear you", and "Voice to text ready". A failure shows its words from the table and stops there.
  - **The bars (`FrequencyBars`):** 24 bars from the mic's own sound (`AnalyserNode`), transform only, up to 30 updates a second, and still when you are silent.
  - **Which mic:** its name, like "Headset (Jabra)", with "Change" to pick another. It is remembered on this computer.
  - **Buttons:** "Done" (Enter), "Cancel" (Esc: nothing goes in the box), and "Type instead".
  - **The mic is let go** the moment the card closes, so the browser's red dot goes too.
  - **"Check my mic"** in Ctrl+K and in the profile menu opens the card in check only mode.
  - **Done when:** tests with a fake mic cover each check line, each failure, silence, a mic change, Esc, and the mic let go on close. The bars hold 30 frames a second at 4x CPU slowdown. Al-khair has seen it.

- [ ] **T3-5. Voice to text inside the card** (the tool T3-3 picked). Built for the browser service and the seam (`3e75301`, `5299046`); Whisper waits for T3-3.
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

- [ ] **T3-6. History.** Built 2026-11-16 (`ae22de0`), waiting for a look.
  - The calls are grouped by day: "Today", "Yesterday", "Mon 14 Nov". Each day's heading stays at the top while you scroll its calls.
  - **Each call is one row:** the time, the company, the person, how it went (a coloured dot and a word, never colour alone), the summary's first line, and where it stands ("In HubSpot", "To confirm", "Needs a look" or "Sending"). Small marks show its follow ups and field changes, and how it was logged (mic, typed or transcript).
  - **Press a row and it opens in place:** the whole note, the changes (old value to new), the follow ups, each step's result, "Open in HubSpot", and "Log another call with {company}".
  - **A search box** (company, person, or words in the note) and **filters:** how it went, as chips; when ("This week", "This month", "All"); and where it stands.
  - "Show older" at the bottom brings 50 more.
  - **Empty:** "No calls logged yet. Press Log call after your next call, and it shows here." With a filter on: "No call matches that. Clear the filters to see all your calls."
  - **Keys:** J and K move, Enter opens, and / goes to the search.
  - **Done when:** tests cover the day groups, a row opened, each filter, the search, "Show older", the empty and error states, and the keys. Al-khair has seen it.

- [ ] **T3-7. Prep opens on the quick look.** Built 2026-11-16 (`84c0ef7`), waiting for a look.
  - Pressing Prep opens the panel straight on the quick look. The "Who are you calling?" screen goes.
  - **The quick look,** from `GET /companies/{key}/facts` (no AI): the company, the owner, the deal and its stage, staff, the next lease end, the last talk (when, with whom, how it went), the next meeting, and the phone number with Copy.
  - **A "Calling" row** under it names the person. It defaults to the last person we talked to, else the first person on record, else "Cold call (switchboard)". Press it to change: a short list drops down, with the people, then the cold call.
  - The script follows below, as today: the free script at once, then the AI script (choice 11). Changing the person changes the script, as picking does today.
  - **It shows at once:** the facts are fetched when the pointer rests on Prep for 150ms, or when Prep gets keyboard focus.
  - **Done when:** tests cover no first screen, each default person case, a change of person, the prefetch, and a failed facts read. Al-khair has seen it.

- [x] **T3-8. Errors on Call logs, the mic and call prep.** Done 2026-11-16: `86ca7f2` (and the mic's rows in `3e75301`).
  - Every row of the mic table, and of the Call logs and call prep table, in "Words for when things go wrong", with its buttons.
  - `problemHint` gains hints for the call notes codes.
  - **Done when:** a test shows every row, and `screen-words.test.ts` passes.

- [x] **T3-9. Track 3 check.** Done 2026-11-16: `b936171`, `5ecea40`, `9793429`, tag `v18-t3` (numbers in the Log). By the overnight rules, the screenshots, the look at each width, the 4x CPU trace and the fresh `review-agent` move to the lead session at M1, and no message was sent: this Log carries everything.
  - Lint, types, the tests, the build and `node scripts/bundle-report.js`. The first visit may grow by 1 kB at most over T3-1.
  - The `design-review` skill on each changed screen, and `speed-check` on Call logs with the mic.
  - Each screen at 1440, 1280 and 390px, light and dark, by keyboard only, and with reduced motion.
  - 4x CPU slowdown in Chrome's performance panel: the mic card opening, the bars, a History row opening, and the Prep panel. No dropped frames.
  - A fresh `review-agent` gives its own `design-review`.
  - DESIGN.md gains the lines Al-khair agreed to: its own and Track 2's.
  - Tag `v18-t3`. Send the others a message.
  - **Done when:** all checks pass, and the Log says "Track 3 ready to merge".

### Track 3 Log

- 16 Nov 2026, T3-1: the worktree `../contour-v18-t3` on `plan-v18-track3`, made by the lead session. Baseline on `40d9912`: lint clean, types clean, 116 test files and 1,640 tests passed (vitest, one worker, about 5 minutes), the build passed. First visit: 232 kB of JavaScript gzip (237,792 bytes; 739,690 raw) in 35 files, and 23.3 kB of CSS gzip (23,851 bytes). So T3-9's limit is 238,816 bytes of JavaScript gzip.
- 16 Nov 2026: the overnight rules from the lead session win where this plan differs. T3-3 waits for Al-khair at the keyboard. No new package and no model download. Steps that need Al-khair's look are built, tested and left unticked with "waiting for a look". No messages to the other sessions: anything they need is written here.
- 16 Nov 2026, T3-2: `59ac46d` moves the folder alone, `fb9673a` renames the rest. The menu's icon is Lucide's `PhoneLog`. History shows Activity's old Logged list until T3-6. The old address is sent on by `call-logs/old-route.tsx`. The Settings test's fixture now says "Call logs page" (rule 6); Track 1's real help text (T1-8) replaces it on the server. `meetings/words.ts` now says "in Call logs" (Track 2 changed it, as the lead passed on).
- 16 Nov 2026, T3-3: waits for Al-khair at the keyboard. No package was added and no model downloaded.
- 16 Nov 2026, T3-4 built (`1ec532d` the motion parts `FrequencyBars` and `MicSheet`, `3e75301` the card, the check and the seam, `dda777a` the button in the note box, `625d6ec` Check my mic), waiting for a look. 24 mic tests, 7 bar tests and 5 sheet tests, all with a fake mic (`call-notes/mic/fake-mic.ts`). Choices made on the way, each **TBC** at the look:
  - **The mic button is square, not round.** The plan says round; DESIGN.md bans fully round buttons and `design-lint` fails `rounded-full`. It is a 44px square with the 10px corner.
  - **Blocked by Windows** is read from the browser's own words ("Permission denied by system"), or from a refusal while the site's permission says Allow. What Chrome on Windows says when Windows blocks the mic is not confirmed: if it says "Could not start audio source", the card shows the "Another app" words instead. T3-3 at the keyboard can check it by switching Windows' mic access off.
  - **The levels:** a voice is a wave over 0.015 RMS, and the bars ignore a band under 0.06 (a room's hum). Both are guesses until a real mic is tried.
  - **The four ticks stay in view 500ms** once they all pass, then the words take their place. A Mac gets its own "blocked by the computer" sentence (System Settings), the plan's Windows one stays for Windows.
  - **Two new slots for any project** (Track 3's shell files): `AppModule.accountItems` (rows in the account menu, before Sign out) and `AppModule.frame` (a part drawn once in the frame), and Ctrl+K entries get `run()`. They carry Check my mic. `call-note-parts.ts` is in no track's list; Track 3 changed it (the rename and two late parts), since it loads call notes' parts.
- 16 Nov 2026, T3-5 built for the browser service and the seam (`3e75301`, `5299046`). The seam is `call-notes/mic/voice-tool.ts` (start, stop, abort, and onReady, onWords, onHearing, onFinished, onProblem). The browser service runs only with `voice_tool` = `browser_service` (the Settings page now says what each choice does, rule 6). With `browser_model` the card checks the mic, keeps the bars, and its last line says "Turning speech into words isn't set up here yet. Your mic works. Type the note for now." `typing` shows no mic button. Whisper waits for T3-3. The first visit didn't grow from these (the card loads late).
- **For M1 (hand written types):** `VoiceToolKind`, `DEFAULT_VOICE_TOOL` and `voiceToolOf` in `src/api/hooks/call-note-counts.ts` read `voice_tool` from `CallNoteOptions`; tests send it with a cast. Replace them with the generated `CallNoteOptions['voice_tool']`. For History, `CallNoteStateV18`, `CallNoteOutcomeFilter` and `CallNoteHistoryQuery` in `src/api/hooks/call-notes.ts` (with a cast to `CallNoteQuery` in `callNoteHistoryQueryOptions`): replace them with the generated `CallNoteQuery`.
- 16 Nov 2026, T3-6 built (`ae22de0`), waiting for a look. History replaces Logged (`call-logs/logged.tsx` is gone). 9 History tests (day groups, a row opened in place, each filter, the search, Show older, empty, error, keys, the prefetch) and the params tests. On the way, each **TBC** at the look:
  - **"Where it stands"** filters by the contract's `state` (All is `history`, then `logged`, `to_confirm`, `needs_look`). A row still says "Sending" on its own; it isn't a filter of its own, because the contract puts sending under `to_confirm`.
  - **How it went** is a dot and a word: Olive for Connected, Ochre for a voicemail or a live message, Terracotta for a wrong number, grey for the rest. The colours are a guess for the look.
  - **When:** This week starts on Monday, This month on the 1st, both in Melbourne time.
  - Rows glide (Motion's `layout`, by position) only while 50 rows or fewer are loaded.
- 16 Nov 2026, T3-7 built (`84c0ef7`), waiting for a look. Choices, each **TBC** at the look:
  - **The quick look** shows the owner, the deal and its stage, staff, the next lease end and the next meeting. The deal's stage and the next meeting come from the company's record (`GET /companies/{key}`, already fetched by the panel), the rest from the free facts. The last talk keeps its own section under "Calling", and **the number stays in the footer**, so each shows once (DESIGN.md "Say it once"). "More about" is gone: Company info sits beside the quick look.
  - **For Track 2 or M1:** the phone cards' Prep button is in `company-cards.tsx` (Track 2's file), so it doesn't fetch the facts ahead. A phone has no hover; adding the same `onFocus` prefetch there would cover a keyboard. The laptop table's Prep (`company-cell.tsx`) does both.
  - `companies.test.tsx` is in no track's list. Track 3 changed only its call prep tests (the picker became the quick look).
- 16 Nov 2026, T3-8 done (`86ca7f2`). `errors.test.ts` holds every row of both tables word for word, with its buttons; each row is also shown on its own screen by that screen's tests. Call prep off now reads "Call scripts are switched off. The facts from HubSpot still show. An admin can switch them on." `problemHint` gains 16 call notes and call prep codes as one block at the end of `HINTS` in `src/lib/problems.ts` (Track 2's block is at the top, as the lead asked). **For M1:** check those hints against Track 1's T1-8 words and drop any that only repeat the server's detail. `screen-words.test.ts` passes.
- 16 Nov 2026, T3-9 done. The final run on the last commit: lint clean, types clean, Prettier clean, 123 test files and 1,760 tests passed (was 116 and 1,640 at T3-1), the build passed. **First visit:** 238,537 bytes of JavaScript gzip, 745 over T3-1 (the limit is 1,024), and 24,091 bytes of CSS gzip, 240 over.
  - **speed-check, Call logs with the mic:** opening Call logs adds 62 kB gzip on top of the first visit (Activity added 46 kB; History's search, filters and paged list are most of the rest), its own file 18 kB. The mic card is a file of its own (18 kB on top, 7 kB own), fetched when the pointer rests on the mic button, it gets focus, or it is pressed; the first visit carries none of it. Companies adds 103 kB (was 97 kB: the quick look and the mic button). History asks for 50 calls at a time, the search waits 250ms, the page joins the request started for it (tested), and rows never animate above 50. The first speed check found 1,577 bytes over T3-1: the menus' radio parts and five icons were pulled into the first visit through shared code. `5ecea40` keeps them out (`ChoiceItem`, and icons the first visit doesn't use).
  - **design-review** (the skill, on Call logs, History, the mic card, Check my mic, the quick look and Settings): design-lint, contrast, screen-words, icons and fonts pass. Fixed in `b936171`: the mic card never started while developing (React's StrictMode runs effects twice), the card's keys reached the note view behind it, the card jumped when the words replaced the four lines, and History's J and K worked only inside the list. No "Must fix" left. **Ideas, TBC at the look:** the outcome dot colours, the faint dot for "No outcome" (its word carries it), the number left to the footer, "Sending" not being a filter, and the square mic button. `b936171` also carries the mic card's half of the first visit fix, so it builds only together with `5ecea40`.
  - **Not checked:** nothing was seen in a browser: no width (1440, 1280, 390), no dark mode, no keyboard pass by hand, no reduced motion by eye and no 4x CPU trace. The lead checks the screens after M1.
  - **DESIGN.md** (`9793429`): five lines under "Ideas waiting for a decision": the mic card that grows from its button, the bars that follow the voice, Track 2's `SpinOnce` and `StepTrail` (in Track 2's words, passed on by the lead), and the square mic button. None is in "Motion" yet.
  - **The lead's notes:** History sends only `since` (This week, This month), never `until`, so it can't get Track 1's `dates_out_of_order`. Track 1's `voice_tool` matches the hand written `VoiceToolKind`. Website tests that copy an old server detail word for word are the lead's to fix at M1.
  - **Track 3 ready to merge,** with T3-3 waiting for Al-khair at the keyboard, T3-4 to T3-7 waiting for his look, and T3-5's Whisper half waiting for T3-3.

## Merge and deploy

- [x] **M1. Join the tracks** (`merge v18`, on Al-khair's word). Done 2026-11-16 by the lead session, on "Please implement this all the way". Both reviews said Ready with notes, and their fixes are in. Details in the Log.
  - A fresh `review-agent` runs the `merge-check` skill first. It must say Ready.
  - In a worktree on `plan-v18`: merge `plan-v18-track1`, then `-track2`, then `-track3`, each with `--no-ff`.
  - The known joins: keep both sides in `src/components/motion/index.ts` and `src/test/mock-api.ts`. Run `uv run engine openapi` and `npm run types`, then replace the hand written types with the generated ones.
  - Run every test and build on the joined branch.
  - Then move `master`: `git merge --ff-only plan-v18` in the main folder. If it won't fast-forward, stop and ask.
  - **Done when:** every test and build passes on `plan-v18`, and `master` has moved to it.
  - **Left from the tracks' own checks** (T1-9, T2-8 and T3-9 ticked with these open; do them before `deploy v18`): the screens at 1280px, My meetings and My team with sign in on, a keyboard pass by hand, reduced motion by eye, and the 4x CPU trace. M1 did the review-agent's checks, 1440px light and dark and 390px light, and (by mistake) one paid draft.

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
  - 2026-11-16: the docs are done (`AGENTS.md`, `PREP.md`, `CLAUDE.md`, `DESIGN.md`). The team note waits for Al-khair's word.

## Waiting on

- **Levi:**
  - **The browser's speech service,** only if T3-3 picks it: his OK for the voice to go to Google or Microsoft. Until then the server refuses it; after it, set `BROWSER_SPEECH_OK=true` on the server.
  - **HubSpot teams,** if T1-2 finds none: whether Contour wants them set up in HubSpot.
  - **A team view of call logs:** who may see other people's calls.
  - **The contacts permission** (`crm.objects.contacts.read`, PLAN-V17 W1): without it, the quick look and History show no people's names.
- **Al-khair:**
  - the answers to "Questions for you";
  - T3-3 at the keyboard, and a look at each screen (sign in on, to see My meetings and My team);
  - OK for the new DESIGN.md lines, and the 7 decisions in the Log (16 Nov);
  - `deploy v18`.

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
  - `Segmented` (the motion kit) is 40px tall on a touch screen, under the 44px rule. Changing it changes every screen that uses it (found at T2-8 and M1).
  - Some backend titles nearly repeat their details, like "Call notes are off" above "Call notes are switched off. ...". The error box and toasts show both (found at M1).
  - A track backend gets `ANTHROPIC_API_KEY` from a Windows user setting, not only from `engine/.env`. Start track backends with the key removed (see the M1 Log).
  - The HubSpot check doesn't test the permission to write meeting notes (`core/hubspot/check.py`, `ACTIVITY_WRITE_KINDS` has no `meetings`). So a missing permission would show only when a pre-read is sent.

## Log

- 16 Nov 2026: plan written from Al-khair's list of changes. Nothing built.
- 16 Nov 2026: Al-khair said "Please implement this all the way" and went to sleep. S0 done. The lead session runs the three tracks with one agent each, and is the go-between for their messages (the tracks write requests in their Logs). Steps that need Al-khair (T3-3 at the keyboard, each look, the paid draft) are marked waiting, and the tracks carry on around them. No push and no deploy without `deploy v18`.
- 16 Nov 2026, **M1, the join** (the lead session, on "Please implement this all the way"; Al-khair asleep). Worktree `../contour-v18`, branch `plan-v18`.
  - **Pre-merge check** (a fresh `review-agent`, `merge-check` sections 1 and 2, on each track branch): Track 1, Track 2 and Track 3 each **Ready with notes**, no blocker.
  - **Joined** in order, each `--no-ff`: track1 (`1eca548`), track2 (`b5ace3a`), track3 (`c3f5556`). Conflicts only in the Progress line and `src/components/motion/index.ts` (both sides kept). The contract and the website's types made again (`00c774e`), and every hand written type now uses the generated one.
  - **Join fixes** (a `frontend-agent`), each with a test:
    - Track 2's side: "You can still start a new pre-read." and each next step show once (the server's sentences now carry them); Home's meetings card asks for All while sign in is off, and shows "Show all meetings" for a rep with no HubSpot owner; Sync says "about 15 seconds" (T1-5 measured 10 to 13); the tests use the server's real words.
    - Track 3's side: History's "Where it stands" has no "To confirm" (the server lists that state unsure first, then oldest first, which broke the days); 14 of Track 3's 16 hints only repeated the server's words and are gone; the send dialog says "Email isn't set up" once; test data has `voice_tool`.
    - Settings doesn't offer the browser speech service (`CHOICES_WAITING` in `settings-groups.ts`) until Levi's OK.
  - **Final check** (a fresh `review-agent`, `merge-check` sections 3 to 5): **Ready with notes**, no blocker. The generated files match a fresh run byte for byte; one migration head; no hand written types left; security found no key, no contact detail and no new HubSpot write; History only ever shows your own notes. Fixed after it, each with a test:
    - the server refuses `voice_tool = browser_service` until `BROWSER_SPEECH_OK=true` in `engine/.env` (422 `browser_speech_off`; a saved value or `VOICE_TOOL` reads as `browser_model` meanwhile, and Settings doesn't list it) (`fd66c5e`, and `65ac9c3` for the website, so one switch decides);
    - History's `since` and `until` take days from 2000 to 2100 (422 `day_out_of_range`): two extreme dates gave a 500 (`c6df96a`); the contract's words made again (`0a49c67`);
    - the new small buttons are 44px on a touch screen (`21a51b9`);
    - the pre-read words use measured numbers: "It takes a few seconds." and "Under US$0.01." (`d80f8ff`; PLAN-V17 T2-16 measured about US$0.007 a draft, and one draft tonight cost US$0.0071 in 3.5 seconds);
    - the quick look's failed read has Try again (`b7f74cc`), and the unused More about is gone (`d5927f2`).
  - **Browser check** (the joined copy on ports 8064 and 5234, the track database `leadfinder_v18a`, sign in off, no HubSpot key; 1440px light and dark, 390px light):
    - Meetings opens on everyone's meetings, with Sync and "Checked 5:49 pm". Sync with no HubSpot key says so once, in plain words, and greys out; the rows stay.
    - "Draft it" opens the pre-read as one centered form: the AI notice, the three step dots, four numbered sections, summaries typed in directly with "Written by AI", the two starred blanks, and the footer bar.
    - Companies sorts by Last activity, newest first. Prep opens straight on the quick look, with "Calling: Cold call (switchboard)".
    - Log call has the mic button. The mic card says the browser blocked the mic and how to allow it (this pane has no mic).
    - `/companies/activity?tab=logged` opens Call logs on History. History groups by day, and a row opens in place.
    - **Found and fixed:** a call logged from Call logs stayed out of History until a reload (`e0dec80`).
    - **Not seen:** the All, My meetings and My team choice (it needs sign in, which is off on this laptop; tests cover it), 1280px, a working mic, Sync with HubSpot connected.
  - **A paid draft by mistake:** the joined backend inherited `ANTHROPIC_API_KEY` from a Windows user setting (not `engine/.env`), so one "Draft it" called Claude: US$0.0071 and 3.5 seconds, for "Coffee Catch Up" (ResolveXO), in the track database only. Nothing was sent. The backend was started again with the key removed, and Admin's health check then said "No Claude key is set". **Risk for later tracks:** a track backend gets the Claude key from Windows unless its start removes it.
  - **Two local test calls** were logged in `leadfinder_v18a` (Bapcor Limited and CBRE Asia Pacific, made up words). They stay there, unsent.
  - **Windows** blocks a new copy's `engine.exe` and `pytest.exe` (Application Control). In a new worktree use `uv run python -m core.cli ...` and `python -m pytest`.
  - **Docs (M3):** `engine/AGENTS.md`, `projects/prep/PREP.md`, `CLAUDE.md` (the open steps of PLAN-V18 and PLAN-V17) and `engine/DESIGN.md` (five lines waiting for Al-khair's look; `LevelMeter` gives way to `FrequencyBars` once he agrees).
  - **Checks on the final branch:** on `5ae27fa`: the generated files match a fresh run; Ruff, the format check (430 files) and mypy (397 files) are clean; one migration head (`0024_v18_teams_activity`); every backend test with `RUN_GATES=1`: 4,714 passed, 25 skipped, 0 failed (12 min 7 s); the website's lint and typecheck are clean, 127 files and 1,825 tests passed, the build passes, and the first visit is 233 kB of JavaScript gzip (238,558 B, 766 B over the T3-1 base, inside the 1,024 B limit) and 24 kB of CSS.
  - **master:** after this commit, `master` moves here by fast forward, with a backup branch `backup/master-before-v18` at `c4ebe58` first. The main folder's pre-S0 draft of this plan and its copy of the CLAUDE.md edit are set aside with `git stash` (both are in `plan-v18`). Not pushed, not deployed. The dev backend on port 8000 runs the old code until it restarts, and a restart moves the dev database to 0024.
- 16 Nov 2026: **Decisions for Al-khair** (made tonight, each easy to change):
  1. Home's meetings card keeps your own meetings while you are signed in (its sentence counts your own); everyone's while sign in is off.
  2. Sync is greyed while HubSpot isn't connected.
  3. A new Meetings list fades in over 250ms, and the old one goes at once.
  4. The mic button is square (DESIGN.md has no fully round buttons), not round as the plan said.
  5. History has no "To confirm" filter, and no "Sending" one.
  6. The browser speech service is refused by the server and not listed in Settings. After Levi's OK, set `BROWSER_SPEECH_OK=true` on the server: that one switch brings it back.
  7. The phone number stays in the prep footer, not in the quick look.
