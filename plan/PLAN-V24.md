# The mic: plan, version 24

This plan makes the Assistant's mic strong on every device, and changes nothing else. One V starts a conversation that keeps listening until you stop it. The mic hears more cleanly, follows the right mic, and doesn't lose words. Every call is saved in the system from the first word, even before its company is found. On a laptop with Chrome or Edge, and on an Android phone, the browser's own live speech service stays, as now. On an iPhone, in the installed app too, and in Safari and Firefox, a free speech model runs on the device instead, because the browser's service is weak or missing there. The mic is shared with Teams, Zoom and calls, never taken from them. And you can always see that it is listening. Nothing new is paid. One session builds it, in five parts, one after another. It is website work, but for one small backend step.

**TBC** means to be confirmed.

- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 21 Nov 2026 (M1 done on Al-khair's word: checked again, and `master` moved to `plan-v24`. M2, the deploy, is next. Every screen still waits for his look. S1, S2, M3 and M4 wait for him).
- **Progress:** Before the build: 1 of 3. Part 1: 5 of 5. Part 2: 6 of 6. Part 3: 4 of 4. Part 4: 4 of 4. Part 5: 3 of 3. M1 to M4: 1 of 4.
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
- **Website work, but for T3-1, choice 27's one sentence, and the two backend changes Al-khair approved on 21 Nov** (a company find for the card, and a pick that doesn't teach). If a step seems to need more of the backend, stop and ask.
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

**Progress:** 5 of 5. Built and checked with the fake mic only: not yet tried in a real browser.

- [x] **T1-1. Clean sound, one check** Done 21 Nov 2026 (`044f141`). (`call-notes/mic/session.ts`, `voice-tool.ts`). Choices 1, 2 and 5.
  - The mic session gains a way to hand over the words so far and keep listening, for Part 2's turns.
  - **Done when:** tests with the fake mic pass: the sound settings are asked for, with and without a picked mic; a picked mic keeps its exact id; the voice tool gets the mic's track; and handing over the words leaves the mic and the tool running, so the next turn has no check and opens no second mic.
- [x] **T1-2. Follow the mic** Done 21 Nov 2026 (`ba847d0`). (`session.ts`, `devices.ts`). Choice 3.
  - **Done when:** tests with fake devices pass: the mic unplugged mid-turn moves to the default, keeps the words, and says "Now using {mic}"; a headset plugged in is used when no mic was picked by hand; and a hand-picked mic stays while it is there.
- [x] **T1-3. No lost words** Done 21 Nov 2026 (`bc04183`). (`voice-tool.ts`). Choice 4.
  - **Done when:** tests with a fake voice tool pass: words still being heard when the service ends are kept, once; two `network` errors and then words carry on with no problem shown; and a fourth error inside 10 seconds shows the problem, with the words kept.
- [x] **T1-4. The busy mic's words** Done 21 Nov 2026 (`9222f09`). Built, waiting for Al-khair's look at the words. (`call-notes/mic/words.ts`, the bar and the mic card). The first two rows of "Words for when things go wrong".
  - **Done when:** `screen-words.test.ts` passes; the busy problem shows Type instead in the bar and in the mic card; and the Windows line shows on Windows only.
- [x] **T1-5. Part 1 check.** Done 21 Nov 2026 (numbers in the Log). Website: lint, types, the tests, the build and `node scripts/bundle-report.js`.
  - **Done when:** all pass, the first visit grew by 1 kB at most, and the numbers are in the Log.

### Part 1 Log

- 21 Nov 2026: Part 1 built in 4 commits (`044f141` to `9222f09`) by a frontend agent on `plan-v24`. Every result comes from tests with the fake mic, tool and clock. Nothing was tried in a real browser yet.
- T1-1: the mic opens with echo cancellation, noise suppression and auto gain on, in one channel. Voice isolation is asked for only where the browser says it has it (which browsers do is **TBC**). The voice tool gets the mic's track. `MicSession.handOver()` gives a turn's words and keeps the mic, the bars and the tool running, so three turns open one mic and one check (`mic/session.test.ts`).
- T1-2: a mic unplugged mid-turn moves to the default, keeps the words and says "Now using {mic}." A headset plugged in is used when no mic was picked by hand. A hand-picked mic stays while it is there. Finding the default relies on browsers listing it first, and on Chrome's "default" entry (not tried with real devices, **TBC**).
- T1-3: words still being heard when the service ends are kept, once. A `network` error gets 3 quiet tries in 10 seconds (waits of 0.5, 1.5 and 3 seconds), "Reconnecting" shows after 1 second, and 2 seconds with no error counts as back (all **TBC** at S1). A network error after Done now finishes with the words so far.
- T1-4: the busy mic's words, with Try again and Type instead, in the bar and the mic card. The Windows line shows on Windows only. In the bar, a busy mic now shows as a problem, where before it opened on the text line. The words wait for Al-khair's look.
- Not built: choice 2's "the bar names that mic", for a browser that ignores the mic's track. The tool can't tell when that happens, so S1 checks Chrome first.
- T1-5: lint 0 problems, types 0 errors, 166 test files and 2,530 tests pass (S0: 2,477), and the build passes. The first visit: 248,593 B of JavaScript gzip (S0: 248,595), the CSS unchanged, 39 files. Opening later: the voice bar adds 1,871 B, the mic card 1,929 B.

## Part 2: a long conversation

**Progress:** 6 of 6. Built and checked with the fake mic, tool and clock only: not yet tried in a real browser.

- [x] **T2-1. Keep listening** Done 21 Nov 2026 (`bde0f36`). (`voice/bar-session.ts`). Choices 7, 9, 10, 11 and 12.
  - **Done when:** tests with the fake mic, tool and clock pass: three commands in one V each reach the command step once, in order; 2 minutes with no words ends it with the quiet line; "stop listening" ends it and sends nothing; "um" alone sends nothing; a 90-second turn isn't cut; hold V is one turn; and with "Keep listening" off, today's bar tests pass unchanged.
- [x] **T2-2. Smart pauses** Done 21 Nov 2026 (`3c414b2`). (`bar-session.ts`, with the joining words in one small file). Choice 8, with S1's numbers.
  - **Done when:** tests pass: "log a call with" waits the long pause; "log a call with Northwind" ends after the short one; a joining word and more words inside the long pause make one turn; while V is held, no pause ends a turn; and the numbers sit in `TIMES`.
- [x] **T2-3. The card in the conversation** Done 21 Nov 2026 (`e9ed835`). (`card/listen.ts`, `card/card.tsx`, `voice/hand-over.ts`). Choice 13.
  - **Done when:** tests pass: "send it" 30 seconds after the card opened sends it; "later" keeps a call in Call logs; a spoken change still works; after a send, the next turn is a new command; and outside a conversation, the 5-second listen works as now.
