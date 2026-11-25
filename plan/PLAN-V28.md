# Live voice: plan, version 28

This plan gives the Assistant a live voice. A rep presses V and talks, as on a phone call. Gemini 3.8 Live, Google's talking AI, listens, talks back and asks when unsure. Claude still writes every card through today's command step, so a spoken command gives the same card as a typed one. Nothing reaches HubSpot until the rep says "send it" or presses Enter. Our own server carries the sound between the browser and Google. So the key never leaves the server, and every minute is counted against a monthly limit. Today's free mic and typing stay as the fallback. One session builds it, in five parts, on top of PLAN-V27, which joined `master` on 25 Nov.

**TBC** means to be confirmed.

- **Status:** drafted on 25 Nov 2026 from Al-khair's chat, on `plan-v28` in `../contour-v28`, and checked the same day against `master` with PLAN-V27 joined (`b52190b`). Approved on 25 Nov ("implement v28"), and being built: S0 and Part 1 are done.
- **Built by:** Al-khair Pama, with Claude. **Signed off by:** Al-khair, for the code and every screen. Levi confirms what is marked **TBC with Levi**.
- **Last updated:** 25 Nov 2026.
- **Progress:** Before the build: 1 of 3 (S0; S1 and S2 wait on Al-khair and Levi). Parts 1 to 5: 6 of 21 (Part 1). M1 to M4: 0 of 4.
- **Sources:**
  - Al-khair's chat on 25 Nov: his Google account, a test key with about US$5, "the implementation must be superb", and a branch of its own while PLAN-V27 merges;
  - the approval paper `documents/voice/VOICE.pdf` (version 3, 24 Nov), still waiting for Levi's four ticks;
  - Google's page "Start and manage live sessions" (Gemini Enterprise Agent Platform), and the pages it links to, read on 25 Nov: the Live API overview and reference, Gemini 3.8 Live's model page and guide, asynchronous function calling, language and voice, capabilities, and best practices;
  - Google's blog post "Build real-time voice applications with Gemini 3.8 Live and 3.5 Transcribe" (15 Sep 2026);
  - free checks with the test key on 25 Nov, with no sound and no text sent (see the Log);
  - the code on `master` (`d32ff3f`), then on `master` with PLAN-V27 joined (`b52190b`), read on 25 Nov;
  - the AI Brain's notes on live voice models (24 Nov) and the first plan (25 Nov).
- **Comes after:** [PLAN-V27](PLAN-V27.md), which joined `master` on 25 Nov (`b52190b`, pushed). It changed `api_assistant.py`, `assistant_schemas.py`, `config.py`, `hand-over.ts`, `bar.tsx` and `card/listen.ts`, which this plan also touches, and it added research by voice (choice 7, T3-1, T3-2 and T5-1 cover it). S0 merges it in. New code goes in new files wherever it can.

## Why

- Levi asked for an Assistant you can chat with, like a person, not one that only takes commands (the paper, page 1).
- Today only Google Chrome hears well, because it uses Google's speech service. Edge, Safari, Firefox and iPhones use Moonshine, a model on the device: about 83 MB once, and words come only after each pause.
- The Claude API has no live audio. So Claude can be the brain, but never the voice.

## How it works

1. The rep presses V and talks.
2. The browser sends the sound to our server in small pieces, one every 20 ms.
3. Our server passes it to Gemini 3.8 Live, and passes Gemini's voice back. The key stays on our server.
4. When the rep asks for something (log a call, a task, an email, a page), Gemini calls one tool: "ask Contour".
5. The browser runs that tool with today's code: the command step (Claude Haiku), then `handOver`. The review card opens, as it does for a typed command.
6. Gemini says a short line back, like "Ready. Say send it.", or Claude's question.
7. The rep says "send it". The card's own Send sends it. Gemini says "Sent." only after the card has sent.

An example, with made-up names:
- **Rep:** "Log a call with Jo at Sample Logistics. They want a site tour next week. Remind me Friday."
- **Assistant:** "Jo Sample or Jo Northwind?"
- **Rep:** "Jo Sample."
- **On screen:** the card. "Call with Jo Sample. Wants a site tour next week. Task: site tour, Friday."
- **Assistant:** "Ready. Say send it."
- **Rep:** "Send it." **Assistant:** "Sent."

## What changed from the first plan

The first plan (25 Nov, in the AI Brain) gave the browser a short-lived Google token. Three facts change it:

1. **Google says the Live API is server-to-server.** Its reference says it "isn't recommended for direct client use", and a client's input should go through an app server. So our server relays the sound (choice 1).
2. **The test key is a Gemini API key,** made in Google AI Studio, not an Agent Platform key. On 25 Nov it listed `models/gemini-3.8-live` on the Gemini API. The Agent Platform turned it away, because that API is off in the key's project. So the tests run on the Gemini API, and where live runs is A2.
3. **Live voice is a switch on each person, not a ninth tick, and not a `VoiceTool` value.** Admins get every tick by themselves (`effective_features`), so a tick would turn on a paid service for every Admin (choice 16).

## Go signals

Say the line in the session. The same line starts the work, and continues it later from the first step that isn't ticked. Saying `implement v28` counts as Al-khair's word for S0.

| Say | What it does |
|---|---|
| `implement v28` | Builds S0, then Part 1 (the server side), Part 2 (sound in the browser), Part 3 (the link to Claude and the card), Part 4 (fallbacks), then Part 5 (real tests and tuning) |
| `merge v28` | Checks everything, then moves `master` to `plan-v28` |
| `deploy v28` | After Levi's OKs: pushes `master`, deploys with live voice on for Levi and Al-khair only, and starts the two-week trial (M3) |

