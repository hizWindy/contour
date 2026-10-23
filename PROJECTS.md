# Contour AI projects

Source: Levi Young's project list and the follow-up meeting.
Last updated: 2026-10-23. Anything marked **TBC** is not confirmed.

## The projects

| # | Project | Priority | Status |
|---|---|---|---|
| 1 | Trigger events (Company Lead Finder) | **First** (Levi's decision, 2026-10-23 meeting) | Finds companies that fit the criteria and show signs of moving. Weekly email. |
| 2 | Meeting prep | **On hold** (2026-10-23 meeting) | Runs automatically. Brief saved in HubSpot and sent to the internal team. |
| 3 | Deal review | Third (Levi's top 3) | Rates open deals. Needs good HubSpot data. |
| 4 | Customer connections, prospect ranking, market research | Later | Reuse the same research engine |
| 5 | Booking app, calendar tool | Skip | Existing tools already cover them |

Levi highlighted the top three. In the 2026-10-23 meeting, Levi made Trigger events the key priority and put Meeting prep on hold.

## 1. Trigger events (Company Lead Finder)

A company lead generator. Every week it finds companies that fit Contour's criteria and show signs of needing a new office. Levi approves them, they go into HubSpot, and HubSpot sends them to the right salesperson.

Full details: [projects/leads/LEADS.md](projects/leads/LEADS.md).

## 2. Meeting prep

**Flow:** meeting booked → pull company history from HubSpot → research (news, website, people) → write the brief in one fixed template → save it in HubSpot and email the internal team a short version with a link → ask "useful or not?"

**Version 1:** every morning, find tomorrow's meetings. Build a one-page brief for each. Save it as an **internal note on the HubSpot meeting** and on the company. Email the Contour attendees a short summary with a link.

**Brief contents:** who they are, history in HubSpot, recent news, likely needs, questions to ask, a related Contour project, sources.

**Where the brief shows up in HubSpot:**
- Levi wants it in the "meeting panel." Best fit: the meeting's *internal notes* field (**TBC**: exact field name).
- Also add a note on the company and deal, so history stays on the account.
- **Never use the meeting *description* field.** It can go out in the calendar invite and the client could read it.
- Details in [HUBSPOT.md](HUBSPOT.md), section 9.

**Open (TBC):**
- What does Levi mean by "meeting panel": the HubSpot meeting record, the company record, or the Outlook invite?
- Where do meetings live: HubSpot or Outlook? This decides how it starts. If Outlook, meetings only appear in HubSpot when synced (**TBC**).
- Who is "the team": attendees only, or the whole account team?
- Email, Teams, or both? (HubSpot has no built-in Teams action. We would send it from the backend.)
- Contour needs a short project list (name, sector, size, city) for the AI to pick from.
- Which client data may be sent to the AI?
- Saving notes needs HubSpot **write** access. The plan below says read-only. An admin must approve.

## 3. Deal review

Reads every open deal in HubSpot. Simple rules first. Then the AI reads the notes for softer warnings.

**Checks:** no contact for weeks, stuck in one stage, one contact only, no decision maker, no next step, competitor mentioned.

**Output:** a rating (green, amber, red), the main flags and a next step. Shown as a weekly pipeline review.

It needs good HubSpot data, so the data check comes first.

## Draft flow (for the client)

Draft. Plain words, for Levi's team. Both run on a timer, so nobody has to start them.

**Trigger events** (every week: a ranked list of companies worth calling now). See [projects/leads/LEADS.md](projects/leads/LEADS.md).

**Meeting prep** (every morning: a one-page brief for each meeting tomorrow)

```
Find meetings -> Pull history -> Research -> Brief, save and send
```

1. **Find meetings:** spots tomorrow's client meetings. Source (HubSpot or Outlook): **TBC**
2. **Pull history:** gets past contact, deals and notes from HubSpot.
3. **Research:** looks up recent news, the company website and the people attending.
4. **Brief, save and send:** writes a one-page brief, saves it in HubSpot on the meeting and company, and emails the Contour team a short version with a link.

**Both:** share one research tool. Each brief and lead card asks the team "useful or not?", and the answers improve the next round. HubSpot access is read-only to start. Saving notes needs write access (**TBC**).

## Decisions

- HubSpot is the source of truth for company history. How complete it is: **TBC**.
- **Stack (decided 2026-10-22):** HubSpot workflows, Claude as the research engine, a central backend, and a database later. n8n is **dropped**. Details in [HUBSPOT.md](HUBSPOT.md).
  - **HubSpot workflows** react to results inside HubSpot (tasks, notifications, property updates) and can send a webhook to the backend.
  - **Claude** does the research and writing. Breeze (HubSpot's AI) is a later option, tested on 5 companies if the admin enables it.
  - **Backend** holds research, scoring and memory. **Its own timer** starts the daily and weekly jobs, so no special HubSpot plan is needed for timers.
  - **Webhooks** connect the backend to HubSpot. For long jobs the backend replies "received" at once, works in the background, then saves the result through the HubSpot API.
- **Central backend, not a central web app.** A backend has no screens.
- No web app for version 1.
- Stages:
  1. Backend and a small database, with Trigger events. Research is one module with a fixed input and output. It searches the web and the HubSpot target lists, and emails ranked lead cards. The database remembers which leads were sent and the feedback, so nobody gets the same lead twice. (Was "backend only"; the database now comes first. **TBC**)
  2. Add Meeting prep on the same research module. It saves the brief in HubSpot and sends the email. Add HubSpot workflows for reactions (tasks, owner alerts).
  3. Add a front end only if needed: to search past briefs, edit settings, show a dashboard, or serve many users.
- Default backend stack (**TBC**): Python with FastAPI, Postgres, a small server on DigitalOcean.
- **Fallback:** if building and watching the backend becomes a chore, n8n can run that one piece. Make is a close second. Zapier is the weakest fit.

**Needed from HubSpot (TBC with the admin):**
- Plan: **Data Hub Professional or Enterprise** for the "Send a webhook" action. Without it, the backend checks the HubSpot API on a timer instead.
- A **Private App** token with write access to notes and tasks.
- Credits, only if we use Breeze.

## Costs and accounts

Prices are in USD. n8n prices are from its pricing page on 2026-10-19 and only apply if we use the fallback.

| Item | Estimate |
|---|---|
| HubSpot plan (Data Hub Professional) | Contour may already have it. Price **TBC**. |
| HubSpot Credits | Only if we use Breeze. About 1 cent per credit (**TBC**). |
| Claude API | Billed by use. Not estimated. Set a monthly cap. **TBC** |
| DigitalOcean server and database | Not estimated. **TBC** |
| n8n Cloud (fallback only) | Starter US$20 per month, Pro US$50 per month |

- Our estimate: about 830 research jobs per month (daily Meeting prep, plus a weekly scan of 200 companies with one job per company).
- **Data location:** Claude API calls go to Anthropic. DigitalOcean has a Sydney region (**TBC**). Contour must approve both for client data. (Dropping n8n Cloud also removes the Frankfurt storage question.)

**Billing (proposal):** I am a contractor. Contour creates and pays for the project accounts:
1. DigitalOcean account, under a Contour email and billing
2. Claude API account, with a monthly cap
3. A HubSpot Private App token, created by a HubSpot admin (read-only to start, write for notes)
4. Permission to send email or Teams messages

Claude Pro is my development tool. Bill it only if agreed in writing. Use sample data in it, not real client data. Use two API keys: one for testing and one for production.

## Next steps

1. Send Levi the cost and setup note.
2. Ask the HubSpot admin the seven questions in [HUBSPOT.md](HUBSPOT.md), section 15. The first two decide the plan: tier and credits.
3. Ask Levi what he means by "meeting panel."
4. Get HubSpot access. Run the data check: are meetings logged, how many companies have contacts, is there a target list, how many notes exist.
5. Build Trigger events: backend timer, Claude research, lead cards emailed to sales. Version 1 only needs HubSpot read access. Meeting prep follows.
6. Update the concept page and this file as answers arrive.

## Concept page

Private artifact (version 2): https://claude.ai/artifact/M7Nz9HiM2tfhryE4BqDCrP

It still says "type a company name" for Meeting prep and shows a central app. It needs to show automatic Meeting prep and "HubSpot + backend" (not n8n). Update: **TBC**.
