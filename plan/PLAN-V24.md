# The mic: plan, version 24

This plan makes the Assistant's mic strong on every device, and changes nothing else. One V starts a conversation that keeps listening until you stop it. The mic hears more cleanly, follows the right mic, and doesn't lose words. Every call is saved in the system from the first word, even before its company is found. On a laptop with Chrome or Edge, and on an Android phone, the browser's own live speech service stays, as now. On an iPhone, in the installed app too, and in Safari and Firefox, a free speech model runs on the device instead, because the browser's service is weak or missing there. The mic is shared with Teams, Zoom and calls, never taken from them. And you can always see that it is listening. Nothing new is paid. One session builds it, in five parts, one after another. It is website work, but for one small backend step.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 21 Nov 2026 (S0 done. Part 1, T3-1 and Part 4's model are being built at the same time, on Al-khair's ask to go faster).
- **Progress:** Before the build: 1 of 3. Part 1: 0 of 5. Part 2: 0 of 6. Part 3: 0 of 4. Part 4: 0 of 4. Part 5: 0 of 3. M1 to M4: 0 of 4.
- **Sources:**
  - Al-khair's chat on 21 Nov, after Levi tried the Assistant with him on 20 Nov;
  - the code on `master` (`b84c3cf`), read on 21 Nov;
  - the live app's settings and deploys, read on 21 Nov with `doctl` (looking only);
  - read on 21 Nov: Android's "Sharing audio input" page; Apple's developer forums on the mic during a call; WebKit's bug 225298 (no speech service in home-screen web apps); Apple's news on WebGPU in Safari 26; and Moonshine's model cards on Hugging Face.
- **Comes after:** [PLAN-V23.md](PLAN-V23.md). Its code is live: `master` `b84c3cf` was deployed by hand on 20 Nov at 7:06 am Melbourne time. But its M2 isn't ticked. The two fixes its review asked for before `deploy v23` aren't in, and FYI tasks are on live (`NOTIFY_OWNER_CALLS` isn't set, and Levi hasn't answered its W4). Those are PLAN-V23's to finish (A1 in "Waiting on"). This plan changes none of their files.

## What Levi found (20 Nov)

1. **Too many clicks.** Each command needs its own V, and each card needs Send.
2. **It stops hearing you.** The bar ends after 1.5 seconds of silence, 6 seconds with no first word, or 60 seconds. The card listens for "send it" for 5 seconds only.
3. **The mic didn't work for him during a call.** The cause isn't confirmed yet (S1). Two leads:
   - when another app holds the mic, the app tells reps "End the call there or close it, then try again";
   - on an iPhone, the browser's speech service doesn't work in an app installed on the home screen. The app can see the service, but it fails silently (WebKit bug 225298). Contour is an installable app.
4. **Not his role.** The mic works for every role but a Viewer, with the Call logs or Meetings tick. Being Platform admin has nothing to do with it.

## Go signals

Say the line in the session. The same line starts the work, and continues it later from the first step that isn't ticked. Saying `implement v24` counts as Al-khair's word for S0.

| Say | What it does |
|---|---|
| `implement v24` | Builds Part 1 (a cleaner mic), Part 2 (a long conversation), Part 3 (no call lost), Part 4 (every device), then Part 5 (listening you can see) |
| `merge v24` | Checks everything, then moves `master` to `plan-v24` |
| `deploy v24` | Pushes `master`, deploys, and does the live test with Levi (M3) |

You'll also answer things along the way:
- **S1 needs you at the keyboard** for about 30 minutes, and four answers from Levi. It is free.
- **S2 needs an iPhone** for about 30 minutes, yours or Levi's. It is free.
- **Each screen waits for your look.** The session marks it "built, waiting for a look" and carries on.
- **The choices below** stand unless you change them before that step starts.
- **Pushes and deploys** happen only on your own word in chat.

## Decided in chat (21 Nov)

These are Al-khair's answers. They are fixed for this plan.

1. **The mic only.** The mic hears better, holds a long conversation, and is easy to use. Nothing else changes, but for decision 7.
2. **No new service and no new subscription.** Nothing new to pay. The browser's own speech service stays where it is strong: Chrome and Edge on a laptop, and Chrome on Android.
3. **Strong on every device.** Where the browser's service is weak or missing (an iPhone, in Safari or the installed app, and Firefox), a free model runs on the device instead.
4. **Share the mic, never take it.** A phone gives the mic to a call, so no website or app can use it then. Taking the mic from Teams or Zoom would cut you out of the meeting. In a meeting on a computer: mute yourself there, then use V. After a phone call: log it then.
5. **Voice is the fast way, never the only way.** Every voice step has a button or a key: Send, Later, Try again, Type instead and Stop. A rep with a bad mic can do everything by hand.
6. **Nothing goes to HubSpot until "send it" or Send,** as now.
7. **No call is lost.** Every call is saved in the system from the first word. One whose company isn't found is saved as "Needs a company". It can't go to HubSpot until it has a company, which the rep says again by voice, or picks later in Call logs.
8. **Later, not in this plan:** spoken answers, asking back out loud, finding a person without the company, a memory of what was said before, a phone app, a key that works from any app, and a paid speech service.

## Words used here