You'll also answer things along the way:
- **Paid steps wait for your own words in chat:** S1's short try (about US$0.01) and T5-2's 20 practice requests (about US$1.40 with Claude, TBC). Everything else uses a fake Google, for free.
- **T5-2 needs you at the keyboard** for about 45 minutes, with a headset and a phone.
- **Each screen waits for your look.** The session marks it "built, waiting for a look" and carries on.
- **The choices below** stand unless you change them before that step starts.

## Decided in chat (24 and 25 Nov)

1. **Gemini 3.8 Live is the voice, and Claude is the brain** (24 Nov). Gemini listens and talks. Claude's command step writes the card, as today. The voice can be swapped for another provider later.
2. **The paper's rules** (24 Nov): nothing goes into HubSpot until the rep checks it and says "send it" or presses Enter; Contour doesn't record or keep the voice; there is a monthly limit; and a two-week trial for Levi comes first.
3. **The test key** (25 Nov): Al-khair's Google account and key, with about US$5 for testing. It sits in the copy's `engine/.env`, which git ignores, not in this plan: this plan goes to GitHub. Live gets a key of its own at M2.
4. **A branch of its own now** (25 Nov): `plan-v28` in `../contour-v28`, made from `master` (`d32ff3f`) while PLAN-V27 merges, so nothing collides.
5. **Built from Google's own pages** (25 Nov): the session page and the 3.8 Live post in Sources.
6. **The OpenAI backup comes after the trial** (25 Nov, recommended in chat). The paper says it takes over by itself, so Levi is told (L4).

## Words used here

- **Gemini 3.8 Live** (`gemini-3.8-live`): Google's talking AI. Generally available since 24 Sep 2026, and supported to 25 Sep 2027 or later (the AI Brain's 24 Nov check).
- **Gemini API:** Google's developer service for Gemini, run from Google AI Studio. The test key works there.
- **Agent Platform:** Google Cloud's business service for Gemini, once called Vertex AI. There you choose the region, like `us-central1` (Iowa, in the US).
- **The relay:** the part of our server that carries sound and messages between the browser and Google.
- **A talk:** one conversation with Gemini, from V to its end. A **connection** to Google lasts about 10 minutes. A talk can go on over several connections, through **resumption**: Google sends a handle (an id), and a new connection with it carries on the same talk.
- **Tool call:** Gemini asking our code to do something, here "ask Contour". The **tool answer** is what our code sends back.
- **The card's ear:** how an open card hears the rep in a conversation (`attachCard` in `bar-session.ts`, PLAN-V24). It uses no AI: "send it" sends, "later" or "cancel" does what Later or Cancel does, and "the second one" or a name from its list picks it (`choose.ts`). Anything else goes to the command step as a change. The research card (PLAN-V27) also hears "yes", to start. In a conversation, a card opens no mic of its own.
- **Barge-in:** the rep talks while the Assistant talks, and the Assistant stops at once.
- **The meter:** our count of the tokens Google reports for each talk (`usageMetadata`), turned into US dollars.

## What exists already (so nothing is built twice)

- **The conversation** (`assistant/voice/bar-session.ts`, PLAN-V22 and PLAN-V24): one V starts it; turns are read in order; "stop listening" and "that's all" end it (`turns.ts`); so do 2 minutes of quiet; and the wake lock and phone rules (`screen.ts`). `last-turn.ts` keeps the last company and person.
- **The mic** (`call-notes/mic/session.ts`, `MicSession`): the mic check, echo cancellation, following the headset. The sound tap is `on-device/capture.ts` with `capture.worklet.ts` (pieces of 100 ms, at the device's rate).
- **The engine choice** (`call-notes/mic/voice-engine.ts`): Chrome's speech service, or the model on the device.
- **The command step** (`POST /api/v1/companies/assistant/command`): Claude Haiku (the call notes' model), one small request, 15 s at most, 20 a minute a person. It takes `text`, `source`, `on_page`, `card` and `last_turn`. Then `handOver` (`assistant/voice/hand-over.ts`) sends its answer to a page or to the review card.
- **The card's ear** (`attachCard`, PLAN-V24 T2-3): in a conversation, an open card hears each turn through the conversation's one mic. Outside one, it listens 5 seconds for "send it" or "cancel" (`card/listen.ts`). The card's Send has its idempotency key (`Card-Key`): a repeated send sends nothing again.
- **Research by voice** (PLAN-V27 T4-1, T4-2): "Research Northwind" is the command step's `research` action. A lead card from the last 30 days opens at once, and so does a HubSpot company's call prep if the company isn't quiet, each with its line. A new or quiet company, or a maybe, opens the research card. It asks once, with the cost, and "yes" starts a paid research. With no name, the bar asks for one.
- **The names** (`GET /api/v1/companies/assistant/names`, `assistant_names.hint_list`, PLAN-V23): up to 50 names this person is likely to say (`name_hints_max`).
- **Safety patterns:** `BROWSER_SPEECH_OK`, so a voice goes to Google only with Levi's OK; the sign-in guard already covers WebSockets and closes a refused one with 1008 before it opens (`core/api/guard.py`); the host check (`core/api/security.py`); and the sign-in cookie is `SameSite=Strict`.
- **The tests' fakes:** `fake-mic.ts` and `on-device/fake-worker.ts`.
- **Live:** App Platform in Sydney (`syd`), with one backend copy (1 vCPU, 2 GB).
- **Already installed:** `websockets` 17.3, which comes with `uvicorn[standard]`. No new package is needed.

## Choices made for you

Each has its reason. Change any of them before its step starts.

**How it's built**

1. **Our server relays the sound,** not the browser straight to Google with a short-lived token. Why: Google says the Live API is server-to-server; the key never leaves our server; the meter is exact, so the monthly limit holds; and the same code works on both Google services (A2). It adds a short hop inside Australia (TBC: about 10 to 30 ms).
2. **The tests run on the Gemini API, with the test key.** It works today. The Agent Platform needs its API turned on first (A2). The service is one setting (`LIVE_VOICE_SERVICE`): only the address, how the key is sent and the model's name differ (TBC for the Agent Platform's sign-in: S1).
3. **A plain WebSocket to Google, with no Google package.** `websockets` is already installed, and the setup's field names were checked on 25 Nov. A package would need a security check, and packages lag behind new fields.
4. **`gemini-3.8-live`, locked by name.** Not "3.8 Live Extended Thinking": it thinks longer before it talks, it's a preview on the Agent Platform, and Claude does the thinking.
5. **The browser runs the tool with today's code.** The relay only carries messages. Why: a spoken command and a typed one give the same card, and the card (with the rep's own edits) lives in the browser.

