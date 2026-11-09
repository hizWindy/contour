# Call prep

Last updated: 2026-11-09. **TBC** means to be confirmed.

**Status (9 Nov):** built and tested on the branch `plan-v10` ([PLAN-V10](../../plan/PLAN-V10.md)), not merged or switched on yet. What works now, from our HubSpot copy: the Companies page, the company panel, the prep box, "Sync with HubSpot", and the prep card with a sales script and guided questions (free, written from the copy). Call prep's web check (news, "still there?") stays off until Al-khair switches it on. People and call history wait for HubSpot access to contacts. The questions for Levi are in [EMAIL.md](EMAIL.md).

Call prep tells a salesperson what they need to know before they ring someone. They type a person or a company, and get a short call script. It is the second project after the Lead Finder (Levi, 2 Nov meeting).

Sources: the 2 Nov and 5 Nov meeting notes in `minutes of meeting/`.

## Why

Today a salesperson googles "Jason Reeds Vitera LinkedIn" to check the person is still there. Then they open HubSpot to read the last call notes. That takes about 5 minutes per call (Levi, 2 Nov). Call prep should take seconds.

## What it answers

Levi's preset questions (2 Nov). He said more can be added later.

1. Is the person still at the company, in the same role?
2. What was the last call or conversation with them? From the HubSpot call notes.
3. Any recent news or announcements about them or the company?
4. Any links to Contour's current customers? Levi sends the customer list.

We add a short call script, written by Claude from the facts. This is our proposal. On 2 Nov Levi asked for preset questions, not a full script (**TBC** with him).

1. **Opener:** what to say first, from the last call and the news.
2. **Why now:** the reason for this call, like a $40M contract or a lease ending in 16 months.
3. **Questions to ask,** made from the facts, never generic. Example: a lease ending in 16 months gives "Renew or move?".
4. **If they say:** answers to likely pushback, like "We're not ready yet".
5. **Goal of the call:** the next step to ask for, like a site visit.

The company's full information is not in the script. It is on the company panel (see "How it looks").

## Decisions (8 Nov, Al-khair and Claude)

- **It is for calls, not meetings.** Levi only spoke about phone calls ("the person they're about to ring", 2 Nov; "when we're ringing a company", 5 Nov). The meeting-based idea was Meeting prep, on hold since 23 Oct. The same card can serve meetings later.
- **Its own feature, not part of the Lead Finder.** The Lead Finder is for Levi, Marcus and one other person (5 Nov). Call prep is for the whole sales and BD team.
- **It lives on a new Companies page** in the sidebar. The page lists every company: the HubSpot copy (13,913 companies) plus the researched leads.
- **The prep box and the list search are separate.** The prep box answers "who am I calling?". The list search only filters the list.
- **A company and a call prep are different things** (9 Nov, Al-khair). Clicking a company shows what we know about the client, in a side panel like a lead on the Results page. Prep is a call script for one person, in a modal over the page. A clickable prototype with made-up data: https://claude.ai/artifact/XLy7eG12m19r3Ne8uK5MTC (private).
- **The name** is "Call prep" for now. Not "Company hub": that name is taken by announcements and onboarding. Confirm the names with Levi (**TBC**).

## How it looks

Top of the Companies page:

```
Companies
┌ ⚡ Prep for a call ──────────────────────────────────┐
│ [ Who are you calling? Person or company... ] [Prep] │
│ Recent: Jason Reeds · BHP · Culture Amp              │
└──────────────────────────────────────────────────────┘

[🔍 Filter companies...]  City ▾  Owner ▾  Has deal ▾
Company        City       Owner    Last talk
Vitera         Adelaide   Marcus   12 Sep
```

**Clicking a row** opens the company panel from the right, like a lead on the Results page. It answers "what do we know about this client?". (Example data below is made up.)

```
┌ Vitera Defence Systems ────────────────────────────── ✕ ┐
│ Adelaide · Defense & Space · 320 staff                  │
│ [Prep a call]  [Open in HubSpot]  [Open full page]      │
│ Next lease end · Last talk · Deal · Owner               │
│ About · Offices · Deals                                 │
│ People: Jason Reeds, Head of Property    [Prep a call]  │
│ Call history · News and research · Connections         │
│ Lead Finder: only for people with the Lead Finder tick  │
└─────────────────────────────────────────────────────────┘
```

**Prep** opens the prep card in a modal over the page: quick info, then a sales script with guided questions (9 Nov, Al-khair). Close it with ✕, Esc or a click outside.