- **Conversation:** one V, and the mic keeps listening across commands until you stop it. "Keep listening" is its switch.
- **Turn:** what you say before a pause. Each turn is one command, or one change to an open card.
- **Smart pause:** the wait before a turn ends. It is longer when your words sound unfinished, like "log a call with".
- **Quiet stop:** the conversation ends by itself after 2 minutes with no words.
- **Fixed words:** a few words the code knows, with no AI: "send it", "later", "cancel", "stop listening" and "that's all".
- **Needs a company:** a call saved before its company is known. It waits in Call logs, and can't go to HubSpot until its company is picked.
- **Echo cancellation, noise suppression and auto gain:** the browser's own cleaning of the mic's sound. They cut echo and background noise, and even out loud and soft voices.
- **Wake lock:** the browser keeps a phone's screen on, so the phone doesn't lock and stop the mic.
- **Installed app:** Contour added to a phone's home screen. It is the same website, in its own window.
- **On-device model:** a free speech-to-text model that the browser downloads once and runs on the device itself. The voice never leaves the device. Here it is Moonshine, run with Hugging Face's Transformers.js.
- **Voice detector:** a tiny free model that tells speech from silence, so the on-device model knows where a turn ends (Silero VAD).
- **WebGPU:** lets a web page use the device's graphics chip, which runs the model much faster. Safari has it from iOS 26.

## What exists already (so nothing is built twice)

Read this before any step. All of it is on `master` (`b84c3cf`). Website paths are under `engine/frontend/src/`, and backend paths under `engine/backend/`.

| Need | Already there | This plan changes |
|---|---|---|
| Speech to text | `apps/companies/call-notes/mic/voice-tool.ts`: the browser's speech service, `en-AU`. It ends by itself after a silence or about a minute, and the tool starts it again. A `network` error ends everything. Live: `VOICE_TOOL=browser_service` and `BROWSER_SPEECH_OK=true` (read 21 Nov). | Not the service. Words kept at its restarts, quiet retries, and the free model where the service is weak |
| A model on the device | The setting has a `browser_model` choice ("Whisper in the browser"), but no tool: picking it says "isn't set up yet" (`voice-tool.ts`, `voiceToolFor`). PLAN-V18 T3-5 (a) set the rules for a model in the browser: a Web Worker, files from our own site, and the content policy. | Built, with those rules |
| The installed app | `engine/frontend/public/manifest.webmanifest` and a service worker (`engine/frontend/vite-pwa.ts`) | Nothing. The voice now works in it on an iPhone |
| The mic | `apps/companies/call-notes/mic/session.ts`: a 4-line check each time it opens. `getUserMedia` with the browser's default sound settings, or the mic picked by hand (`devices.ts`). Nothing happens when a headset is plugged in. | Clean sound settings, one check a conversation, and it follows the mic |
| The bar | `apps/assistant/voice/bar-session.ts`: one command per V. It ends after 1.5 s of silence, 6 s with no first word, or 60 s. Hold V (0.4 s) keeps it open. The bar closes when a card opens (`voice/hand-over.ts`). | Keep listening |
| The card | `apps/assistant/card/listen.ts` listens 5 s for "send it" or "cancel", with a mic of its own. A spoken change sets the subject, body, due day, kind, follow-up, outcome or summary (`card/draft.ts`, `applyChange`). It can't pick a company, person or teammate from the card's choices. | It listens while it is open, and takes a choice by voice |
| Finding the company | `find_company` (`apps/companies/assistant_find.py`): the company on screen, learned names, our copy, then HubSpot's own search. The card has a search list and "Add to HubSpot" (PLAN-V23). | The card's search, fed by voice |
| A call with no company | The server needs a company for every call: `CallNoteIn.company_key` is required, the `call_notes.company_key` and `company_name` columns can't be empty, and the PATCH can't set a company. So a call whose company isn't found is kept only in this browser, with at most 10 drafts (`card/drafts.ts`). | Saved on the server as "Needs a company" |
| A busy mic | `apps/companies/call-notes/mic/words.ts`: "Another app is using your mic, like Teams or Zoom. End the call there or close it, then try again.", with Try again | New words, and Type instead |
| Who has the mic | Everyone but a Viewer, with the Call logs or Meetings tick (`apps/assistant/voice/key.tsx`, `shell/app-frame.tsx`) | Nothing |
| Switches | "Use V to speak" in the profile menu, kept in this browser (`apps/assistant/voice/v-switch.ts`) | "Keep listening" beside it |

## Choices made for you

These are recommendations. They stand unless Al-khair changes them before the step starts. Numbers marked **TBC** are set by S1 or S2.

**A cleaner mic (Part 1):**
1. **Sound settings:** the mic opens with echo cancellation, noise suppression and auto gain on, in one channel. Voice isolation too, where the browser has it (**TBC**).
2. **The speech service hears the same cleaned mic** as the bars, where the browser allows it (S1 checks Chrome). Elsewhere it hears the computer's default mic, and the bar names that mic.
3. **It follows the mic.** If a headset is plugged in, or the mic in use goes, it moves to the new default mic, keeps the words, and says "Now using {mic}". A mic picked by hand stays, unless it's gone.
4. **No lost words.** When the service ends by itself, the words still being heard are kept. A network blip gets 3 quiet tries in 10 seconds (**TBC**), with "Reconnecting" after 1 second. Only then does a problem show.
5. **One mic check a conversation,** not one a command. Later turns start at once.