**The conversation**

6. **One tool, `ask_contour(request)`.** Set as non-blocking (`behavior: NON_BLOCKING`), so Gemini can say "One moment" while Claude works. Its answer is spoken once the rep is quiet (`scheduling: WHEN_IDLE`). Google's advice: a tool answer always has `status`, `retryable` and `message`, and is never empty.
7. **"Send it", and the research card's "yes", come from the rep's words, never from Gemini's guess.** One sends to HubSpot; the other starts a paid research. Live voice runs as the bar's conversation, so an open card hears Google's transcript of what the rep said through its ear (`attachCard`), and opens no mic of its own. A tool call alone never sends or starts a research. Gemini says "Sent" only when the card's Send has worked. So in live voice, a quick log (PLAN-V25 T3-3: "No answer, Jo Sample"), which sends itself after its 5-second hold, opens its card instead and waits for "send it" (TBC at T5-2 with Al-khair).
8. **What Claude gets:** Gemini's `request` (the rep's words, as Gemini heard them) as `text`, with `source` `mic`, as the free mic sends it. T5-2 compares it with Google's transcript for names and dates, and keeps the better one (TBC).
9. **Asking back:** Claude's unsure line (PLAN-V25) is the question Gemini asks, like "Jo Sample or Jo Northwind?". Gemini doesn't ask its own questions about companies or people.
10. **Short talk, and the instruction in Google's order:** who it is (Contour's Assistant, a helpful colleague); how it talks (one or two short sentences, no lists, never the whole card read out, no made-up names or dates); when to use the tool (anything about calls, tasks, emails, companies, people, meetings or pages, in the rep's words); and its limits ("sent" only when the tool says so; at most two tool calls in a row without speaking, as Google advises; talk not meant for it is ignored).

**Sound**

11. **In:** 16-bit sound at 16 kHz, mono, in 20 ms pieces (Google: 20 to 40 ms, never a second at a time). **Out:** 16-bit at 24 kHz. Between the browser and our server, sound goes as raw bytes (binary frames), not as text, which makes it a third smaller.
12. **Turn-taking:** Google's own voice detection. Start and end sensitivity low, 300 ms kept from before the speech, and 1.2 s of silence ends a turn (PLAN-V24's pause; TBC at T5-3). Barge-in is on (`START_OF_ACTIVITY_INTERRUPTS`). Silence isn't part of a turn (`TURN_INCLUDES_ONLY_ACTIVITY`). In live voice, Google decides the turns, so holding V works as a tap (TBC after T5-2).
13. **A silence gate in the browser:** sound goes to Google only while someone talks, with 0.5 s from before and 1.5 s after (TBC). Then the browser says "pause" (`audioStreamEnd`). Why: Google bills listening by the minute, and each new turn bills the earlier talk again, so silence would cost twice.
14. **Echo:** the mic opens with echo cancellation, noise suppression and automatic gain, as today. Gemini 3.8 answers only when it's spoken to (proactive audio, on by itself), so a colleague talking nearby doesn't set it off. T5-2 tests laptop speakers.
15. **Long talks:** resumption is on. The handle is kept on our server, in the talk's row, never in the browser. At Google's warning (`goAway`, 60 s before a connection ends) the relay moves to a new connection. Context compression starts at 10,000 tokens and cuts back to 4,000 (TBC), so long talks stay cheap and far from the 128,000-token limit. Without it, a talk stops after about 15 minutes.

**Who, and how much**

16. **A switch on each person: "Live voice (paid by the minute)".** Off for everyone, set only by the Platform admin, in Edit person. The person also needs the Call logs or Meetings tick, as V does today.
17. **A server switch, `LIVE_VOICE_OK`,** off until Levi's OK, like `BROWSER_SPEECH_OK`. With it off, or with no key, live voice is off for everyone.
18. **A monthly limit** on the Settings page (Platform admin): US$4 to start (TBC), under a ceiling in `.env`, `HARD_LIVE_VOICE_MONTH_CAP_USD` (US$5 while the test key is in use). It's checked when a talk starts and as it goes. Google's budgets only send emails; they don't stop spending (TBC for AI Studio). So our limit is what stops it.
19. **The meter, with prices in one file:** audio in US$3 a million tokens, audio out US$12 a million. At 25 tokens a second, that's about US$0.005 a minute listening and US$0.018 talking. Text prices are TBC (S1). Google's bill is the truth: the meter is an estimate.
20. **Limits:** one talk per person (a new V on another tab ends the old one); at most 10 talks at once on the server (TBC); 30 minutes a talk (TBC); and the quiet stop after 2 minutes, as today.

**Privacy**