```
┌ [JR] Jason Reeds ──────────────────────────────────── ✕ ┐
│      Head of Property · Vitera (opens the company)      │
│      Ready from our HubSpot copy.                       │
│ Before you dial                                         │
│ [Still there?] [Last talk 12 Sep] [News] [Connections]  │
│ Sales script                    │ Last time we talked   │
│ 1 Opener: "Hi Jason, it's Tom   │ the call note         │
│   from Contour. We spoke on ... │ Quick facts           │
│ 2 Why now: lease ends Mar 2028  │ [Company info]        │
│ 3 Guided questions (1 of 4)     │                       │
│   [x] Renew, or move?           │                       │
│   [ ] Is Mar 2027 still the plan?                       │
│       If they say "Delayed", ask: what changed?         │
│ 4 If they say: "Not ready yet" -> the answer            │
│ 5 Goal: book a site visit                               │
│ +61 412 555 018 [Copy number]   [Copy script] [Refresh] │
└─────────────────────────────────────────────────────────┘
```

Rules for the screen:

- **"Before you dial" first, in one line.** These are Levi's 4 questions. On a rushed call, that is all they read.
- **Fast, then complete.** The sales script and guided questions are written at once from our HubSpot copy (`playbook.ts`): free, and there even while call prep is off. With call prep on, its web check adds news and "still there?", and its own script fades in when ready (a few seconds; at once for a company searched ahead). The free script's wording is ours, from the prototype and Levi's questions (**TBC** with Levi).
- **Guided questions.** Each says why it is asked, and what to ask next for each likely answer ("If they say 'Move', ask: who is helping you look?"). Tick one as you ask it, and the next one opens. The ticks aren't saved.
- **Sync with HubSpot.** A button on the Companies page copies everything from HubSpot now (about 10 minutes, free), instead of waiting for the 6:00 sync. Its bar fills as it reads, and the list refreshes when it is done.
- **Company only:** if they type just a company, the modal asks "Who are you calling?" and lists its people. "Prep a cold call" gives a script for the switchboard.
- **Recent chips** reopen today's preps without a new search.
- **Phone:** the list is one card per company, and the filters sit behind one "Filters" button. The prep box sticks to the top. The panel and the prep card fill the screen, with the main action as a big button at the bottom: "Prep a call" on the panel, "Call" on the card.

## Proposed, not decided

- **Where the facts come from, in three layers.**
  1. Reuse what the Lead Finder already found. Its notes are saved in the shared memory (`core.memory`) and reused for 30 days, at no cost.
  2. A small prep search on the same engine: one Claude request for news and "still there?". It saves back to memory, so the next prep and the Lead Finder reuse it.
  3. Search ahead each morning, after the 6:00 HubSpot sync, only for companies with an open deal or an approved lead. Keep it under a daily cap, for example US$5 (**TBC**).

  Researching all 13,913 companies ahead would cost about US$700 to 2,100 a round, at US$0.05 to 0.15 each, and the news goes stale.
- **"Still there?" through Signal Hire,** which the engine already uses. It is more reliable than a web search for people, but it costs credits (**TBC**).
- **Only approved leads on the Companies page.** Drops and unreviewed leads stay in the Lead Finder. Their notes still feed layer 1.
- **Save each prep on the company with its date.** A second person in the same week reuses it instead of paying again. Reuse for 7 days (**TBC**).
- **Fetch the last call notes from HubSpot live.** The HubSpot copy is up to a day old (daily sync at 6:00 am).
- **"Prep for a call" button** on each Lead Finder lead, which opens call prep with the company filled in.
- **Call blocks, later.** Tick 10 companies, press "Prep all", then go card by card. Levi said the BD team calls in blocks (2 Nov).
- **Call notes on the same card, later.** A mic button after the call. This is Levi's "cockpit": prep before the call, notes after it (2 Nov).

## What it needs

- **HubSpot read access to contacts and call notes.** Today the key reads only companies, deals, owners, lists and company fields (`engine/backend/core/hubspot/check.py`). The exact scope names are **TBC**.
- **Levi's customer list,** for the connections question (promised 2 Nov).
- **Roles,** so sales sees call prep but not Lead Finder scores. The Lead Finder tick on each account (PLAN-V9 E1) already closes the Lead Finder. Call prep needs a tick of its own.
- **Levi's OK to look up named people** (**TBC**; the same open question as the Lead Finder's decision makers).
- **Moving shared research code** from `engine/backend/apps/lead_finder/` into `engine/backend/core/`, so both features use it. HubSpot, Signal Hire and Claude are already in `core/`.

## Not confirmed yet (TBC)

- The names "Call prep" and "Companies".
- The cost per prep. It should be well under a Lead Finder company (about US$0.34 to US$0.42 each).
- How many days a saved prep is reused.
- Whether Levi wants meetings added later.
- Whether Levi wants a full call script, and whether the team already uses an opener or script that Claude should copy the style of.