**A long conversation (Part 2):**
6. **"Keep listening" is on for everyone with the mic,** as Levi asked (20 Nov). Its switch sits in the profile menu, next to "Use V to speak", kept in this browser. Off: one command per V, as now.
7. **A tap of V starts a conversation.** Hold V is still one turn: hold, talk, let go. That suits a meeting best.
8. **A turn ends after a smart pause:** 1.2 seconds when the words sound finished, 3 seconds when they end on a joining word or a half command (**TBC** at S1). Example: "Log a call with" waits; "Log a call with Northwind" doesn't. The joining words sit in one list, like "and", "with", "to", "for", "the" and "um".
9. **A turn can run 2 minutes** (**TBC**), up from 60 seconds, for long call notes. Over the server's 2,000 characters, the words wait in the text line.
10. **The conversation ends on** V, Stop, "stop listening" or "that's all", or after 2 minutes with no words (**TBC**). V sends the turn in progress first. Esc keeps its meaning: on the bar it throws the turn away and ends the conversation; on a card it does what the card's Esc does now.
11. **Short turns aren't sent.** A turn of fewer than 2 real words that isn't a fixed word is dropped quietly (**TBC**), so a cough or "um" doesn't use the AI.
12. **Turns are read in order.** A turn said while the last one is still being worked out waits for it.
13. **The card listens for as long as it is open,** through the conversation's mic. "send it" sends; "later" or "cancel" does what Later or Cancel does now; anything else is a change, as now. A new command while a card is open gets "Send or keep this one first." (**TBC**). After a send, the card says "Sent." and the next turn is a new command.
14. **The card's question can be answered by voice.** While it asks "Which Sample?", "the second one" or a name from its list picks it. The code matches these, with no AI. For a company, a name that isn't in the list is searched (choice 19). Other words go to the command step, as now.
15. **Phones:** the screen stays on while the conversation is on (wake lock, **TBC** on an iPhone). Locking the phone or leaving the app stops the mic, and the words so far are kept.
16. **Laptops:** switching to another window doesn't stop the conversation (**TBC** at S1). If the browser stops the service anyway, the bar says so.

**No call lost (Part 3):**

17. **Saved from the first word.** When a command finds no company, the card saves the call at once as "Needs a company", with the name as heard, like "North Wind". A call is no longer kept only in this browser. Tasks and emails still are, as now.
18. **It can't go to HubSpot without a company.** A send that holds such a call leaves it out, says why, and keeps it in Call logs.
19. **Say the company again.** While the card waits on its company, your next words fill its company search. It finds as the command step does: our copy, the learned names, then HubSpot's own search. The results show as choices, and "the first one" or a tap picks. A name found nowhere gets "Still no '{words}'. Say it again, or pick it later in Call logs." "Add to HubSpot" stays.
20. **Pick it later in Call logs.** "Needs a company" sits at the top of Call logs with its count. Each call shows the name as heard, and "Pick company".
21. **Once picked, it carries on as any call does.** It is sorted, because the sorter reads the company's people and fields, then it waits in To confirm. Picking teaches the mic the words heard, as PLAN-V23 does on the card.

**Every device (Part 4):**

22. **The engine picks itself:**
    - Chrome or Edge on a laptop, and Chrome on Android: the browser's live service, as now.
    - Any browser on an iPhone or iPad, the installed app there, Safari on a Mac, and Firefox: the free model on the device.
    - Anywhere the browser's service doesn't start within 5 seconds: the model, remembered on that device.

    S2 can change this list.