21. **Contour keeps no sound and no words,** in the database or in logs. A talk's row holds counts only.
22. **The name list goes to Google only with Levi's OK** (`LIVE_VOICE_NAMES_OK`, off, L2). With it on, up to 50 names go as transcript hints (`customVocabulary`), and the top 20 go in the instruction. Names are cleaned first (letters, digits, spaces and `& ' - .` only, 60 characters at most) and marked as data, not instructions: a lead's name can come from a web page. With it off, our code still fixes a misheard name, as today.
23. **Google keeps a talk's state for resumption,** for up to 24 hours on the Agent Platform (Gemini API: TBC). It doesn't train on paid use. Levi is told (L2).
24. **The voice:** "Kore" to start, one of Google's 30; Al-khair picks at T5-2. No `languageCode`, because `en-AU` isn't on Google's list and the model follows the rep's English. The transcript gets the hint `en-AU` (accepted on 25 Nov).

**Fallbacks**

25. **The free mic or typing takes over by itself** when Google is down, a start is refused, the limit is reached, or the browser is offline. One line says why, and words already heard are kept.
26. **No OpenAI code here** (decision 6).

## Words on screen

- **The pill:** "Connecting", "Listening", "Working it out", "Speaking", "Reconnecting" and "Muted". Captions show the rep's words as Google hears them, then the Assistant's words as it talks.
- **Fallback lines:** "Live voice is off for now: this month's limit is reached. Using the free mic.", "Live voice can't reach Google. Using the free mic." and "Live voice stopped: the connection dropped. Using the free mic."
- **Edit person:** "Live voice (paid by the minute)".
- **Settings:** "Live voice: monthly limit (US$)". **Admin settings:** "Live voice this month: 42 minutes, about US$0.51 of US$4.00."

## What it costs

- **To build:** time only. The build uses a fake Google, for free.
- **To test, on the US$5 key:** S1's try about US$0.01, and T5-2's 20 practice requests about US$1 (TBC). The meter stops at US$4. Claude for T5-2's command step: about US$0.40 (40 requests at up to US$0.01, the notes' cap).
- **To run:** about US$0.66 an hour of use (the paper: 60 minutes listening and 20 talking, a floor). The silence gate and compression keep it near that. T5-2 and the trial measure the real rate.
- **New packages:** none.

## Who builds it

One session builds every step, in order: S0, then Parts 1 to 5. The parts share the relay's messages and the bar, so two sessions would wait on each other.

- **Backend steps:** `backend-agent`, with the `api-change` and `db-migration` skills.
- **Website steps:** `frontend-agent`, with the `ui-build` and `design-review` skills.
- **Cross-layer checks:** the `flow-trace` skill on a whole talk (V, sound, tool, card, send, end), and the `security-check` skill on the relay (the key, the new data flow to Google, the WebSocket's sign-in and `Origin`, and the logs).
- **One migration,** `0030_v28_live_voice`: `master`'s newest is `0029_v26_activity`, and PLAN-V27 added none (checked 25 Nov).
- **M1's independent check:** a fresh `review-agent` with the `merge-check` skill, and the `simulator-agent` with the fake Google.

## How to work this plan

As [PLAN-V24](PLAN-V24.md)'s "How to work this plan", with these changes:

- **The copy:** `plan-v28` in `../contour-v28`, made on 25 Nov from `master` (`d32ff3f`). S0 merges `master` in, now that PLAN-V27 has joined it.
- **Ports and database:** backend `API_PORT=8151`, website 5321 (TBC: check they're free), database `leadfinder_v28` (a copy of the dev database at `master`'s newest migration), test suffix `_v28`. Leave older plans' ports alone (8041 to 8141, 5211 to 5311).
- **The copy's `engine/.env`** holds the `POSTGRES_*` lines (database `leadfinder_v28`) and the test key, `GEMINI_API_KEY`. Never print the key, or put it in a test, a log line, this plan or a commit. Tests use a fake key.
- **No Claude key and no HubSpot key** in the copy. Blank `ANTHROPIC_API_KEY` for the process: it's also a Windows user setting. T5-2 uses Claude, on Al-khair's word.
- **The real Google only in S1 and T5-2,** on Al-khair's word. Everything else uses the fake Google.
- **Made-up names only,** like "Sample Logistics", "Northwind" and "Jo Sample", in tests, this plan and T5-2's practice requests. No real client's name is said or sent to Google before Levi's OK. Check any new example name against our copy, with a count only, before a commit.

## Before the build starts

- [x] **S0. The branch and the copy** (PLAN-V27 joined `master` on 25 Nov, so it can run). Done 25 Nov (`e18b253`). The plan list's line moves to M4, as PLAN-V27's did: the list's move to `AGENTS.md` is still uncommitted in the main folder.
  - `plan-v28` was made on 25 Nov; its first commit holds this plan. Merge `master` in: `git merge master -m "Merge master into plan-v28: PLAN-V27 joins before S0"`.
  - `uv sync --frozen` in `engine/backend`, `npm ci` in `engine/frontend`, and a copy of `COMPANIES.xlsx` from the main folder.
  - Make the database `leadfinder_v28`, and check the newest migration. This plan's migration takes the next number.
  - Add the plan's line to the plan list in `AGENTS.md`. Al-khair's move of the list from `CLAUDE.md` to `AGENTS.md` was still uncommitted in the main folder on 25 Nov: if it still is, ask first.
  - **Done when:** `plan-v28` has PLAN-V27, and the fast backend tests and the website tests pass on it.
- [ ] **S1. Google checks** (Al-khair, about 10 minutes; the try costs about US$0.01, on his word).
  - In Google AI Studio: the key's project is on the paid tier (billing on, so Google doesn't train on it). Set spend emails at US$3 and US$4 if it offers them (TBC). Find out whether the US$5 is a prepaid credit or a budget.
  - Run the free setup check again, with the final setup (the 25 Nov check is in the Log).
  - One 30-second talk with the real model, to learn four things: are `usageMetadata` counts per turn or running totals; the text token prices; do the transcripts mark when they're finished; and which comes first, the finished transcript or the tool call.
  - Only if A2 picks the Agent Platform: turn its API on in the key's project, and run the free setup check there (TBC: whether it takes this kind of key, or needs a service account).
  - **Done when:** the Log has the answers, and the prices file and the meter match them.
- [ ] **S2. Levi's OKs** (TBC with Levi), before M2 but not before the build: the paper's four boxes, plus L2 to L4 ("Waiting on").
  - **Done when:** the Log has his answers.

## Part 1: the server side

- [x] **T1-1. Settings and the switches.** Done 25 Nov (`52c3f05`; the screens come with Part 2). (`core/config.py`, the settings list, `core/auth/models.py`, `core/api/people.py`, `MeOut` in `core/api/auth.py`, Edit person.) Choices 16 to 18.
  - `.env`: `GEMINI_API_KEY` (a secret), `LIVE_VOICE_OK` and `LIVE_VOICE_NAMES_OK` (exact `true` or `false`, off), `LIVE_VOICE_MODEL` (`gemini-3.8-live`), `LIVE_VOICE_SERVICE` (`gemini_api`, or `agent_platform` with `LIVE_VOICE_PROJECT` and `LIVE_VOICE_LOCATION`), and `HARD_LIVE_VOICE_MONTH_CAP_USD` (5).
  - The Settings page: `live_voice_month_cap_usd` (4, up to the ceiling).
  - Each person: `live_voice` (off), set only by the Platform admin. `MeOut` (`GET /api/v1/auth/me`) gains `live_voice`: true only when the person's switch, `LIVE_VOICE_OK` and the key are all on.
  - **Done when:** tests pass: a stray "1" doesn't turn a switch on; the limit can't go over its ceiling; only the Platform admin can set a person's switch (others get 403); an Admin without the switch reads `live_voice` false. The contract and the website's types are made again.
- [x] **T1-2. A talk's row, and its start.** Done 25 Nov (`42467d4`). (New: `apps/companies/live_voice/` with `models.py` and `api.py`; the migration.) Choices 16, 18 and 20.
  - The table `voice_sessions`: who; when it started and ended; its status (`ready`, `open`, `dropped`, `ended`) and why it ended; the service and model; the resume handle (cleared at the end); tokens in and out by kind; seconds of listening and talking; tool calls; reconnects; and the estimated US$. No sound and no words.
  - The same migration adds the person's `live_voice` column.
  - `POST /api/v1/companies/assistant/voice/session` checks, in order: the Call logs or Meetings tick (a Viewer gets 403 `viewer_read_only`); the person's switch (403 `live_voice_not_allowed`); the server switch and the key (409 `live_voice_off`); the month's limit (429 `live_voice_limit`); and the server's 10 talks (503 `live_voice_busy`). Each refusal has its plain words. It makes a `ready` row and answers with its id, the socket's path and the limits. A `ready` row older than 60 s can't be opened.
  - **Done when:** tests pass for each answer, and a second start for the same person ends the first talk.
- [x] **T1-3. The relay.** Done 25 Nov (`cd496c4`). (New in `live_voice/`: `relay.py`, `google_live.py`, `setup.py`, `messages.py` and the instruction; a fake Google in `tests/`.) Choices 1 to 4, 6, 10 to 12, 22 and 24.
  - **The browser's socket:** `WS /api/v1/companies/assistant/voice/live?session=<id>`. The sign-in guard checks it first. Then only our own site's `Origin` is let in. The row must be this person's, and `ready` (it becomes `open` once, so it can't be opened twice).
  - **Google's connection:** the key goes in a header (`x-goog-api-key`), never in the address. The setup holds: the model; audio replies in the chosen voice; the instruction; the one tool; voice detection (choice 12); both transcripts, with the names (choice 22) and `en-AU`; resumption; and compression.
  - **What it carries:** the browser's sound (raw bytes) to Google (`realtimeInput.audio`, `audio/pcm;rate=16000`); "pause" as `audioStreamEnd`; Google's sound back as raw bytes; and transcripts, `interrupted`, `turnComplete`, tool calls and cancellations as small JSON messages. The browser's tool answers go to Google as `toolResponse`, with the same `id`.
  - **The messages are one list:** pydantic models in `messages.py`, added to the API contract by `engine openapi`, so `npm run types` makes their TypeScript types (`write_openapi` in `core/cli.py`; TBC: how it adds them). No hand-written copy.
  - **A tool call the browser doesn't answer in 20 s** gets the relay's own answer: `status` `timeout`, `retryable` false, "That took too long. Try again." (TBC).
  - **It ends cleanly** on Stop, when the browser leaves, or when Google closes. Then it writes the row.
  - **Done when:** tests with the fake Google pass: the setup has every field; sound goes both ways unchanged; a tool call reaches the browser and its answer reaches Google with the same id; a cancel reaches the browser; a wrong `Origin`, another person's row and a reused row are refused; and the key is in no log line and no message to the browser.
- [x] **T1-4. Long talks and drops.** Choice 15. Done 25 Nov (`5227959`).
  - Each `sessionResumptionUpdate` with `resumable` true saves its handle in the row.
  - **At `goAway`:** the relay opens a new connection with the handle. It moves over at a quiet moment (no one talking), or at once when 10 s are left. Target: the rep hears no gap (TBC: under 1 s).
  - **Google drops by surprise:** resume with the handle, up to 2 tries in 10 s. After that, the talk ends: "the connection dropped".
  - **Our backend restarts** (a deploy): the browser reconnects with the talk's id within 30 s. A `dropped` row, or an `open` one no relay holds, opens again for its owner, and the relay resumes from the handle.
  - Pings every 20 s on both sockets, so nothing quiet gets closed.
  - **Done when:** tests pass: a `goAway` mid-talk moves to a new connection with the last handle, and no sound is lost; two drops in a row still resume; and a third ends the talk with its line.
- [x] **T1-5. The meter and the limit.** Done 25 Nov (`3d86140`; the Admin line's screen comes with Part 2). (`live_voice/meter.py` and `pricing.py`, and the Admin settings line.) Choices 18, 19 and 21.
  - Each `usageMetadata` adds to the row's counts, per turn or as running totals (as S1 found). The row is written every 30 s and at the end.
  - The month's total is checked at the start and after each count. At the limit, Gemini finishes its sentence, then the talk ends with "this month's limit is reached", and the free mic takes over.
  - The Admin settings line (Platform admin): "Live voice this month: 42 minutes, about US$0.51 of US$4.00."
  - Log lines hold counts, seconds, US$ and why a talk ended. Never words, names or sound.
  - **Done when:** tests pass: a talk that crosses the limit ends with its line; a start over the limit gets 429; the month adds up every row in it (Melbourne months, TBC); and nothing in the logs or the row is a word.
- [x] **T1-6. Part 1 check.** Done 25 Nov (`ec4f9c9`). Backend: ruff, mypy, the fast tests and the Companies tests. The contract and the types. The `security-check` skill.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 2: sound in the browser

- [ ] **T2-1. Sound in.** (New in `assistant/voice/live/`: `capture.worklet.ts` and `gate.ts`.) Choices 11, 13 and 14.
  - The mic opens as `MicSession` opens it today: echo cancellation, noise suppression, automatic gain, and the headset.
  - A new worklet turns the device's sound (44.1 or 48 kHz) into 16 kHz, 16-bit pieces of 20 ms. A filter first stops high sounds folding into speech.
  - The silence gate (choice 13). Its threshold follows the room's noise.
  - **Done when:** tests pass: a 1 kHz tone at 48 kHz comes out at 1 kHz at 16 kHz; each 20 ms piece is 640 bytes; speech after a silence keeps its 0.5 s from before; and 2 s of silence send one "pause".
- [ ] **T2-2. Sound out.** (New: `live/playback.worklet.ts` and `player.ts`.) Choices 11 and 12.
  - Plays Gemini's 24 kHz sound through a small buffer, at the device's rate.
  - On `interrupted`, it stops at once and empties the buffer (barge-in). When the gate hears the rep start, the Assistant's voice drops to a third straight away, then stops on `interrupted`, or comes back if Google talks on (TBC at T5-2).
  - It says when it's speaking, for the pill. On an iPhone, sound may start only after a tap, so the mic button's tap starts it (Safari's rule).
  - **Done when:** tests pass: sound plays in order; `interrupted` empties it within one 20 ms piece; and "speaking" ends when the buffer is empty.
- [ ] **T2-3. The engine choice.** (`call-notes/mic/voice-engine.ts`, `assistant/voice/bar-session.ts`, `vite.config.ts`, the content policy.) Choices 16 and 25.
  - A new engine, `live`, comes first when `MeOut.live_voice` is true and the browser has an AudioWorklet and WebSockets. Otherwise today's choice, unchanged.
  - A refused start (T1-2's answers) or a failed connection falls back at once (Part 4).
  - The dev proxy for `/api` gets `ws: true`. The content policy's `connect-src 'self'` must let Safari open the socket (TBC: some Safari versions didn't count `wss:` as `'self'`; if so, the live address goes in `index.html` and `deploy/Caddyfile`, and `csp.test.ts` follows).
  - **Done when:** tests pass for each browser in `voice-engine.test.ts`, with and without `live_voice`, and today's choices are unchanged without it.
- [ ] **T2-4. The pill and the captions.** (`assistant/voice/pill.tsx`, `live/`.) "Words on screen".
  - The states: Connecting, Listening, Working it out (a tool call), Speaking, Reconnecting and Muted. Captions as in "Words on screen". They help in a loud room, and anyone who can't hear well.
  - Stop (V or Esc) and Mute, as today. The pill's state is read out politely to screen readers.
  - **Done when:** tests at 1440 and 390 px pass, the `design-review` skill passes, and Al-khair has looked.
- [ ] **T2-5. Part 2 check.** Website: lint, types, tests, build, and `node scripts/bundle-report.js`. The first visit stays the same size, within 1 kB: the live code loads with the bar, late.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 3: the link to Claude and the card

- [ ] **T3-1. "Ask Contour".** (New: `live/bridge.ts`, using `hand-over.ts` and the command step.) Choices 5 to 10.
  - **A tool call while a card is open:** the card's ear (`attachCard`) reads the rep's words first (Google's finished transcript since the last tool call): "send it", "later", "cancel", a pick from its list, or "yes" on the research card. If the tool call comes before the finished words, it waits up to 0.5 s for them (TBC at S1).
  - **Anything else, or no card:** the command step, with `text` (choice 8), `source` `mic`, `on_page`, `card` and `last_turn` (kept as `last-turn.ts` keeps it), as the free mic sends them. Its answer goes to `handOver`, as today: a page opens, the card opens, or a line shows.
  - **The tool answer to Gemini:** `status`, `retryable` and `message`, the line to say. A card opened: "Ready. Say send it." Unsure: Claude's question. A research: the page's line (`handOver`'s `tell`), the research card's question with its cost, or the bar's line asking for a name. Unknown: the read-back, short. An error (409, 429, 503): its plain words.
  - **Done when:** tests with a fake relay pass for each kind of answer; the same command typed and spoken opens the same card; and in live voice, neither card opens a mic of its own.
- [ ] **T3-2. "Send it", and the research card's "yes".** Choice 7.
  - Only the card's own Send, and only when the rep's words were a send word (the card's ear), or the rep pressed Enter or clicked Send. The research card starts the same way: on the rep's own "yes", Enter or a click. A quick log never sends itself in live voice: its card opens.
  - The tool answer says "sent" only after the card's Send has worked. Otherwise it gives the card's own error line.
  - One send per card (`Card-Key`), however many times "send it" is heard.
  - **Done when:** tests pass: a tool call with no send word sends nothing; "send it" sends once; a "yes" only in Gemini's request starts no research; a quick log from a tool call sends nothing until "send it"; a failed send is said as failed; and the `flow-trace` skill passes on this path.
- [ ] **T3-3. Asking back and talking over.** Choice 9.
  - Claude's unsure line becomes Gemini's question. The rep's answer ("the first one", "Jo Sample") goes to the card's ear.
  - A tool call Google cancels (the rep talked over it) stops its command request (`AbortController`). A late answer never opens a second card.
  - **Done when:** tests pass for both.
- [ ] **T3-4. How a talk ends.** As with the free mic (`bar-session.ts`): "stop listening" and "that's all" (`endsConversation`, on the transcript); 2 minutes of quiet; a phone leaving the page; V or Stop; and Esc. The wake lock works as today.
  - **Done when:** tests pass for each end, and each one closes Google's connection and writes the row.
- [ ] **T3-5. Part 3 check.** As T2-5, plus the `flow-trace` skill on a whole talk.
  - **Done when:** all pass, and the numbers are in the Log.

## Part 4: fallbacks

- [ ] **T4-1. The free mic takes over.** (`live/`, `bar-session.ts`.) Choice 25.
  - Google is down, the start is refused, the limit is reached, the browser is offline, or 2 reconnects failed. Then the free engine (as `voice-engine.ts` picks without live) or typing takes over by itself, with the line saying why. Words already heard go to the text line, so none is lost.
  - **Done when:** tests pass for each cause, each with its line. The next V tries live again, except at the limit, until the month changes.
- [ ] **T4-2. The paper's backup, for Levi.** No OpenAI code (choice 26). Levi gets one line (L4).
  - **Done when:** the Log has his answer.

## Part 5: real tests and tuning

- [ ] **T5-1. The practice set** (free). `plan/TEST-V28.md` lists 20 practice requests and the card each should give: 5 calls with a name clash, 5 tasks with dates ("next Friday", "the 3rd"), 3 emails, 3 changes to an open card, 2 "send it", 1 page ("open Northwind"), and 1 research that stops at the research card's question ("Research Sample Logistics", then "cancel", so nothing is spent). Made-up companies and people only, added to `leadfinder_v28`.
  - **Done when:** the set is written, and its companies and people are in the copy's database.
- [ ] **T5-2. The 20 requests, for real** (paid, on Al-khair's word: about US$1 of Gemini, TBC, and about US$0.40 of Claude; the meter stops at US$4).
  - On the laptop: Edge and Chrome, once on the laptop's speakers and once with a headset. On a phone: Safari on an iPhone, or Chrome on Android.
  - Count: names right; fields and dates right; time to the first sound (target 1.5 s, TBC); time to the card (target 4 s, TBC); US$ a request; barge-in; no self-interrupt on speakers; and Gemini's `request` against the transcript, for names.
  - **Done when:** the Log has the numbers. If names or dates are wrong in more than 2 of 20 (TBC), stop and report back (the paper's step 4).
- [ ] **T5-3. Tune.** From T5-2's numbers: voice detection, the gate, compression, the instruction, choice 8 and the voice.
  - **Done when:** the new numbers are in "Choices made for you" and the Log, and the requests that failed pass on a second try.

## Merge, checks and going live

- [ ] **M1. Merge** (`merge v28`, on Al-khair's word). Full checks, the `merge-check` skill, a fresh `review-agent`, the `simulator-agent` with the fake Google, and the `security-check` skill. Then `git merge --ff-only plan-v28` in the main folder.
- [ ] **M2. Deploy** (`deploy v28`), after S2 and A2.
  - A new key for live, not the test key (it was pasted in chat), held by App Platform as an encrypted secret. `LIVE_VOICE_OK=true`, and `LIVE_VOICE_SERVICE` as A2 says.
  - Check that App Platform lets the WebSocket through to the backend, and that a 15-minute talk lasts (TBC).
  - The person switch on for Levi and Al-khair only. The month limit as A4 says.
- [ ] **M3. The trial:** two weeks, on Levi's laptop and phone. Al-khair reads the meter each week. At the end, Levi and Al-khair set the team's limit from real use (the paper's step 6).
- [ ] **M4. The docs.** The plan list, `engine/AGENTS.md`, `engine/DESIGN.md` (the pill's states and the captions), the AI Brain, and a short team note written with `/plain`, sent on Al-khair's word.

## Waiting on

- **Al-khair:**
  - **A1.** Approve this plan, or change it (`implement v28`).
  - **A2.** Where live runs. Recommended: the **Agent Platform** in `us-central1`, so the voice stays in the US, as the paper says. It needs its API turned on in the key's project. Or the **Gemini API**: it works today, but Google doesn't fix the region. One setting either way.
  - **A3.** The paid checks: S1's try (about US$0.01) and T5-2 (about US$1.40 with Claude).
  - **A4.** The month limit for the trial on live: US$20 suggested (TBC). The paper's email suggested US$50.
- **Levi** (S2):
  - **L1.** The paper's four boxes.
  - **L2.** Names to Google: may the name list (up to 50 company and people names) go to Google as hints? And he's told that Google keeps a talk's state for up to 24 hours, for resumption, not for training.
  - **L3.** Where the voice is processed (A2). With the Gemini API, the paper's "US or Europe" line changes.
  - **L4.** The OpenAI backup comes after the trial, not with it. The paper's page 2 says it takes over by itself.

## Risks

- **Cost.** Listening is billed by the minute, and each turn bills the earlier talk again. The gate, compression, `TURN_INCLUDES_ONLY_ACTIVITY` and the limit hold it. T5-2 measures it.
- **Echo.** On laptop speakers, the Assistant could hear itself and stop. Echo cancellation and proactive audio reduce it. T5-2 tests it, and a "use a headset" line is the fallback.
- **Tool calls are weaker with sound.** Google says sound in and out "negatively impact" function calling. So: one tool, clear rules, and T5-2 counts the misses. Typing always works.
- **Distance.** On the Agent Platform the model runs in the US (`us-central1`); on the Gemini API, Google picks where. T5-2 measures the time to the first sound from Australia.
- **Changes at Google.** The model is locked by name, the fields were checked on 25 Nov, and the fake Google tests our side. Fields that pages disagree on (like how long a handle lasts) are checked in S1.
- **Our server holds long connections:** one backend copy, with 2 GB. At most 10 talks at once, each about 0.1 MB a second at most (TBC).
- **A wrong send.** Only the card's Send, only on the rep's own send words or Enter, and once per card.

## Not in this plan

- The OpenAI backup (after the trial, L4).
- Gemini writing the card by itself, without Claude. Only if T5-2 shows the Claude step is too slow, and a later test shows Gemini alone is as exact.
- Live voice in the Log call panel's own mic (dictation). It keeps today's engines (TBC).
- Hold V as one held turn in live voice (choice 12).
- Other languages, video, and phone lines.
- Keeping any recording.

## Log

- 25 Nov 2026: drafted from Al-khair's chat, on `plan-v28` in `../contour-v28`, made from `master` (`d32ff3f`) while PLAN-V27 merges. The test key is in the copy's `engine/.env` (git ignores it), not here. Not in the plan list yet: S0 adds it, so PLAN-V27's merge isn't disturbed.
- 25 Nov 2026, free checks with the test key (no sound and no text sent, so no model turn and nothing to bill; TBC on AI Studio's usage page):
  - **Agent Platform, `us-central1`:** the Live connection read the key, then closed (1008): its API is off in the key's project. Its model lookup over REST refuses API keys (it wants a sign-in token).
  - **Gemini API:** the model list has `models/gemini-3.8-live`, and also `gemini-3.8-live-extended-thinking` and `gemini-3.5-transcribe-live`.
  - **Gemini API Live setup** with `models/gemini-3.8-live`: accepted (`setupComplete`) with audio replies in the voice "Kore", an instruction, one `NON_BLOCKING` tool, automatic voice detection (low, low, 300 ms, 800 ms), both transcripts, resumption, and compression (10,000 to 4,000). Also accepted: `customVocabulary`, `languageCodes` `en-AU`, `activityHandling` and `turnCoverage`. Google sent a resume handle (`sessionResumptionUpdate`, `resumable` true) right after the setup.
- 25 Nov 2026, later: PLAN-V27 joined `master` (`b52190b`, pushed). This plan was checked against it:
  - **Unchanged:** the command step's input (`text`, `source`, `on_page`, `card`, `last_turn`), `voice-engine.ts` and `bar-session.ts`. `handOver` gains research and two optional tools; T3-1 uses `tell` for the line to say.
  - **New in PLAN-V27:** research by voice, and the research card's "yes". Added to "What exists already", choice 7, T3-1, T3-2 and T5-1.
  - **Corrected:** in a conversation, the card's ear is `attachCard`, not `listen.ts`, and a card opens no mic of its own.
  - **Migration:** the newest is `0029_v26_activity`, so this plan's is `0030`.
  - **The test key** is still only in the copy's `engine/.env`: no commit, no file git could commit, and no AI Brain note holds it.
- 25 Nov 2026: S0 done. `master` (PLAN-V27) merged in (`e18b253`). `leadfinder_v28` was copied from the dev database and migrated to `0029_v26_activity`. Before any change: 3,738 fast backend tests passed (28 skipped), and 3,263 website tests passed. The laptop's copy of HubSpot contacts is empty, so T5-1 adds its made-up people itself.
- 25 Nov 2026: Part 1 done, in 6 commits (`52c3f05` to `ec4f9c9`), with the migration `0030_v28_live_voice` and `SCHEMA-0030.md`.
  - **Checks:** ruff, mypy and the contract pass. The fast tests: 3,840 passed (28 skipped). The Companies tests, run again after T1-6: 882 passed, none failed or skipped (12 minutes). The core tests T1-1 touches: 682 passed.
  - **Security check:** no blocker. Its two findings are fixed, each with a test that fails without it: emails and phone numbers are blanked in tool answers to Google, and `websockets` is pinned at 17.3 (no new package).
  - **Added beyond the plan:** 10 starts a minute a person (429 `too_many_starts`); 10 JSON messages a second from the browser; 3 tool calls waiting at once; 3 s of the rep's sound kept while reconnecting; the Origin check before the sign-in guard as well as in the route; and a row write lands only while its relay still holds the talk.
  - **For M2:** the month limit's field goes up to US$5, the default ceiling. A4's US$20 needs both raised then.
  - **For Levi (L2):** with live voice on, names still reach Google inside a talk (the rep's words, and Claude's questions like "Jo Sample or Jo Northwind?"). `LIVE_VOICE_NAMES_OK` only gates the hint list.
  - **TBC, for S1:** the Agent Platform's key header; `customVocabulary` as a list of words; `scheduling` inside `response`; usage counts per message or running totals (`LIVE_VOICE_USAGE_TOTALS`, off); text prices (the audio prices until then); and whether a resumed setup may carry new names.
  - **Found while checking it:** a quick log (PLAN-V25 T3-3) sends itself after its 5-second hold. In live voice, the command step reads Gemini's request, so a quick log would send on Gemini's words. Choice 7 and T3-2 now say its card opens instead (TBC at T5-2 with Al-khair).