- [x] **T2-4. A choice by voice** Done 21 Nov 2026 (`bd54f05`). (`card/draft.ts`). Choice 14.
  - **Done when:** tests pass: "the second one" picks the second company; "Sample Logistics" picks it from the list; the same works for a person and a teammate; a person or teammate name not in the list changes nothing and says so; and none of these asks the AI. (A company name not in the list is T3-2's.)
- [x] **T2-5. Phones, windows and the switch** Done 21 Nov 2026 (`b3b1cd3`). Built, waiting for Al-khair's look at the menu row. (`bar-session.ts`, `bar.tsx`, a new switch file beside `voice/v-switch.ts`, and the menu row in `links.tsx`). Choices 6, 15 and 16.
  - **Done when:** tests pass: the wake lock is taken at the start and let go at every end (Stop, the quiet stop, Esc, a problem, a hidden page); a refused wake lock changes nothing else; a hidden page on a phone ends with the words kept; "Keep listening" is on by default, stays after a reload, and counts as on when storage is blocked; and Al-khair has seen the menu row.
- [x] **T2-6. Part 2 check.** Done 21 Nov 2026 (`e7ce884`, numbers in the Log). As T1-5, plus the `design-review` skill on the bar and the card.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 2 Log

- 21 Nov 2026: Part 2 built in 6 commits (`bde0f36` to `e7ce884`) by a frontend agent on `plan-v24`. Every result comes from tests with the fake mic, tool and clock. Nothing was tried in a real browser, at any width, in dark mode or on a phone.
- T2-1: the conversation keeps one `MicSession` (`voice/bar-session.ts`). Each turn comes from `handOver()` into a queue, with one command step at a time. A turn is read in this order:
  - "stop listening" or "that's all" ends it;
  - an open card reads it first: its fixed words, then a choice by voice;
  - fewer than 2 real words are dropped;
  - over 2,000 characters go to the text line;
  - anything else goes to the command step.
- With "Keep listening" off, today's bar tests pass unchanged. `bar-session.test.ts` is untouched, and two test files only gained a `beforeEach` that turns the switch off.
- T2-2: a turn ends after 1.2 s, or after 3 s when it ends on a joining word or a half command (`voice/pauses.ts`). A turn can run 2 minutes, and the quiet stop comes after 2 minutes. All are **TBC** at S1, in `TIMES`.
- T2-3: a card for a call, task or email hears the conversation. A pre-read question or dictation ends it. A turn said while a card is on its way waits until the card is there or closed. While a card is open, the bar hides, and the card's foot shows the conversation's strip: the bars, the words, Stop (V) and the last line.
- T2-4: "the second one" or a name picks a company, person ("no one" too) or teammate, with no AI (`card/choose.ts`). A name is at most 3 words, with no word of a change (**TBC**).
- T2-5: the wake lock is held while the conversation is on, and let go at every end. A phone is told by its pointer being a finger. Leaving the page on a phone ends the conversation with the words kept. A laptop window behind another keeps listening (**TBC** at S1). "Keep listening" sits right after "Use V to speak" in the profile menu, on by default.
- New words, **TBC** at Al-khair's look: "Sent.", "Send or keep this one first.", "Pick one, or say its number.", the next-command hint, Stop and Start again.
- T2-6, the agent's run:
  - lint 0 problems, types 0 errors, and the build passes;
  - 2,677 of 2,679 tests passed in 172 files. The two failures were a timing race in a new quiet-stop test (fixed) and `src/hooks/useRunEvents.test.tsx`, an exact-timing test this plan doesn't touch;
  - after the fix, the 13 files concerned passed (472 tests);
  - my full run on `e7ce884` afterwards: 2,679 of 2,679 tests passed in 172 files (159 s).
- T2-6, the size: the first visit is 248,591 B of JavaScript (gzip) in 39 files (S0: 248,595), and the CSS is unchanged. The bar's late file grew from 22,175 B to 26,731 B gzip, which isn't in the first visit.
- The `design-review` skill on the bar and the card found three things, all fixed:
  - a read-back stayed on screen after a later command opened a page;
  - the keyboard focus fell to the page when a card closed mid-conversation (the bar takes it back now);
  - Part 1's "Reconnecting" and "Now using {mic}." now show in the bar and the card's strip.
- For Al-khair (**TBC**):
  - "Sent." shows while the hold's Undo toast is still up;
  - the bar rises again (400 ms) after each card;
  - "2 minutes" is written into the quiet line;
  - a failed command ends the conversation and drops the turns said after it.
- For T5-1: the card is a modal dialog, so the pill must sit inside the card's dialog layer, or Stop can't be clicked.

## Part 3: no call lost

**Progress:** 4 of 4. T3-2 and T3-3 wait for Al-khair's look.

- [x] **T3-1. Calls saved before their company** Done 21 Nov 2026 (`866e20e` to `1e579e0`, built on `plan-v24-api` and cherry-picked). (backend: `apps/companies/schemas.py`, `tables.py`, `note_store.py`, `note_batch.py`, `api_notes.py`, and the migration). Choices 17, 18 and 21, and "The contract".
  - **Done when:** tests pass: a call with no company is saved as `needs_company`, with the name as heard, and isn't sorted; the PATCH sets its company and starts the sort; a company the person can't see gives 422; a company on a call already sorted gives 409; the send leaves a `needs_company` call out and says why; a Viewer can't do any of it; and the migration goes up and down cleanly.
- [x] **T3-2. The card saves at once, and hears the company again** Done 21 Nov 2026 (`4cd8e3e` to `b5f0a2a`, then `45247d9` to `0d06950` for choice 19's find, on Al-khair's word). Built, waiting for Al-khair's look. (`card/card.tsx`, `card/company.tsx`, `card/send.ts` and `card/drafts.ts`). Choices 17 and 19.
  - **Done when:** tests pass: a call whose company isn't found is saved at once as "Needs a company"; Later keeps it in Call logs, not in this browser; the next words fill the company search and show its results as choices; "the first one" picks, and the call is sorted; a name found nowhere says so and keeps the call; and tasks and emails are still kept in this browser, as now.
- [x] **T3-3. "Needs a company" in Call logs** Done 21 Nov 2026 (`c90e8be` to `4747216`, built on `plan-v24-logs` and cherry-picked). Built, waiting for Al-khair's look. (`apps/companies/call-logs/`). Choice 20.
  - **Done when:** tests at 1440 and 390 px pass: the group sits at the top with its count; each row shows the name as heard and "Pick company"; a pick moves the call to To confirm once it is sorted; a send leaves these calls out and says why; and Al-khair has seen it.
- [x] **T3-4. Part 3 check.** Done 21 Nov 2026 (numbers in the Log). Backend: ruff, ruff format, mypy, the fast tests, the Companies tests and the contract gate (`RUN_GATES=1`). Website: as T2-6. The `security-check` skill on T3-1.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 3 Log

- 21 Nov 2026: T3-1 was built by a backend agent in 5 commits on `plan-v24-api` (`5d782b1` to `25a44b6`), and cherry-picked onto `plan-v24` as `866e20e` to `1e579e0`. It brings:
  - the migration `0027_v24_call_needs_company`;
  - the PATCH that picks the company and starts the sort;
  - the send's `skipped` list;
  - `?state=needs_company` and the summary's count;
  - the contract and the website's types, made again.
- T3-1's proving tests are in `tests/companies/`: `test_call_notes_company.py`, `test_call_notes_batch.py` and `test_call_notes_company_table.py`.
- T3-1's checks:
  - Ruff and its format check are clean (478 files), and so is mypy (442 files);
  - the fast tests: 3,557 passed and 28 skipped. The Companies tests: 670 passed;
  - the contract gate fails only when the whole suite is collected, at `LeadCard.confidence`, the known issue from 20 Nov. Run alone, it passes;
  - the `security-check` skill found no blocker. It asked for one more test, which is in (`2fba7aa`).
- The migration went down and up on a throwaway copy of `leadfinder_v24`. Going down was refused while a call waited for its company. `leadfinder_v24` itself is at `0027` now, with its 3 calls kept.
- T3-1's choices:
  - an empty company comes back as `null`;
  - a pick teaches the mic in the PATCH, through PLAN-V23's learned names, with the card's rules;
  - before its company is set, a call takes only `outcome`. Any other change gets 409 `company_first`, so the card keeps spoken follow-ups until the call is sorted (T3-2);
  - a retried pick of the same company gets 409 `company_set`, and the website re-reads the call.
- T3-1 changed files outside the plan's list:
  - a new `apps/companies/note_company.py`, so the learned names' code doesn't import in a loop;
  - small guards in `notes.py`, `assistant_find.py` and `assistant_names.py`, so a call with no company doesn't crash them;
  - a shared rule in `assistant_learned.py`.
- **For Al-khair:** Today's counts and the 4:30 pm reminder email don't count calls that need a company yet (**TBC**).
- A backend restart during a picked call's sort sends the call to To confirm at once, to be sorted by hand. A new call waits 2 minutes first.
- On `plan-v24`, after T3-1, the website's types show 9 errors, all in `call-logs/` and `call-notes/call-notes.test.tsx`. T3-3 fixes them.

- 21 Nov 2026: T3-3 was built by a frontend agent in 4 commits on `plan-v24-logs` (`4db6d0f` to `7d1226b`), and cherry-picked onto `plan-v24` as `c90e8be` to `4747216`. It is built and waiting for Al-khair's look.
- T3-1's type errors are fixed with one helper, `callCompany` in `call-logs/words.ts`. It gives the company's name, or the name as heard, in quotes. History offers "Log another call" only when the call has a company.
- A bug was found and fixed: `bumpCounts` (`src/api/hooks/call-notes.ts`) rebuilt the counts with 3 fields. So a save or a send would have hidden the group until the next read.
- The tests are in `call-logs/needs-company.test.tsx`, each at 1440 and 390 px through the media-query fakes. They prove:
  - the group sits at the top with its count;
  - each row shows the name as heard and "Pick company";
  - a pick moves the call to To confirm once it is sorted (the PATCH sends `company_key` only);
  - a send leaves these calls out and says why.
- The same file also covers:
  - Esc puts the focus back;
  - a 422 shows the server's words;
  - a 409 `company_set` reads the call again;
  - Remove with Undo;
  - a Viewer sees no buttons.
- The checks, in that copy (without Parts 1 and 2):
  - lint 0 problems, and the types are clean;
  - 2,512 tests passed in 166 files;
  - the build passes. Call logs' file is 53.9 kB (16.1 kB gzip).
- Words for Al-khair's look (**TBC**):
  - the group: "Needs a company" with its count, then "We couldn't find the company for these calls, so they can't go to HubSpot yet. Pick each one, and its call moves to To confirm.";
  - each row: '"North Wind" as heard', with Pick company and Remove;
  - the pick panel: 'Heard as "North Wind". Which company was the call with?';
  - a send: "2 calls need a company first. They stay in Call logs."
- Its choices, **TBC** with Al-khair:
  - Call logs waits for the counts as well as the switches before it draws the tabs, so the group never pushes them down;
  - the group shows the newest 3 calls, with "Show all";
  - "Pick company" is in the group only, not in History;
  - a wrong pick can't be changed, because the server takes `company_key` once. The rep removes the call in To confirm and logs it again. Changing it would need a backend change.
- Not checked yet: a browser, 1280 px, dark mode, reduced motion and a real screen reader. The bundle report wasn't run: Call logs is a late page.
- The menu's count and Today don't count these calls yet, as T3-1 noted.
- 21 Nov 2026: T3-2 was built by a frontend agent in 3 commits on `plan-v24` (`4cd8e3e` to `b5f0a2a`), after it cherry-picked T3-3. It is built and waiting for Al-khair's look.
- What T3-2 does:
  - a call whose company isn't found is saved at once as "Needs a company", with the name as heard;
  - Later keeps it in Call logs, with the toast "Kept in Call logs, under Needs a company.";
  - the next words fill the company search, and its matches show as choices;
  - "the first one" picks: the company goes as a PATCH, the call is sorted, and the AI isn't asked;
  - a name found nowhere says so and keeps the call.
- T3-2 also:
  - a send says why a call that needs a company waits, with Open Call logs, and never sends it to HubSpot;
  - a spoken change waits until the call is sorted ("That change waits until the call is sorted."), while an outcome goes at once;
  - tasks and emails are still kept in this browser.
- T3-2's tests are in `card/needs-company.test.tsx`, `card/send.test.tsx` and `card/choose.test.ts`. Typing and the keyboard alone do the same.
- T3-2's checks:
  - lint 0 problems, and types 0 errors (T3-3 cleared the 9);
  - 2,743 of 2,743 tests passed in 174 files. A first full run had 1 failure in `links.test.tsx`, a 1-second wait under load. It passes alone, and the second full run was clean;
  - the build passes.
- T3-2's size: the first visit is 248,771 B of JavaScript (gzip) in 40 files, +176 B on S0 and within 1 kB. The extra file is Lucide's Send icon, which became a file of its own before T3-2. The bar's late file grew from 26,755 B to 28,302 B gzip.
- **A gap against choice 19, for Al-khair.** The card's search reads only our HubSpot copy, by names that contain the words said, so "North Wind" doesn't find "Northwind". The learned names and HubSpot's own search aren't asked. HubSpot's search is reached only through Add to HubSpot's check. Finding a company as the command step does, with no AI, needs a small backend route, and the plan says to ask first.
- **"Which Sample?" calls** (two or more companies found) aren't saved at once. The server teaches the mic on every pick of a call that needs a company, but PLAN-V23 says a pick from the command's own choices shouldn't teach. So they are saved after the pick, or as "Needs a company" on Later. Saving them at once needs the PATCH to skip teaching, which is backend work.
- Still kept only in this browser on Later (**TBC**):
  - a "Which James?" still to answer;
  - no company name heard, because the server needs 1 to 120 characters;
  - a save that failed twice.
- Known gaps (**TBC**):
  - a change said before the call is sorted is lost if the card closes first (an outcome isn't);
  - after a refused pick, the search box goes back to the name as heard;
  - after a pick, the person stays "No one in particular";
  - the conversation strip (Part 5's) still says "Say 'send it'" on these calls.
- Words for Al-khair's look (**TBC**):
  - "We couldn't find 'North Wind'. The call is saved. Say the company again, or pick it.";
  - "Still no '{words}'. Say it again, or pick it later in Call logs.", and on a task card "Still no '{words}'. Say it again, or pick it.";
  - "1 call needs a company first. It stays in Call logs.", with Open Call logs.

- 21 Nov 2026: Al-khair's two backend changes were built by a backend agent in 3 commits on `plan-v24-api` (`08ac349`, `9371bdb` and `0198862`). They were cherry-picked onto `plan-v24-card` (`01f48b5` to `e9af013`) for the card's side, and onto `plan-v24` as `45247d9` to `63bbd32`.
- **The find:** `GET /companies/assistant/companies/find?words=...`, with no AI.
  - It runs the command step's own company search, now one shared function (`company_for_words`): the learned names, our copy, then HubSpot's own search.
  - It answers with the command step's company shape (found, up to 5 choices, and `can_add`) and its line.
  - The words are 1 to 120 characters. An email or phone gives 422 `contact_details`, as Add to HubSpot does.
  - It needs the Call logs or Meetings tick, and never works for a Viewer. It works with the AI sort off.
- **The PATCH** gains `teach`, which means true when left out. A "Which Sample?" pick sends `teach: false`, so the call can be saved at once.
- The tests:
  - `tests/companies/test_assistant_find_company.py`: our copy, a learned name, HubSpot's search (with a fake HubSpot), nothing anywhere, a Viewer refused, no AI ever called, and the 422s;
  - `test_call_notes_company.py`: `teach: false` teaches nothing and the call is sorted as now, and `teach` on its own changes nothing.
- The checks:
  - Ruff and its format check are clean (479 files), and so is mypy (443);
  - the fast tests: 3,558 passed and 28 skipped. The Companies tests: 679 passed;
  - the contract gate passes alone (3 passed). With the whole suite collected, it has the known enum-order failure (`confidence` on the lead models, and `TodayTask.priority`). None of it comes from this change.
- The `security-check` skill found no blocker. Two low points, **TBC**:
  - the words travel in the address, as `GET /companies/search?q=` does today, so the host's request logs may keep a company name. A POST would avoid it;
  - the find has no limit for each person. Each name our copy lacks costs one free HubSpot search.
- Outside the two changes: `no_default_in_types` moved to `core/api/models.py`, so `teach` stays optional in the website's types.
- 21 Nov 2026: the card's side of choice 19's find was built by the same frontend agent in 3 commits on `plan-v24-card` (`2bb86fc`, `bc12399` and `47ef71c`). With the backend's 3, they were cherry-picked onto `plan-v24` as `45247d9` to `0d06950`. This closes the gap above.
  - A name said again, or typed and then entered, goes through the find:
    - one found becomes the card's company at once, with "… is new in HubSpot. We'll use it." when HubSpot's search found it;
    - two or more show as choices ("Which North Wind?");
    - nowhere shows "Still no …", with Add to HubSpot.
  - Keys typed still filter our copy. A 404 from the find (an older server, during a deploy) falls back to our copy's search.
  - A "Which Sample?" call is saved at once as "Needs a company", and a pick from the command's own choices sends `teach: false`. A pick from the find's results teaches.
  - Its tests: `card/find-company.test.tsx` (11 tests), and one changed test in `needs-company.test.tsx`.
  - Its checks: lint 0 problems, types 0 errors, 2,927 of 2,927 tests in 187 files, and the build passes. The first visit is 249,084 B in 41 files (+489 B on S0). The card's side adds nothing to it.
  - **TBC** for Al-khair:
    - a single match from the find is picked at once, with no second look. Once sent, it can't be redone (409 `company_set`);
    - a find answer that comes after the rep typed something else still picks, if it found one company.

- 21 Nov 2026, T3-4, the Part 3 check, on `plan-v24` at `d0a74c3`:
  - **The backend** is the same as `plan-v24-api`'s checked tip: `git diff` is empty for `engine/backend`, `openapi.json`, `schema.d.ts` and `engine/schema`. There, Ruff and its format check were clean (479 files), and so was mypy (443 files). The fast tests passed 3,558 and skipped 28. The Companies tests passed 679. The contract gate passed alone (3 passed).
  - **The review's run on `plan-v24`:**
    - Ruff, the format check and mypy are the same;
    - the fast tests with `RUN_GATES=1`: 3,560 passed, 25 skipped and 1 failed, the known 20 Nov enum-order issue, which passes alone;
    - the Companies integration tests: 448 passed and 1 failed. The failure was `test_companies_speed` (680 ms against 300 ms), on code this plan doesn't change.
    - After a `VACUUM ANALYZE` of the test database, with no backend sharing it, that test passed alone (4.5 s). Then the Companies integration tests passed 449 of 449 (7.5 minutes), so all 679 Companies tests pass, with the fast ones.
  - **The contract:** a fresh `engine openapi` and openapi-typescript match the files byte for byte. There is one migration head (`0027`), and `schema_map --check` matches.
  - **The website:** lint 0 problems, types 0 errors, 2,958 of 2,958 tests passed in 189 files, and the build passes. The first visit is 249,092 B of JavaScript (gzip) in 41 files (+497 B on S0), and 25,331 B of CSS (+131 B).
  - **The `security-check` skill:** no blocker on T3-1 (one more test added), on the find route and `teach` (two low points, **TBC**), or in the review's own pass.
  - **The `design-review` skill and the browser pass** on the card's company step and Call logs' group: no design must-fix. The browser pass found three things, fixed in `e3fdaf2`, `59aada4` and `284545b`:
    - the focus started on the dimmed Send;
    - Esc in the send dialog dropped the focus;
    - a single find result was picked at once.

## Part 4: every device

**Progress:** 4 of 4. Built before S2, with the plan's **TBC** defaults: S2 decides the model, the GPU and the download size.

- [x] **T4-1. The model's files and the worker** Done 21 Nov 2026 (`442ec59` to `d0356aa`, built on `plan-v24-device` and cherry-picked). App Platform's size limit is checked on paper only; it is tried live at M2 (**TBC**). (a build script in `engine/frontend/scripts/`, a Web Worker beside `voice-tool.ts`, `index.html`, the Caddyfile and `csp.test.ts`). Choices 23 and 25.
  - Check first that App Platform's static site serves files this big (**TBC**). If it can't, stop and tell Al-khair.
  - **Done when:** the build fetches the model at its fixed version and fails on a wrong checksum; the worker loads it and turns a made-up test sound file into words; nothing of it is in the first visit; and `csp.test.ts` passes with the new rules.
- [x] **T4-2. The on-device voice tool** Done 21 Nov 2026 (`5a629de` to `9b4acef`, built on `plan-v24-device` and cherry-picked). (`voice-tool.ts` and a new file beside it, and choice 27's words). Choices 24, 26, 27 and 28.
  - It gives the same five events as the browser's tool (`onReady`, `onWords`, `onHearing`, `onFinished` and `onProblem`), so the bar and the card don't change. It listens to our own mic track, the one Part 1 cleaned.
  - **Done when:** tests with a fake worker pass: speech then a pause gives the words once; a long talk gives the words turn by turn; Stop gives the last words, then `onFinished`; a worker that fails gives the "voice tool didn't load" problem; a slow device gives the too-slow problem; and a test proves no request carries the sound.
- [x] **T4-3. The engine picks itself, and the download** Done 21 Nov 2026 (`b2129e9` to `af3dd56`, and `b3d9a76`). Built, waiting for Al-khair's look at the download line and the menu row. (`voiceToolFor` in `voice-tool.ts`, `session.ts`, and the profile menu). Choices 22, 25 and 27.
  - **Done when:** tests pass: Safari and the installed app on an iPhone, and Firefox, get the model; Chrome on a laptop and on Android gets the service; a service that doesn't start in 5 seconds moves to the model and remembers it; `browser_model` gets the model everywhere; the download shows its progress line and can be skipped with Type instead; and a second visit doesn't download again.
- [x] **T4-4. Part 4 check.** Done 21 Nov 2026 (numbers in the Log). The 4x number is an estimate: Chrome can't slow a worker, so S2 gives the real slow-device number. As T2-6, plus the `speed-check` skill, and the `security-check` skill on the new package and the content policy. Its numbers: the first visit, the worker's size, and the model's time on a laptop at 4x CPU slowdown.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 4 Log

- 21 Nov 2026: T4-1 and T4-2 built in 8 commits on `plan-v24-device` (`7dae7bf` to `ddc86ed`) by a frontend agent, before S2, with the plan's **TBC** defaults. They aren't on `plan-v24` yet, and nothing is wired in: that is T4-3.
- **App Platform and big files.** DigitalOcean's limits pages name no size limit for a static site, per file or in all. A static site is served from Spaces through the CDN, and Spaces takes 5 GB per upload. A build gets 1 hour and 24 GiB of disk.
  - The live site (21 Nov) sits behind Cloudflare, with `Cache-Control: public,max-age=10,s-maxage=86400`.
  - It answers a missing file with index.html and a 200. So the browser checks each file's size and sha256 before keeping it.
  - The biggest file is 42.5 MB. It isn't tried live until M2 (**TBC**).
- **Pinned:**
  - `@huggingface/transformers` 4.3.2, which brings `onnxruntime-web` 1.31.0-dev.20260914;
  - Moonshine Base, `onnx-community/moonshine-base-ONNX` at `b1e9b6a`: 66.9 MB;
  - Moonshine Tiny, `onnx-community/moonshine-tiny-ONNX` at `a6da124`: 32.1 MB;
  - Silero VAD, `onnx-community/silero-vad` at `e71cae9`: 2.2 MB;
  - Whisper base.en, for S2 only, `onnx-community/whisper-base.en` at `51eefc0`: 79.6 MB.
  - All are the 8-bit (q8) files, and every sha256 is in `on-device/files.json`. The runtime is 14.3 MB on the CPU, or 26.9 MB with WebGPU.
- **The first download on a device:** Moonshine Base is 83 MB on the CPU and 96 MB with WebGPU, above choice 25's 30 to 70 MB (**TBC** at S2). Tiny is 49 MB on the CPU.
- **What the build costs:**
  - `npm run build` runs `scripts/voice-files.js`. It fetches 101.2 MB from Hugging Face at the pinned versions (35 s here), and a wrong sha256 fails the build.
  - So a Hugging Face outage fails an App Platform build. The live version stays.
  - `node_modules` gains onnxruntime-node (288 MB) and sharp. They are for Node only and never bundled.
- **Tried in headless Chrome 157,** through the real worker and tool, with sound files made by Windows' own voice:
  - Base on the CPU heard "Log a call with sample logistics": 0.25 s for 2.3 s of sound, with the words 0.75 s after the pause;
  - it also heard "Joe sample wants to follow up next Tuesday", but "Send it." as "Senator,";
  - Tiny heard "Send it." right, but heard "Logical with…".
- **WebGPU on this laptop** (Intel graphics) took 2.5 s against the CPU's 0.26 s, with the 8-bit files. `WEBGPU_FIRST` stays on, per choice 23, until S2.
- **Requests:** every request was a GET to our own site for a listed file. There was no content policy error, and a second visit downloaded 0 MB.
- T4-1 and T4-2's checks:
  - lint 0 problems, types 0 errors, 2,524 tests passed in 169 files, and the build passes;
  - the first visit is the same as S0's baseline (+0 kB, the same main file);
  - the worker will be 546 kB raw (157 kB gzip).
- Three things were sent back to fix before the join:
  - a wrong file kept by the service worker would count as kept;
  - choice 28: the name fix needs capitals, but the model writes names in lower case;
  - "Send it." misheard: padding a short turn with silence is being tried.
- The S2 page is in `plan/shots/v24/s2/` in `../contour-v24-device`, which git ignores. Its README has the iPhone steps.

- 21 Nov 2026: the three fixes, in 4 more commits on `plan-v24-device` (`676657f` to `268c92e`). All 12 commits were cherry-picked onto `plan-v24-wire` (`6a1ea15` to `0cbf545`) in `../contour-v24-device`, a branch made from `plan-v24` at `c9b90a2`, where T4-3 was built. They are on `plan-v24` as `5a629de` to `8687317`.
- **A wrong kept file never counts as kept.** Only a copy in our own store counts, and only if it carries the size written when its check passed. A failed check deletes the address from both stores, ours and the service worker's.
- **Choice 28 on the model's words.** The model's tool says its words don't capitalise names. Then:
  - a run of 2 or more words that is a name, ignoring case, gets the name's capitals: "sample logistics" becomes "Sample Logistics";
  - one near miss inside such a run is fixed and shown;
  - a word alone never changes, and a list of everyday words guards the rest: "shall" never becomes "Shell".
  - The limit (**TBC** at S2): on the model's path, a one-word name heard wrong isn't fixed, and neither is a first name under 4 letters.
- **"Send it." misheard.** With Windows' two voices, 16 short commands per model:
  - Moonshine Base got 12 of 16 right with no quiet added, and 16 of 16 with 300 ms of quiet on each side;
  - Tiny got 14 of 16 with none, and fewer with quiet.
  - Kept: Base pads turns under 1.5 s with 300 ms; Tiny and Whisper don't (**TBC** at S2).
- **The GPU is slow only with the 8-bit files.** On this laptop's Intel graphics, for 2.3 to 2.7 s of sound:
  - Base, 8-bit files on the GPU: 2.8 to 3.2 s;
  - Base, fp32 encoder and q4 decoder on the GPU: 0.5 s once warm. These files are 154 MB, for S2's page only;
  - Base, 8-bit files on the CPU: 0.25 to 0.35 s, still the fastest;
  - Whisper base on the CPU heard every line right, but took 3.5 s.
- The fixes' checks: lint 0 problems, types 0 errors, 2,536 of 2,536 tests passed, and the build passes. The first visit is the same (+0 kB). The everyday-word list adds about 2 kB to the bar's and the mic card's late files.

- 21 Nov 2026: T4-3 was built by a frontend agent in 8 commits on `plan-v24-wire` (`2e208bc` to `4745dfa`), after Part 4's 12. It was cherry-picked onto `plan-v24` as `b2129e9` to `af3dd56`, by the Part 5 agent. It is built and waiting for Al-khair's look at the download line and the menu row. Nothing was tried in a real browser, or with a real download.
- **The engine choice.** `engineFor` (`call-notes/mic/voice-engine.ts`) gives:
  - the browser's service: Chrome or Edge on a laptop, and Chrome on Android;
  - the model: any browser on an iPhone or iPad, including the installed app and an iPad that shows a Mac's user agent, plus Safari on a Mac and Firefox;
  - the model everywhere, with `browser_model`.
- **The 5 second move.** A service that doesn't start within 5 seconds moves to the model, and this browser remembers it (`contour-voice-engine`). It doesn't move during "Reconnecting", or where the model can't run.
- **The download.** One shared store, `mic/voice-ready.ts`.
  - The session gets the model ready before the mic opens, so the 5 second start limit never runs during a download.
  - A laptop that needs the model downloads it when the page is idle, and loads it at the first Speak.
  - Nothing downloads on a phone before Speak, with typing, or while the setting is unknown. The default is now `typing`.
- **The rest:**
  - the name fix gets the tool's name case (choice 28);
  - `voiceToolFor`, and the old "isn't set up yet" problem, are gone;
  - Settings calls `browser_model` "A free model on the device: the voice never leaves the device" (choice 27).
- T4-3's tests: `voice-engine.test.ts`, `session.test.ts` ("the engine picks itself"), `bar-session.test.ts`, `bar.test.tsx`, `mic.test.tsx`, `voice-ready.test.ts`, `on-device/download.test.ts`, `get-ready.test.tsx` and `errors.test.ts`.
- T4-3's checks, on its branch:
  - lint 0 problems;
  - the types show only the 9 T3-1 errors, which T3-3 fixes;
  - 2,835 tests passed in 181 files;
  - `npx vite build` passes. `npm run build` stops at those 9 errors there.
- T4-3's size:
  - The first visit is 248,904 B of JavaScript (gzip) in 40 files, +309 B on S0. The 40th file is Vite's preload helper (958 B), moved out by the shared code's `import()`. Without that `import()`, it was 39 files and 248,617 B. Accepted.
  - The late files grew: the bar from 67,788 B to 71,448 B, the mic card from 22,203 B to 25,498 B, and the menu's parts from 12,231 B to 14,350 B.
  - Loaded only where the model is the engine: the tool, 4,701 B gzip; the worker, 561 kB raw; and the runtime, 14.3 MB (26.9 MB with WebGPU). None is precached.
- Words for Al-khair's look (**TBC**):
  - the download line: "Getting voice ready on this phone" (or tablet, or computer), "Only this once." and "41 of 83 MB", with a bar;
  - "Getting voice ready" while the model loads;
  - the plan's download-failed and too-slow lines;
  - new: "Voice to text couldn't start on this device. Use your keyboard's mic, or type.", for a model that won't load;
  - the menu row: "Get voice ready", "About 83 MB, best on Wi-Fi", then "Voice is ready on this phone".
- For Al-khair (**TBC**):
  - a download that started goes on after Type instead or closing, which uses mobile data;
  - a laptop loads the model only at the first Speak, a second or two of "Getting voice ready";
  - a move to the model never expires;
  - while the model gets ready, the bar has no Navy button, and V closes the bar;
  - `browser_service`'s words still say the voice goes to Google or Microsoft, which is now true only where the service is the engine.
- Not checked yet:
  - on an iPhone, whether the sound starts after a long download without a fresh tap (S2);
  - the download runs on the main thread.

- 21 Nov 2026, T4-4, the Part 4 check, on `plan-v24` at `d0a74c3`, with the website numbers as T3-4's.
- **The `security-check` skill:**
  - `@huggingface/transformers` is 4.3.2 exactly (Apache-2.0), with an integrity hash in the lock;
  - `onnxruntime-web` is a nightly build (1.31.0-dev.20260914), pinned exactly by the lock, and the build checks its 3 files' sha256;
  - all 5 model weight files match Hugging Face's own sha256 and size at the pinned commits (checked 21 Nov);
  - the content policy matches the Caddyfile, with no `'unsafe-eval'` and no `blob:` worker;
  - no request carries the sound.
- **The security check also found two things, fixed in `0d3ccf9` and `5b8ab74`:**
  - the Docker image's `npm ci` ran before `.npmrc` was copied, so onnxruntime-node downloaded CUDA files;
  - on App Platform the page's content policy doesn't reach the worker, so only the code's settings keep it to our own site. A test now guards them.
- **The `speed-check` skill:**
  - the first visit is as T3-4's;
  - the late files, own file then what opening adds (gzip): the bar 31,095 B (76,027 B), the mic card 3,477 B (25,688 B), the profile menu 3,830 B (14,378 B), and Call logs 16,048 B (72,286 B);
  - only where the model is the engine: the tool, 4,708 B gzip; the worker, 561,410 B raw (160,666 B gzip); the CPU runtime's script, 24,381 B; the sound tap, 494 B; the runtime, 14.26 MB (26.86 MB with WebGPU); and the models, 66.9 MB plus 2.2 MB;
  - none of the first visit's 41 files mentions the model.
- **The model's time:** Chromium 159 headless, 12 cores, no WebGPU adapter, the S2 page at `d0a74c3`, two made-up sound files, 4 runs each.
  - Moonshine Base on the CPU takes 0.10 s of model time per second of sound. The words come 0.7 to 0.8 s after the speech ends.
  - **At 4x slowdown, it can't be measured this way.** Chrome's CPU throttling doesn't reach a Web Worker ("Operation is only supported for pages, not workers"). Slowing the page alone delayed the words to 0.8 to 1.5 s after the speech.
  - Times four gives about 0.4 s per second of sound, under the too-slow rule. That is an estimate. The slow-device number comes from S2, on a real phone.
- **The browser pass found "Get voice ready" in the profile menu failing on every first visit,** with the service worker on: React error #185 in the download's progress. Fixed in `2aa5673`, with one copy of the runtime kept since `e42cd68`.

## Part 5: listening you can see

**Progress:** 3 of 3. T5-1 waits for Al-khair's look.

- [x] **T5-1. The pill, the tone and the lines** Done 21 Nov 2026 (`91b125b`, `2eb3d1e`, `8fdc6e2` and `74d719a`). Built, waiting for Al-khair's look. (`voice/bar.tsx`, `voice/words.ts`). Choices 29 to 31.
  - **Done when:** tests at 1440 and 390 px pass: the pill shows while a card is open and goes at the end; Stop on it ends the conversation; each tone plays once (a fake sound); each line is said once to a screen reader; and Al-khair has seen it.
- [x] **T5-2. A button for every voice step.** Done 21 Nov 2026 (`58f87c3`). "Decided in chat" 5.
  - **Done when:** two tests do a conversation's work with the mic off, one by keyboard only and one by clicks only: a command typed, a choice picked, a company picked for a call that needs one, Send, Later, Try again, Type instead and Stop.
- [x] **T5-3. Part 5 check.** Done 21 Nov 2026 (numbers in the Log). Lighthouse and INP weren't run. As T2-6, plus the `speed-check` skill. Each screen at 1440, 1280, 768 and 390 px, light and dark, by keyboard only, and with reduced motion.
  - **Done when:** all pass, and the numbers are in the Log.

### Part 5 Log

- 21 Nov 2026: T5-1 and T5-2 were built by a frontend agent on `plan-v24` in 6 commits (`b3d9a76` to `74d719a`), after it cherry-picked Part 4 and T4-3. They are built and waiting for Al-khair's look. Screenshots of a throwaway page with the real parts are in `plan/shots/v24/t5-1/`, which git ignores.
- **The pill** (`voice/pill.tsx`, `voice/pill-state.ts`):
  - It sits under the card, 384 px wide, inside the card's dialog layer (`MicSheet`'s new `aside` slot).
  - It holds the bars, the bar's title and Stop (V). Under them go the words, the last line or a hint.
  - It replaces the card's conversation strip, and shows the download, too-slow and download-failed lines.
  - The card never moves when the pill comes or goes. On a tall card on a phone, the card gives up the pill's height, and Send stays in view.
  - DESIGN.md bans pills, so it has the 10 px corner, and "pill" is only its name (**TBC**, Al-khair's call).
- **The tone** (`voice/tone.ts`): two sine notes made in code, 587 Hz then 880 Hz to start, and the reverse to stop.
  - They are 90 ms each (160 ms in all), at a peak volume of 0.05, about 26 dB under full.
  - It plays only after a user's gesture, once at the start and once at the stop, not every turn. It doesn't play for the card's 5-second "send it" listen.
  - **TBC** at the look. Safari's first start tone is untried.
- **The lines:** "Reconnecting", "Now using {mic}." and the quiet stop are each said once to a screen reader, from the bar to the pill and back.
- The bar comes back after a card with a 250 ms fade, without rising (principles 02 #20).
- **T5-2** (`voice/by-hand.test.tsx`): a conversation's work done with the mic off, once by keyboard only (1440 px) and once by clicks only (390 px). It covers:
  - a command typed, a choice picked, a company picked for a call that needs one, Send and Later;
  - Try again, on a failed download and on a busy mic;
  - Type instead, on the download line, on "didn't hear anything" and on words that made no command;
  - Stop.
- Two voice-only gaps were found and fixed:
  - over an open card, once the conversation stopped, only V could listen again, so a phone had no way to;
  - words that made no command offered only Try again. Type instead now sits beside it.
- Part 5's tests: `voice/pill.test.tsx` (27 tests, each at 1440 and 390 px), `voice/tone.test.ts` and `voice/tone-session.test.ts`.
- Part 5's checks:
  - lint 0 problems, types 0 errors, and 2,947 of 2,947 tests passed in 188 files;
  - the build passes, and fetched 0.0 MB;
  - the first visit is 249,090 B of JavaScript (gzip) in 41 files, +495 B on S0. Part 5 adds 0 B;
  - the CSS is 25,331 B (S0: 25,200), and the bar's late file grew from 28,768 B to 30,595 B gzip.
- The `design-review` skill on the pill and the card's foot found three things, all fixed:
  - the pill's buttons were 40 px on a touch screen, not 44 px;
  - the pill's company hint repeated the card's words;
  - a card closed within the bar's 150 ms exit could make the bar say the quiet stop again.
- The review's ideas, **TBC**:
  - on a phone, which has no Enter key, "Say 'send it' or press Enter" could say "or tap Send";
  - at silence, the pill's bars read like a dotted line.
- New words, **TBC**: "Say the company's name." where a card waits on its company, and Type instead beside Try again when words made no command.
- Not tried: the real app with its backend, a real mic or speech service, a real screen reader, a real phone, and 768 px. On the model's path, loading the model can eat into the card's 5-second listen.
- Known small gaps:
  - a V pressed within 150 ms after Esc types a "v" into the closing text line;
  - a line from a turn's answer, after Stop over a card, shows only once the card closes, as with the old strip.

- 21 Nov 2026, T5-3, the Part 5 check, on `plan-v24` at `d0a74c3`, with the website and speed numbers as T3-4's and T4-4's.
- **The browser pass** (the `simulator-agent`): six screens at 1440, 1280, 768 and 390 px, light and dark, by keyboard only, and with reduced motion. The screens: the bar in a conversation, the card with the pill, the company step, Call logs' group, the profile menu, and the download.
  - No layout or contrast problems: no text under 4.5:1, nothing cut off, no sideways scroll.
  - The words match the plan's table.
  - With reduced motion, nothing animates, and the bars become one still bar.
  - The quiet stop came after a real 2 minutes, on a phone size. V to Listening took 0.77 s.
  - 163 screenshots are in `plan/shots/v24/t5-3/`. Some show real company names from the dev copy, so they stay local.
- **Found and fixed:**
  - "Get voice ready" on a first visit (`2aa5673`, `e42cd68`);
  - a single company found is asked about before it is picked (`e3fdaf2`);
  - the focus starts in "Find a company" (`59aada4`);
  - Esc in Call logs' send dialog puts the focus back (`284545b`);
  - a connection lost after the quiet tries has its own words (`c25a3bb`);
  - a new command said over an open card keeps its words (`477d2d2`);
  - "Use your keyboard's mic" shows only on a phone or tablet (`83fb035`);
  - on a phone, a call that needs a company opens on Send, so the phone's keyboard doesn't rise over the card (`676e610`).
- **A browser re-check on `e42cd68` passed all five fixes it was given:**
  - "Get voice ready" showed its progress and then "Voice is ready on this phone" on 3 fresh visits, in about 2 s. Only our store held the runtime, and Speak afterwards downloaded nothing;
  - a single find result is a one-item choice, picked by "yes", "the first one", a tap or the keyboard;
  - the focus starts in "Find a company" on a computer;
  - Esc in the send dialog puts the focus back on Send;
  - the lost-connection words show in the bar and the pill, with Try again and Type instead.
  Screenshots are in `plan/shots/v24/t5-3/recheck/`.
- **The final run on `plan-v24` at `676e610`:** lint 0 problems, types 0 errors, and the build passes. The first visit is 249,004 B of JavaScript (gzip) in 41 files (+409 B on S0), and 25,331 B of CSS. The full test run there was stopped by Claude Code for low memory after 13 files (422 tests passed). All 3,041 tests passed in 193 files one commit before (`e42cd68`), and the changed card tests pass on `676e610` (23 of 23).
- **Not checked:**
  - a real mic, speech service, iPhone, Android, Safari, Firefox or screen reader;
  - "Now using {mic}", the Windows busy-mic line, the tone and WebGPU;
  - Lighthouse and INP.
- **Not this plan's code:** an `InvalidStateError` from the theme's view transition (`shell/theme.ts:78`) at start-up, in 4 of about 15 phone-size page loads.
- **Ideas, TBC:**
  - the bar keeps the "Try saying" height, so a gap of about 70 px sits under the quiet stop and problem lines;
  - an iPhone's first Speak shows "Getting voice ready" over the examples for about 0.6 s;
  - Today said "No calls to confirm" while 9 calls needed a company.

## Merge, checks and going live

- [x] **M1. Merge** Done 21 Nov 2026 (`8908979`, then this tick; `master` moved from `b84c3cf`). (`merge v24`, on Al-khair's word). Make the contract and the website's types again. Run the full backend checks (with `RUN_GATES=1`) and the full website checks, the `merge-check` skill and a fresh `review-agent`. Then move `master` to `plan-v24` with `git merge --ff-only`. If it won't fast-forward, stop and ask.
  - **Done when:** everything passes and `master` has moved.
- [ ] **M2. Deploy** (`deploy v24`). Push `master` and deploy to App Platform. The migration runs on deploy. It only adds a column, lets two be empty and widens the status list, so the old code runs with it. There is no live switch.
  - **Done when:** the live site answers on the new version, the model's files load from it, and the Log says so.
  - **Rolling back** (from M1's review): if live goes back to `b84c3cf` while any call needs a company, the old code breaks there. History in Call logs gives a 500 error, because the old `CallNoteOut` needs a company, and the V name hints fail on the empty company. So first pick a company for, or remove, every "Needs a company" call. The migration's down step refuses while such calls exist, but an App Platform rollback doesn't run it.
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
  - **A2. Calls from the build** (21 Nov; each is in its part's Log, **TBC**):
    - **The model (S2 decides):**
      - `WEBGPU_FIRST` is on, as choice 23 says. On this laptop the GPU was about 10 times slower than the CPU with the 8-bit files. Recommendation: turn it off, unless S2 finds an iPhone's GPU faster.
      - Moonshine Base's first download is 83 MB, against choice 25's 30 to 70 MB.
      - Every App Platform build fetches 101 MB from Hugging Face, so a Hugging Face outage fails a build. The live version stays.
    - **Calls that need a company:**
      - Today's counts, the menu's count and the 4:30 pm reminder email don't count them yet.
      - A wrong pick can't be changed: the server takes the company once. Remove the call and log it again.
      - On a call card, a single match from the find is asked about first ("Which …?"). "yes", "the first one" or a tap picks it. Whether "yes" should pick is **TBC**.
      - A change said before the call is sorted now outlives the card. It is still lost if the page closes before the sort, or if the sort takes over 10 minutes.
      - Three cases still stay only in this browser on Later: a "Which James?" not yet answered, no company name heard, and a save that failed twice.
    - **The download:**
      - A download that started goes on after Type instead or closing, which uses mobile data.
      - A device that moved to the model stays on it.
      - `browser_service`'s words in Settings still say the voice goes to Google or Microsoft, which is now true only where the service is the engine.
    - **Names and words:**
      - DESIGN.md bans pills, so the "pill" is a box with a 10 px corner.
      - The tone: 587 Hz then 880 Hz, 160 ms in all.
      - On a phone, "or press Enter" could say "or tap Send".
      - The pause and limit numbers, and the word lists, wait for S1.
    - **The find route:**
      - The words travel in the address, as the company search's do today. A POST would keep them out of the host's logs.
      - It has no limit for each person.
    - **Before `deploy v24`:**
      - "Keep listening" is on by default while Levi's W2 is still open. So on Chrome and Edge, more room sound goes to Google or Microsoft. Get W2 answered, or turn the default off.
    - **For `merge v24`:**
      - the main folder has uncommitted changes to `CLAUDE.md` (the move to `AGENTS.md`), and `plan-v24` changes `CLAUDE.md` too. So `git merge --ff-only plan-v24` would refuse there, until that work is committed or set aside. At M1 it was set aside for the fast-forward and put back unchanged, and this plan's line was added to the main folder's `AGENTS.md`. Committing that work stays Al-khair's.
    - **Small, from the browser check:**
      - after a pick on the card, Today and the menu's count catch up only on the next visit or focus. The card marks counts stale without asking again (`markCountsOld`, an older pattern used in 12 places);
      - an `InvalidStateError` from the theme's view transition shows at start-up on some phone-size loads. It is not this plan's code (`shell/theme.ts:78`).

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
- 21 Nov 2026: S1's test page is ready in `plan/shots/v24/s1-test/`, which git ignores, with a README of the steps. Its self-test passed 33 of 33 checks with a fake speech service. The real speech service is untried: that is S1, at Al-khair's keyboard.
- 21 Nov 2026: a third helper copy, `../contour-v24-logs` (branch `plan-v24-logs`, from `plan-v24-api`). It builds T3-3 on top of T3-1's contract, while Part 2 is built on `plan-v24`.
- 21 Nov 2026, Al-khair's answer in chat ("Build both"): two more backend changes, for choice 19 and decision 7.
  - A company find for the card, with no AI: our copy, then the learned names, then HubSpot's own search, as the command step finds.
  - A pick from the command's own choices ("Which Sample?") that doesn't teach the mic, so those calls are saved at once too.
  - They are built by a backend agent on `plan-v24-api`, and the card's side follows on `plan-v24`.
- 21 Nov 2026: the review's and the browser pass's fixes were built by a frontend agent in 17 commits on `plan-v24-fix`, and cherry-picked onto `plan-v24` as `0d3ccf9` to `e42cd68`. Each has a test that fails on the old code.
- **The review's fixes:**
  - the website's Docker image installs with no install scripts, so no CUDA download;
  - a test guards the worker's "only from our own site" rule;
  - a failed turn keeps the words said after it;
  - changes said before a call is sorted outlive the card, and go once it is sorted;
  - a late company find picks nothing;
  - the laptop's quiet download skips a connection that saves data;
  - a stray reply never starts a HubSpot search;
  - the download refuses files it can't check.
- **The browser pass's fixes:** listed in the Part 5 Log (T5-3).
- **Their checks:** lint 0 problems, types 0 errors, 3,041 of 3,041 tests passed in 193 files, and the build passes. The first visit is 249,006 B in 41 files, +411 B on S0.
- **New words, TBC:**
  - "That change will be made once the call is sorted.";
  - "Find", for Enter in the company box;
  - "Voice to text lost its connection. Check your connection, then try again. You can type meanwhile.";
  - on a computer, "This computer is too slow for voice to text. You can type instead." and "Voice to text couldn't start on this computer. You can type instead."
- **For Al-khair, TBC:**
  - whether "yes" picks a one-item choice;
  - the list of replies that never search;
  - whether the bar should say that a command said over a card was kept;
  - changes held for a call are lost if the page closes before the sort, and let go after 10 minutes of sorting;
  - Try again after a failed turn sends the joined words as one command;
  - whether App Platform's CDN answers a no-store download from its edge isn't known.
- 21 Nov 2026, M1 (`merge v24`), on Al-khair's word in chat: "yes please merge it to the main and deploy it".
  - **The joins:** the contract and the website's types were made again, with no change. There is one migration head (`0027`), and the schema map matches. `uv.lock` is unchanged, and `package-lock.json` adds only `@huggingface/transformers` 4.3.2 and its packages.
  - **Website:** lint and types clean, and Prettier clean after `8908979` (one line break from T1-2).
    - Tests: 3,039 of 3,042 passed in the full run. The other 3 failed only because the laptop slept in the middle of them, about 82 minutes each. Their 3 files then passed alone, 79 of 79.
    - The build passes, with its 101.2 MB of model files checked.
    - First visit: 243 kB of JavaScript (gzip) in 41 files, and 25 kB of CSS, the same as before M1.
  - **Backend,** with `RUN_GATES=1`, in five parts: 5,079 passed, 25 skipped, none failed.
    - Fast tests 3,558; Companies 449; core 664; Lead Finder and end to end 405; the gates 3.
    - In core, one test timed out connecting to the database on the busy laptop. Its file then passed alone, 28 of 28.
    - Ruff, the format check (479 files) and mypy (443 files) are clean.
  - **The review** (a fresh `review-agent` with `merge-check`): Ready with notes, no Blockers.
    - Fixed: real company names in a test. Before the push they were taken out of the whole history (the Log line of 22 Nov).
    - Added: M2's line on rolling back.
    - Notes: check on live that the runtime's `.mjs` file comes as JavaScript (M2). A phone number or email said as a company's words reaches the host's logs before the server refuses it (A2's POST point). T2-5, T3-3 and T5-1 are ticked as built, and still wait for Al-khair's look. S1 and S2 are open by his choice.
  - **`master`** moved from `b84c3cf` to `plan-v24` with `--ff-only`. The main folder's uncommitted `CLAUDE.md` (the move to `AGENTS.md`) was set aside for it and put back unchanged. This plan's line was added to the main folder's `AGENTS.md`.
- 22 Nov 2026, before the push, on Al-khair's word ("Rewrite, then push"): three company names in that test are in our HubSpot copy. So the 82 unpushed commits were rewritten with `git filter-branch`, as for PLAN-V22, and the test has made-up names from its first commit (`688494e`).
  - 45 commits got new numbers, and this plan's numbers were remapped. The fix's own commit fell away, as it was then empty. The final code is the same, byte for byte.
  - `master` was moved to the rewritten `plan-v24`.
  - The old copies stay on this laptop only, never to be pushed: `backup/master-before-v24-name-swap` and `backup/plan-v24-before-name-swap` (both the old `9aae36b`), and the helper branches `plan-v24-card` and `plan-v24-fix`.