23. **The model:** Moonshine Base (MIT licence, English, 61 million parameters), run with Hugging Face's Transformers.js in a Web Worker. It uses WebGPU where the browser has it, else the CPU. Moonshine Tiny (27 million) is for slower phones. Whisper base is the backup if S2 finds Moonshine weaker (**TBC** at S2).
24. **Turns on the model's path:** the voice detector finds the pauses, and choice 8's smart pause sits on top. The words show a moment after each pause, under 1 second (**TBC** at S2). While you talk, the bars move and "Listening" shows.
25. **The download:** about 30 to 70 MB, once (**TBC** at S2, from the model's files). It comes from our own site, at a fixed version with a checksum, never from another site while a rep works. On a laptop that needs it, it loads after the page is idle. On a phone, it loads at the first Speak with "Getting voice ready on this phone. Only this once.", or ahead from the profile menu ("Get voice ready"), best on Wi-Fi. Then the browser keeps it.
26. **The voice stays on the device** on the model's path. Nothing of the sound leaves the phone.
27. **The setting:** `browser_service` (live now) means the browser's service, with the model where the service is weak (choice 22). `browser_model` means the model on every device, for anyone who wants the voice never to leave it. Its words change from "Whisper in the browser" to "A free model on the device".
28. **The name fix** (PLAN-V23) works on the model's words too.

**Listening you can see (Part 5):**

29. **The pill.** While a card is open, the bar shrinks to a small "Listening" pill beside it, with the bars and Stop (V).
30. **A soft tone** when listening starts and when it stops (**TBC** at the look). The pill shows it either way.
31. **The lines:** "Reconnecting", "Now using {mic}" and the quiet stop, in the bar or the pill. A screen reader hears each once, as now.

## Words for when things go wrong

Each problem says what happened, what still works, and the one thing to do. No setting names, file names or codes on screen (`screen-words.test.ts`). The words are **TBC** at Al-khair's look.

| What went wrong | Words on screen | Buttons |
|---|---|---|
| Another app holds the mic | "Another app is holding your mic, like Teams or Zoom. Mute yourself there, then try again, or type instead." | Try again, Type instead |
| The same, on Windows | Adds: "If it still won't open, turn off 'Allow applications to take exclusive control' for your mic in the Windows sound settings." | The same |
| 2 minutes with no words | "Stopped listening after 2 minutes of quiet." | Start again (V) |
| A network blip | "Reconnecting" | None |
| The mic changed | "Now using {mic}." | None |
| The phone locked, or the app left the front | "The mic stopped when you left the page. What you said so far is kept." | Carry on |
| A turn over 2,000 characters | "That's too long for one command. Your words are in the text line: shorten them, then press Enter." | The text line |
| A call's company isn't found | "We couldn't find 'North Wind'. The call is saved. Say the company again, or pick it." | The search list, Add to HubSpot, Later |
| Said again, and still not found | "Still no '{words}'. Say it again, or pick it later in Call logs." | The search list, Later |
| A send holds calls that need a company | "{n} calls need a company first. They stay in Call logs." | Open Call logs |
| A spoken person or teammate matches nothing | "There's no '{words}' here. Pick one, or say its number." | The choices |
| The model is downloading | "Getting voice ready on this phone. Only this once.", with its progress | Type instead |
| The download failed | "Voice couldn't get ready. Check your connection, then try again. You can type meanwhile." | Try again, Type instead |
| The device is too slow for the model | "This device is too slow for voice to text. Use your keyboard's mic, or type." | Type instead |

## What it costs

- **To build:** time only.
- **To run:** nothing new. No new service and no new subscription.
  - The browser's speech service is free.
  - The model is free (MIT licence). Each device downloads it once, about 30 to 70 MB (**TBC**), and uses more battery while it runs.
  - Saving calls before their company is one more database row per call, as now.
  - Each command still goes to Claude Haiku 5.5, as now. That is well under a tenth of a cent a command (US$0.10 a million tokens in and US$0.50 out, from `core/claude/pricing.py`; **TBC**), and never over US$0.01 a command (`notes_cap_usd`).
  - A conversation can send more commands than one V did. Choice 11 keeps coughs and "um" out, and the limit of 20 commands a minute stays.

## Who builds it

One session builds every step, in order: S0, Part 1, Part 2, Part 3, Part 4, then Part 5. S1 can happen any time before T2-2, and S2 any time before T4-1. It is one session, not tracks, because every step changes the same few mic, bar and card files: two sessions would wait on each other.

- **Website steps** are `frontend-agent` work. They follow `engine/DESIGN.md` and the `ui-build` skill. Tests use the fake mic, the fake voice tool and the fake clock already in `session.ts` and `bar-session.ts`.
- **T3-1 is the one backend step,** for the `backend-agent`. It follows the `api-change` and `db-migration` skills, and the `security-check` skill checks it. Choice 27 also changes one sentence in `core/prefs/service.py`.
- **One new package:** `@huggingface/transformers` (Transformers.js), used only inside the Web Worker.
- **M1's independent check** is a fresh `review-agent` with the `merge-check` skill. It changes nothing.
- **Merging, pushing and deploying** stay with Al-khair's own word in chat.

## How to work this plan

**The copy.**
- One branch, `plan-v24`, made from `master`, in its own copy: `git worktree add ../contour-v24 -b plan-v24 master`. The main folder stays on `master`.
- In the new copy: `uv sync --frozen` in `engine/backend`, and `npm ci` in `engine/frontend`.

**Ports and database.**
- Backend `API_PORT=8111`. Website on port 5281, with its proxy to 8111. Database `leadfinder_v24`, a copy of the dev database at `0026_v23_names_and_hubspot_user`. Test database suffix `LEADFINDER_TEST_DB_SUFFIX=_v24`.
- The copy's `engine/.env` holds the `POSTGRES_*` lines only. `API_PORT` and `CORS_ORIGINS` go on the command line.
- **No Claude key and no HubSpot key.** `ANTHROPIC_API_KEY` is also a Windows user setting on this laptop, so blank it for the process. Never print a key.
- Leave ports 8000 and 5173 alone, and those of older plans (8041 to 8101, 5211 to 5271).

**What to expect.**
- **Website work, but for T3-1 and choice 27's one sentence.** If a step seems to need more of the backend, stop and ask.
- **One migration,** `0027_v24_call_needs_company`, made in T3-1. It follows `0026_v23_names_and_hubspot_user`. S0 checks that.
- **The contract and the website's types** are made again after T3-1 (`uv run --no-sync engine openapi`, then `npm run types`). Never edit `openapi.json` or `src/api/schema.d.ts` by hand.
- **The model's files never go in git.** A build script fetches them at a fixed version and checks their checksum, as PLAN-V18 T3-5 (a) set out.
- **The content policy** gains `'wasm-unsafe-eval'` and `worker-src 'self'`, in `index.html` and the Caddyfile, and `csp.test.ts` follows.
- **The first visit stays the same size,** within 1 kB: the new code loads with the bar, late, and the model only where it is the engine.
- **Change only what a step needs.** `engine/AGENTS.md`, `engine/DESIGN.md` and `.claude/` change at M4 only. The plan list (`AGENTS.md`, which held the list in `CLAUDE.md` until 21 Nov) changes at S0 and M4 only.

**Every working session.**
- **At the start:** read this section, "Decided in chat" and "Choices made for you". Go to `../contour-v24`, find the first step that isn't ticked, and run `brain context`.
- **One heavy thing at a time:** `bash engine/scripts/heavy.sh <cmd>` for full test runs, builds and browser checks. The laptop is short of memory.
- **Windows Application Control** blocks a new copy's `pytest.exe` and `engine.exe`. Use `uv run python -m pytest` and `uv run python -m core.cli <command>`.
- **Commits:** make small ones, and run `git branch --show-current` before each. Follow the `git-workflow` skill.
- **Ticking a step:** when its "Done when" is true, tick it with the date and the commit. Update the Progress line and add a line to that part's Log.
- **No real client data in git:** tests use made-up companies and people, like "Sample Logistics Pty Ltd" and "Jo Sample". No recording is ever kept, and test sound files are made up.
- **Screens:** screenshots go in `plan/shots/v24/`, which git ignores.
- **When usage runs low** (80% of the 5-hour or weekly limit, or of the session's context), save to the AI Brain. At 95%, start no new step.

## Before the build starts

- [x] **S0. The branch and the copy.** Done 21 Nov 2026 (`37791d8`).
  - Make `plan-v24` from `master` in `../contour-v24`. Don't switch the main folder's branch.
  - Its first commit holds this plan and its line in the plan list. The plan was written in the main folder and not committed, so copy it in, then delete the main folder's untracked copy.
  - On 21 Nov the main folder also had uncommitted work moving `CLAUDE.md` into `AGENTS.md`. Put the plan's line wherever the list is on `master` when S0 runs, and ask Al-khair if that work is still open.
  - Make the database `leadfinder_v24`, and check the newest migration (`0026`).
  - Check `git log` and the worktrees for open work on the same files. PLAN-V22's and PLAN-V23's open look steps touch the bar and the card.
  - **Done when:** `git branch --list plan-v24` shows it, it holds `plan/PLAN-V24.md`, and the fast backend tests and the website tests pass on it.
- [ ] **S1. The call and mic test.** Needs Al-khair at the keyboard, about 30 minutes, and Levi's four answers. Free. PLAN-V23's S1 (on-device mode with name hints) can run in the same sitting, with its numbers in its own Log.
  - **Ask Levi:** which device and browser he used, and whether it was the installed app; what kind of call it was (a phone call, Teams, Zoom, or HubSpot calling); what the bar said; and which address he used. On the new `contourhq.online` address, the browser asks for the mic again.
  - **On the laptop, in Chrome and Edge:** join a Teams or Zoom call (or a Google Meet), muted, then press V and say a command. Then do it unmuted, and with a headset if there is one. Note what happens: it works, the busy words show, or something else.
  - **Measure in Chrome:**
    - the time from the last word to the final words (5 tries);
    - how long the service runs before it ends by itself, and whether words are lost then;
    - whether it hears a picked mic that isn't the default;
    - whether it keeps listening with another window, or another tab, in front.
  - **On an Android phone, if one is at hand:** Speak in Chrome, 3 commands, and whether the screen stays on.
  - No recording is kept. Only the numbers and what happened go in the Log.
  - **Done when:** the Log has Levi's answers, the numbers and the likely cause of his problem, and choices 2, 8, 15 and 16 match what was found.
- [ ] **S2. The phone and model test.** Needs an iPhone, on iOS 26 if possible, for about 30 minutes. Free.
  - Read the current docs first: Transformers.js, Moonshine's and Whisper's model cards, and WebKit's notes on speech in home-screen apps. Don't build from memory.
  - A throwaway test page, never merged: Moonshine Base, Moonshine Tiny and Whisper base, each with the voice detector, on the GPU and on the CPU.
  - **On the iPhone, in Safari and in the installed app:** first, does the browser's speech service work at all? Then say 10 commands with real Australian company and people names into each model.
  - **For each model, note:**
    - the download size and time;
    - the seconds from the end of speech to the words;
    - the names wrong out of 10, as heard and after the name fix;
    - whether 10 minutes of conversation runs without a stop;
    - whether the phone gets hot or slow.
  - The same on a laptop in Firefox, and in Chrome at 4x CPU slowdown.
  - **Decide** the model and the engine list. The bar (**TBC**): at most 1 name wrong in 10 after the fix, the words within 1 second of the pause, and 10 minutes without a stop.
  - No recording is kept. Only the numbers go in the Log.
  - **Done when:** the Log has the numbers and the decision, and choices 22 to 25 match them.

## The contract (T3-1)

The call notes routes sit under `/api/v1/companies/`. Each change goes in `tests/core/test_contract_routes.py` where it lists routes.

- **Saving a call** (`POST /call-notes`): `company_key` may be left out. Then `company_heard` (1 to 120 characters) is required, and the call is saved with the status `needs_company`, unsorted.
- **A call's answer:** `company_key` and `company_name` can be empty. It gains `company_heard`, and the status `needs_company`.
- **Setting the company later** (`PATCH /call-notes/{note_id}`): it gains `company_key`, taken only while the call is `needs_company`. A company the person can't see gives 422, as saving does. At any other status it gives 409 `company_set` (**TBC**). Once set, the call is sorted, as a new call is.
- **The send:** the preview and the send leave `needs_company` calls out, each in `skipped` with its `why`: "Needs a company first."
- **The migration** `0027_v24_call_needs_company`: `call_notes.company_key` and `company_name` may be empty, `company_heard` is added, and the status list gains `needs_company`. Going down is refused while any call still needs a company (**TBC**).
- **Who may:** as now. The Call logs tick to write, and never a Viewer.

## Part 1: a cleaner mic

**Progress:** 0 of 5.

- [ ] **T1-1. Clean sound, one check** (`call-notes/mic/session.ts`, `voice-tool.ts`). Choices 1, 2 and 5.
  - The mic session gains a way to hand over the words so far and keep listening, for Part 2's turns.
  - **Done when:** tests with the fake mic pass: the sound settings are asked for, with and without a picked mic; a picked mic keeps its exact id; the voice tool gets the mic's track; and handing over the words leaves the mic and the tool running, so the next turn has no check and opens no second mic.
- [ ] **T1-2. Follow the mic** (`session.ts`, `devices.ts`). Choice 3.
  - **Done when:** tests with fake devices pass: the mic unplugged mid-turn moves to the default, keeps the words, and says "Now using {mic}"; a headset plugged in is used when no mic was picked by hand; and a hand-picked mic stays while it is there.
- [ ] **T1-3. No lost words** (`voice-tool.ts`). Choice 4.
  - **Done when:** tests with a fake voice tool pass: words still being heard when the service ends are kept, once; two `network` errors and then words carry on with no problem shown; and a fourth error inside 10 seconds shows the problem, with the words kept.
- [ ] **T1-4. The busy mic's words** (`call-notes/mic/words.ts`, the bar and the mic card). The first two rows of "Words for when things go wrong".
  - **Done when:** `screen-words.test.ts` passes; the busy problem shows Type instead in the bar and in the mic card; and the Windows line shows on Windows only.
- [ ] **T1-5. Part 1 check.** Website: lint, types, the tests, the build and `node scripts/bundle-report.js`.
  - **Done when:** all pass, the first visit grew by 1 kB at most, and the numbers are in the Log.

### Part 1 Log

## Part 2: a long conversation

**Progress:** 0 of 6.

- [ ] **T2-1. Keep listening** (`voice/bar-session.ts`). Choices 7, 9, 10, 11 and 12.
  - **Done when:** tests with the fake mic, tool and clock pass: three commands in one V each reach the command step once, in order; 2 minutes with no words ends it with the quiet line; "stop listening" ends it and sends nothing; "um" alone sends nothing; a 90-second turn isn't cut; hold V is one turn; and with "Keep listening" off, today's bar tests pass unchanged.
- [ ] **T2-2. Smart pauses** (`bar-session.ts`, with the joining words in one small file). Choice 8, with S1's numbers.
  - **Done when:** tests pass: "log a call with" waits the long pause; "log a call with Northwind" ends after the short one; a joining word and more words inside the long pause make one turn; while V is held, no pause ends a turn; and the numbers sit in `TIMES`.
- [ ] **T2-3. The card in the conversation** (`card/listen.ts`, `card/card.tsx`, `voice/hand-over.ts`). Choice 13.
  - **Done when:** tests pass: "send it" 30 seconds after the card opened sends it; "later" keeps a call in Call logs; a spoken change still works; after a send, the next turn is a new command; and outside a conversation, the 5-second listen works as now.
- [ ] **T2-4. A choice by voice** (`card/draft.ts`). Choice 14.
  - **Done when:** tests pass: "the second one" picks the second company; "Sample Logistics" picks it from the list; the same works for a person and a teammate; a person or teammate name not in the list changes nothing and says so; and none of these asks the AI. (A company name not in the list is T3-2's.)
- [ ] **T2-5. Phones, windows and the switch** (`bar-session.ts`, `bar.tsx`, a new switch file beside `voice/v-switch.ts`, and the menu row in `links.tsx`). Choices 6, 15 and 16.
  - **Done when:** tests pass: the wake lock is taken at the start and let go at every end (Stop, the quiet stop, Esc, a problem, a hidden page); a refused wake lock changes nothing else; a hidden page on a phone ends with the words kept; "Keep listening" is on by default, stays after a reload, and counts as on when storage is blocked; and Al-khair has seen the menu row.
- [ ] **T2-6. Part 2 check.** As T1-5, plus the `design-review` skill on the bar and the card.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 2 Log

## Part 3: no call lost

**Progress:** 0 of 4.

- [ ] **T3-1. Calls saved before their company** (backend: `apps/companies/schemas.py`, `tables.py`, `note_store.py`, `note_batch.py`, `api_notes.py`, and the migration). Choices 17, 18 and 21, and "The contract".
  - **Done when:** tests pass: a call with no company is saved as `needs_company`, with the name as heard, and isn't sorted; the PATCH sets its company and starts the sort; a company the person can't see gives 422; a company on a call already sorted gives 409; the send leaves a `needs_company` call out and says why; a Viewer can't do any of it; and the migration goes up and down cleanly.
- [ ] **T3-2. The card saves at once, and hears the company again** (`card/card.tsx`, `card/company.tsx`, `card/send.ts` and `card/drafts.ts`). Choices 17 and 19.
  - **Done when:** tests pass: a call whose company isn't found is saved at once as "Needs a company"; Later keeps it in Call logs, not in this browser; the next words fill the company search and show its results as choices; "the first one" picks, and the call is sorted; a name found nowhere says so and keeps the call; and tasks and emails are still kept in this browser, as now.
- [ ] **T3-3. "Needs a company" in Call logs** (`apps/companies/call-logs/`). Choice 20.
  - **Done when:** tests at 1440 and 390 px pass: the group sits at the top with its count; each row shows the name as heard and "Pick company"; a pick moves the call to To confirm once it is sorted; a send leaves these calls out and says why; and Al-khair has seen it.
- [ ] **T3-4. Part 3 check.** Backend: ruff, ruff format, mypy, the fast tests, the Companies tests and the contract gate (`RUN_GATES=1`). Website: as T2-6. The `security-check` skill on T3-1.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 3 Log

## Part 4: every device

**Progress:** 0 of 4. Needs S2's decision first.

- [ ] **T4-1. The model's files and the worker** (a build script in `engine/frontend/scripts/`, a Web Worker beside `voice-tool.ts`, `index.html`, the Caddyfile and `csp.test.ts`). Choices 23 and 25.
  - Check first that App Platform's static site serves files this big (**TBC**). If it can't, stop and tell Al-khair.
  - **Done when:** the build fetches the model at its fixed version and fails on a wrong checksum; the worker loads it and turns a made-up test sound file into words; nothing of it is in the first visit; and `csp.test.ts` passes with the new rules.
- [ ] **T4-2. The on-device voice tool** (`voice-tool.ts` and a new file beside it, and choice 27's words). Choices 24, 26, 27 and 28.
  - It gives the same five events as the browser's tool (`onReady`, `onWords`, `onHearing`, `onFinished` and `onProblem`), so the bar and the card don't change. It listens to our own mic track, the one Part 1 cleaned.
  - **Done when:** tests with a fake worker pass: speech then a pause gives the words once; a long talk gives the words turn by turn; Stop gives the last words, then `onFinished`; a worker that fails gives the "voice tool didn't load" problem; a slow device gives the too-slow problem; and a test proves no request carries the sound.
- [ ] **T4-3. The engine picks itself, and the download** (`voiceToolFor` in `voice-tool.ts`, `session.ts`, and the profile menu). Choices 22, 25 and 27.
  - **Done when:** tests pass: Safari and the installed app on an iPhone, and Firefox, get the model; Chrome on a laptop and on Android gets the service; a service that doesn't start in 5 seconds moves to the model and remembers it; `browser_model` gets the model everywhere; the download shows its progress line and can be skipped with Type instead; and a second visit doesn't download again.
- [ ] **T4-4. Part 4 check.** As T2-6, plus the `speed-check` skill, and the `security-check` skill on the new package and the content policy. Its numbers: the first visit, the worker's size, and the model's time on a laptop at 4x CPU slowdown.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 4 Log

## Part 5: listening you can see

**Progress:** 0 of 3.

- [ ] **T5-1. The pill, the tone and the lines** (`voice/bar.tsx`, `voice/words.ts`). Choices 29 to 31.
  - **Done when:** tests at 1440 and 390 px pass: the pill shows while a card is open and goes at the end; Stop on it ends the conversation; each tone plays once (a fake sound); each line is said once to a screen reader; and Al-khair has seen it.
- [ ] **T5-2. A button for every voice step.** "Decided in chat" 5.
  - **Done when:** two tests do a conversation's work with the mic off, one by keyboard only and one by clicks only: a command typed, a choice picked, a company picked for a call that needs one, Send, Later, Try again, Type instead and Stop.
- [ ] **T5-3. Part 5 check.** As T2-6, plus the `speed-check` skill. Each screen at 1440, 1280, 768 and 390 px, light and dark, by keyboard only, and with reduced motion.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 5 Log

## Merge, checks and going live

- [ ] **M1. Merge** (`merge v24`, on Al-khair's word). Make the contract and the website's types again. Run the full backend checks (with `RUN_GATES=1`) and the full website checks, the `merge-check` skill and a fresh `review-agent`. Then move `master` to `plan-v24` with `git merge --ff-only`. If it won't fast-forward, stop and ask.
  - **Done when:** everything passes and `master` has moved.
- [ ] **M2. Deploy** (`deploy v24`). Push `master` and deploy to App Platform. The migration runs on deploy. It only adds a column, lets two be empty and widens the status list, so the old code runs with it. There is no live switch.
  - **Done when:** the live site answers on the new version, the model's files load from it, and the Log says so.
- [ ] **M3. The live test with Levi,** on his own devices.
  1. Three commands in one V, with "send it" for each card.
  2. In a Teams or Zoom meeting, muted there: V works.
  3. On his phone, walking, in the installed app if he uses it: Speak, a call logged, and the screen stays on.
  4. A call naming a company that doesn't exist: it is saved as "Needs a company", and nothing reaches HubSpot. Then delete it.
  5. Anything that failed: what the bar said.
  - **Done when:** each check is in the Log.
- [ ] **M4. The docs.** The plan list (this plan's line), the map in `engine/AGENTS.md`, `engine/DESIGN.md` (the pill, the tone and Keep listening, on Al-khair's OK), and a short team note written with `/plain`, sent on Al-khair's word. Then a save to the AI Brain. The note covers:
  - one V for a conversation, then "send it", and "that's all" to stop;
  - a call whose company isn't found is saved: say the company again, or pick it in Call logs;
  - in a meeting, mute yourself there, then use V (or hold V, with headphones), and after a phone call, log it then;
  - on an iPhone, the first Speak gets voice ready once, so do it on Wi-Fi;
  - on the new address, the browser asks for the mic again.
  - **Done when:** the docs are in, and the note is sent.

## Waiting on

- **Levi:**
  - **W1. S1's answers:** his device and browser (and whether it was the installed app), the kind of call, what the bar said, and the address.
  - **W2. More sound to Google or Microsoft.** On a laptop and Android, while a conversation is on, the browser's service hears the room, not only one command. It stops after 2 minutes of quiet, and nothing reaches HubSpot without "send it". PLAN-V23's W2 covers the voice going there at all (**TBC with Levi**). On the model's path, the voice stays on the device.
- **Al-khair:**
  - **A1. PLAN-V23's open M2:** its two review fixes, and FYI tasks on live before Levi's W4. These aren't this plan's files.
  - S1 and S2, a look at each screen, the merge, the deploy, M3 with Levi, and the team note.

## Risks

- **The model is weaker than Google's on some words or accents.** S2 measures it first. The name fix and the card's choices still catch names.
- **The first download on mobile data.** About 30 to 70 MB once (**TBC**). "Get voice ready" in the profile menu lets reps do it on Wi-Fi.
- **Older iPhones.** Before iOS 26 there's no WebGPU, so the model runs on the CPU, slower. Moonshine Tiny, the keyboard's own mic, or typing then.
- **App Platform and big files.** T4-1 checks first that the static site serves them.
- **A pile of calls that need a company.** Call logs shows them at the top with a count, and each send says how many still wait.
- **The meeting's voices on speakers.** The mic may hear other people in a meeting, and a "send it" from them would send a card. Use headphones or hold V in meetings (the team note says so).
- **The service stops in a hidden tab, or on a locked phone.** S1 finds out for laptops. The bar says so, and the words are kept.
- **More AI commands and battery.** A conversation sends more commands, each well under a tenth of a cent, and coughs aren't sent. The model and a screen kept on use more battery, only while the conversation is on.

## Not in this plan

- **Talking back:** spoken answers, and the card asking its question out loud.
- **Finding more:** a person without their company ("Log a call with Sarah Lee"), and a memory of the last few turns ("pass it to Sam").
- **A phrase test:** 20 to 30 everyday phrasings run through Claude, a paid check of a few cents.
- **A phone app and a desktop key:** starting from a headset button or the lock screen, and V from any app.
- **A paid speech service or any new subscription:** not wanted (21 Nov).
- **Recordings:** uploading a recorded meeting for "Log meeting".

## Log

- 21 Nov 2026: written from Al-khair's chat on 21 Nov. Nothing built. Not committed: S0 copies it into `plan-v24`, with its line in the plan list.
- 21 Nov 2026, the same chat: Al-khair asked for "strong on every platform" with nothing new to pay, so Part 4 (every device) was added: the free model where the browser's service is weak. Then he chose to save every call on the server from the first word ("add those"), so Part 3 (no call lost) was added, with the plan's one backend step and one migration.
- 21 Nov 2026, read live (looking only): `master` `b84c3cf` is live since a manual deploy on 20 Nov at 7:06 am Melbourne time (19 Nov, 20:06 UTC). A custom domain, `contourhq.online`, was added on 20 Nov. `VOICE_TOOL=browser_service`, `BROWSER_SPEECH_OK=true`, and `NOTIFY_OWNER_CALLS` isn't set, so FYI tasks are on.
- What phones allow (read 21 Nov): Android always gives the mic to a call, and another app gets silence unless it is the phone's built-in assistant (Android's "Sharing audio input"). For an iPhone, Apple developer forum replies say no other app can use the mic during a phone call. That is not an Apple document (**TBC**).
- iPhone facts (read 21 Nov): WebKit's bug 225298 says the speech service isn't available in home-screen web apps or SafariViewController; the service can show as there but fail, because its permission prompt never appears. One site says otherwise, so S2 tests it. The mic itself (`getUserMedia`) works in an installed app, after a tap. Safari 26 ships WebGPU on iOS 26 (Apple's WebKit news). Moonshine Tiny (27 million parameters) and Base (61 million) are MIT, English, with ONNX builds for Transformers.js on Hugging Face. Their download sizes once quantized aren't confirmed.
- Call notes today (read 21 Nov): a call needs a company to be saved on the server (`CallNoteIn.company_key`, and `call_notes.company_key` and `company_name` can't be empty), and the card saves it as it opens, once its company is known (`card.tsx`). Without a company, it is kept only in this browser (`card/drafts.ts`). The statuses are `sorting`, `to_confirm`, `sending`, `logged`, `partial`, `failed` and `uncertain`.
- 21 Nov 2026, S0: `plan-v24` made from `master` (`b84c3cf`) in `../contour-v24`. Its first commit (`37791d8`) holds this plan and its line in the plan list, in `CLAUDE.md`, where the list is on `master`. The main folder's untracked copy was deleted after a byte-for-byte check. The main folder still has uncommitted work moving `CLAUDE.md` into `AGENTS.md` (with `.agents/`, a new agent and two new skills). It was left alone; whether it is still open is asked of Al-khair.
- S0: the database `leadfinder_v24` is a copy of `leadfinder_v23`, at `0026_v23_names_and_hubspot_user`, the newest migration, so T3-1's `0027` follows it.
- S0: fast backend tests on `plan-v24`: 3,556 passed, 28 skipped (132 s). Website tests: 2,477 passed (101 s). The first visit at `37791d8`: 248,595 B of JavaScript (gzip) in 39 files, and 25,200 B of CSS. That is the baseline for "within 1 kB".
- S0: no uncommitted work in `contour-v22`, `contour-v22-web`, `contour-v23` or `contour-v23-web`, and no commits since `b84c3cf`. PLAN-V23's two fixes before `deploy v23` aren't started. PLAN-V22's and PLAN-V23's open look steps touch the bar and the card, so a fix from them should land on `plan-v24`, or be joined at `merge v24`.
- S0, to go faster (Al-khair's ask, 21 Nov): two helper copies made from `plan-v24`. `../contour-v24-api` (branch `plan-v24-api`) builds T3-1, and `../contour-v24-device` (branch `plan-v24-device`) builds Part 4's model, worker and tool, while Part 1 is built on `plan-v24`. Their commits are cherry-picked onto `plan-v24`, as PLAN-V23 did with its web copy. Test database suffixes: `_v24` and `_v24api`.
