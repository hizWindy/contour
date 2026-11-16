# Call prep

Last updated: 2026-11-16 (PLAN-V18: Call logs, the mic card, History, the quick look, and Meetings' filters and Sync). **TBC** means to be confirmed.

**Status (11 Nov):** PLAN-V10 built call prep, and [PLAN-V14](../../plan/PLAN-V14.md) refined it: "Research again", the three answers in the card's header, news with no age limit, the call technique in both scripts, and editable scripts with Your style and a team style. Both are merged into `master`, not deployed, and call prep is not switched on yet. The new prompt hasn't been tried on real companies (PLAN-V14 T1-5, paid, on Al-khair's word). What works now, from our HubSpot copy: the Companies page, the company's record, the prep box, "Sync with HubSpot", and the prep card with a sales script and guided questions (free, written from the copy). Call prep's web check (news, "still there?") stays off until Al-khair switches it on. People and call history wait for HubSpot access to contacts. The questions for Levi are in [EMAIL.md](EMAIL.md).

**12 Nov:** [PLAN-V15](../../plan/PLAN-V15.md) is merged into `master`, not deployed. The script now knows the relationship (open deal, customer, past customer, lost deal, contacted before, or cold): only a cold call introduces Contour. Each person picks a tone (Friendly by default, Direct, Consultative or Formal), and an Admin sets the team's default. Call prep's errors are in plain words, and two clicks can't start two paid preps. The opener wording for each stage and tone is **TBC** with Levi.

**16 Nov:** [PLAN-V18](../../plan/PLAN-V18.md) is joined into `master`, not deployed. Prep opens straight on the quick look, with a "Calling" row instead of the "Who are you calling?" screen. "Activity" is now **Call logs**, with a History of every call you logged. A mic button opens a mic card that checks the mic in under 2 seconds. Meetings shows everyone's meetings by default, with My meetings, My team and a Sync button, and the pre-read is one centered form that says AI drafts it. The Companies list shows the newest activity first.

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

The company's full information is not in the script. It is in the company's record (see "How it looks").

## Decisions (8 Nov, Al-khair and Claude)

- **Call prep is for calls; a meeting gets its own pre-read** (changed 15 Nov). On 8 Nov call prep was for calls only, because Levi had only spoken about phone calls (2 and 5 Nov). On 12 Nov he asked for a pre-meeting form that replaces the Word pre-read. It is built beside call prep: see "Pre-meeting form" below.
- **Its own feature, not part of the Lead Finder.** The Lead Finder is for Levi, Marcus and one other person (5 Nov). Call prep is for the whole sales and BD team.
- **It lives on a new Companies page** in the sidebar. The page lists every company: the HubSpot copy (13,913 companies) plus the researched leads.
- **The prep box and the list search are separate.** The prep box answers "who am I calling?". The list search only filters the list.
- **A company and a call prep are different things** (9 Nov, Al-khair). Clicking a company shows what we know about the client. Prep is a call script for one person. A clickable prototype of the 9 Nov layout, with made-up data: https://claude.ai/artifact/XLy7eG12m19r3Ne8uK5MTC (private).
- **Where each one opens was swapped** (15 Nov, Al-khair). Call prep is the job done all day, so it gets the narrow side panel on the right and the list stays in view. The company's record, the long read, opens in a dialog in the middle. Levi wants the team to get a quick read and a script without navigating or searching.
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
Company        City       Owner    Last activity
Vitera         Adelaide   Marcus   12 Sep
```

The list shows the newest activity first (PLAN-V18): the newest of HubSpot's "Last activity date" and "Last contacted". Companies with neither go last, A to Z.

**Clicking a row** opens the company's record in a dialog in the middle (768 px). It answers "what do we know about this client?". Its "Prep a call" closes it and opens the prep panel. (Example data below is made up.)

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

**Prep** is on every row and always in view, at the end of the company's name. It opens the prep card in a side panel from the right, 576 px wide, in one column in the order of the call (15 Nov, Al-khair). P does the same for the active row. The list stays usable beside the panel, so Prep on another row switches it. Close it with ✕ or Esc.

```
┌ [JR] Jason Reeds ───────────────────────────── ✕ ┐
│       Head of Property · Vitera (opens it)       │
│ [Still there?] [Last talk 12 Sep] [News]         │
├──────────────────────────────────────────────────┤
│ Quick look                        [Company info] │
│ Owner · Deal · Staff · Lease end · Next meeting  │
│ Calling: Jason Reeds v                           │
│ Last time we talked · 12 Sep · by Tom            │
│   "the call note"                                │
│ Sales script  Made 2 days ago [Research again]   │
│ Tone: warm, they know us                         │
│ 1 Opener: "Hi Jason, it's Tom from Contour.      │
│   We spoke on ..."                               │
│ 2 Why now: lease ends Mar 2028                   │
│ 3 Guided questions (1 of 4)                      │
│   [x] Renew, or move?                            │
│   [ ] Is Mar 2027 still the plan?                │
│       If they say "Delayed", ask: what changed?  │
│ 4 If they say (tap one to see the answer)        │
│   ["Not ready yet" v]  ["Send an email" v]       │
│ 5 Goal: book a site visit                        │
│ Style: Team (2 notes) and yours                  │
├──────────────────────────────────────────────────┤
│ +61 412 555 018 [Copy number]   [Copy script]    │
└──────────────────────────────────────────────────┘
```

Rules for the screen:

- **Little scrolling, top to bottom** (15 Nov). One column in the order of the call. The quick look comes first: the free facts from our HubSpot copy, then the Calling row (PLAN-V18 T3-7). "If they say" shows only the pushbacks, and a tap opens one answer at a time. A question shows its source only while it is being asked. The Style row sits under the script, because it is a setting, not part of the call.
- **The answers first, in the header.** Still there?, Last talk and News sit in one row under the name, and stay put while the script scrolls. These are Levi's questions; Connections waits for his customer list. On a rushed call, that is all they read.
- **"Research again"** (it was Refresh) sits at the top of the script, with what it costs (up to the cap, US$0.25 **TBC**). It makes a new web check and a new script. While call prep is off it is greyed out and says why.
- **News has no age limit.** The newest item shows with its date and age ("14 June 2026, 4 months ago"), so old news never looks fresh. With no web news, the newest saved note shows instead.
- **The call technique** (Al-khair, 11 Nov; **TBC** with Levi): the opener asks for two minutes; questions go from their situation to what fixing it is worth; pushback gets three beats (name the feeling, agree with what is fair, ask one question); a tone line; a feeling only as a question; no pushing twice.
- **Edit the script.** A pencil on each line saves your own wording for this call, seen only by you. It survives "Research again", "Copy script" copies it, and Reset brings back the draft. **Your style** (one note) and the **team style** (up to 8 notes, approved by an Admin) go into the next scripts as wording only, never as facts. Who approves team notes besides Admins is **TBC** with Levi.
- **Fast, then complete.** The sales script and guided questions are written at once from our HubSpot copy (`playbook.ts`): free, and there even while call prep is off. With call prep on, its web check adds news and "still there?", and its own script fades in when ready (a few seconds; at once for a company searched ahead). The free script's wording is ours, from the prototype and Levi's questions (**TBC** with Levi).
- **Guided questions.** Each says why it is asked, and what to ask next for each likely answer ("If they say 'Move', ask: who is helping you look?"). Tick one as you ask it, and the next one opens. The ticks aren't saved.
- **Sync with HubSpot.** A button on the Companies page copies everything from HubSpot now (about 10 minutes, free), instead of waiting for the 6:00 sync. Its bar fills as it reads, and the list refreshes when it is done.
- **Company only:** if they type just a company, or press Prep on a row, the panel opens straight on the quick look (PLAN-V18 T3-7). Its "Calling" row picks the last person we talked to, else the first person on record, else a cold call (the switchboard), and can be changed there. The facts start loading when the pointer rests on Prep, so the panel opens full.
- **Recent chips** reopen today's preps without a new search.
- **Phone:** the list is one card per company, and the filters sit behind one "Filters" button. The prep box sticks to the top. Each company card has its own Prep button. The company's record and the prep card fill the screen, with the main action as a big button at the bottom: "Prep a call" on the company, "Call" on the card.

## Call notes (PLAN-V17, built 15 Nov, not switched on)

After a call, a rep presses **Log call** in the call prep panel (or L), says or types what happened, and moves on. After a block of about 10 calls, they check every note on the **Call logs** page (called Activity until PLAN-V18) and send them to HubSpot in one go. Levi asked for both: log fast and move on (12 Nov), and confirm in one go after about 10 calls (9 Nov). See [PLAN-V17](../../plan/PLAN-V17.md).

**How a note is handled:**
- It is saved at once. A phone number or email in it is saved as "[number left out]" or "[email left out]": we never store contact details.
- **With Claude sorting on,** Claude (Haiku 5.5) turns the note into three things: the call (a two-line summary and the outcome), field changes, and follow-up tasks. It costs well under US$0.001 a note (estimate, not measured yet). Claude gets the note with contact details removed, today's date, the company's office names and the fields a call may change. It gets no company name and no people.
- **With it off,** the note is the call's text. The rep picks the outcome and adds follow-ups by hand. Free.
- **Code works out every date, not Claude.** Example: on Thursday 19 Nov, "next Tuesday" is 24 Nov. A follow-up that falls on a weekend moves to Monday, and a follow-up is never in the past. The card shows the date with the rep's words beside it.
- **A call may change only three things for each office:** the lease end, the last move and the staff count (**TBC** with Levi). Anything else the rep says stays in the call's text. A vague value, like "some time in 2028", is not written to a field: it goes into the call's text with the reason.
- **Nothing reaches HubSpot until the rep sends it.** Each change shows HubSpot's value now and the new one. A confirmed change may replace a value (**TBC** with Levi). If HubSpot's value changed since the rep looked, that change is held and shown again.
- **Where it lands:** the call goes on the company and the person, under the rep. It goes on a deal only when the company has exactly one open deal (**TBC** with Levi).
- **Call prep's "Last talk"** shows the rep's own note that isn't in HubSpot yet.
- **Call logs** has three tabs: To confirm, History and Needs a look. History lists every call you logged, grouped by day, with a search, the outcome and This week or This month (PLAN-V18 T3-6). A row opens in place.
- **The mic** (PLAN-V18 T3-4): a mic button in the note box, on laptops, opens a card that checks the mic in under 2 seconds and says plainly what is wrong (blocked, no mic, silent) and what to do. "Check my mic" is also in Ctrl+K and the account menu. Turning speech into words waits for the voice tool test at the keyboard (T3-3). The browser's speech service would send the voice to Google or Microsoft, so it stays off until Levi says yes.

**Two switches, both off:** "Call notes are on" shows Log call and Call logs. "Claude sorts call notes" waits for Levi's OK, because a rep's note names clients.

**What it waits for:**
- **Sending** needs writing to HubSpot switched on, after one real test call (PLAN-V17 M2). The key can already write calls, tasks, notes and company fields (checked 15 Nov, PLAN-V17 T1-2).
- **Picking the person** on a call needs HubSpot's "read contacts" permission. Until then a call is logged on the company only.

## Pre-meeting form (PLAN-V17 Stage B, built 15 Nov, not switched on)

Before a client meeting, a pre-read is drafted from HubSpot, the rep fills two blanks, and it goes to the Contour team by email. It replaces the Word pre-read (Levi, 12 Nov). See [PLAN-V17](../../plan/PLAN-V17.md).

**How it works:**
- **Where:** Companies, then Meetings. Upcoming is grouped Today, Tomorrow, This week and Later. Each meeting has one status: Needs pre-read, Draft ready or Sent. Past meetings say whether notes are logged. "New pre-read" starts one for a meeting that isn't in HubSpot. Meetings shows everyone's meetings by default, with My meetings and My team, and a Sync button that reads HubSpot's meetings now (PLAN-V18). The pre-read is one centered form, and it says AI drafts it.
- **The facts come from HubSpot, with no AI:** when, Teams or in person, who we meet, the Contour people, staff, offices, the lease end and the deal stage.
- **Claude (Sonnet 5.5) writes three short summaries:** what they do, what we know about the project, and the talks so far. Each is marked "Written by AI". Every sentence must point at a fact, or it is dropped. There is no web search. Contact details are removed first. With names off, the company and its people are hidden from Claude. About US$0.007 a pre-read (3 real pre-reads, PLAN-V17 T2-16), in a few seconds.
- **The rep fills two blanks:** the ideal next step and who is going. AI never fills them, because Levi asked for blanks. Both must be filled before it is sent (**TBC** with Levi).
- **It goes in the email body, to Contour addresses only** (`contourinteriors.com.au`, **TBC**). Any other address stops the whole send.
- **A copy is saved in HubSpot** as a note on the company, and on its open deal. It is not saved on the meeting itself, so it can't reach the client (until a test shows the meeting is safe).
- **Each weekday at 6:40 am,** a job drafts the pre-reads for meetings in the next 2 working days (**TBC**), and emails the rep "Your pre-read for Sample Logistics is ready". It is off until switched on.
- **"Log meeting":** after a meeting, the rep pastes a transcript, or a `.txt` or `.vtt` file. It goes through the call notes sorter and joins the same batch to confirm. In HubSpot it becomes a note on the company (and its one open deal), not a call, with any field changes and follow-ups. A transcript is the client's words, so it can only suggest: nothing is written without the rep's confirm.

**What it waits for:**
- HubSpot meetings in our copy (PLAN-V17 T1-8). The key can already read them (checked 15 Nov).
- A sender address for email, and the link from each account to its HubSpot owner (for "your pre-read is ready").
- Levi's answers: the Word pre-read template, who usually gets it, whether a manager always gets a copy, and whether 2 working days ahead is right.

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
- **Call notes on the same card:** built. Log call came in PLAN-V17 and the mic button in PLAN-V18. This is Levi's "cockpit": prep before the call, notes after it (2 Nov).

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
- For meetings (asked 12 Nov, built as the pre-meeting form): the template, who gets it, and how many days ahead it is drafted.
- Whether Levi wants a full call script, and whether the team already uses an opener or script that Claude should copy the style of.
