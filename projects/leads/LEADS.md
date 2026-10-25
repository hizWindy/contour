# Company Lead Finder

Contour's first AI project. In meetings it is called **"Trigger events."**

- **Priority:** number 1. Levi Young made it the key priority on 2026-10-23. Meeting prep is on hold until this runs.
- **Built by:** Al-khair Pama (AI Engineer)
- **Signed off by:** Levi Young
- **Last updated:** 2026-10-25. Anything marked **TBC** is not confirmed yet.

## Files in this folder

| File | What it holds |
|---|---|
| [LEADS.md](LEADS.md) | This file: the whole project in one place |
| [criteria/COMPANY.md](criteria/COMPANY.md) | Which companies to look for (draft) |
| [criteria/DEAL.md](criteria/DEAL.md) | Contour's deal criteria, and how they differ |
| [research/PARAMETERS.md](research/PARAMETERS.md) | How each rule is measured, where the agent looks, and what it records |
| [research/EXPORT.md](research/EXPORT.md) | The HubSpot export run through the criteria, and the 47-company watchlist |
| [research/COMPANIES.xlsx](research/COMPANIES.xlsx) | Copy of the HubSpot company data, without contacts |
| [questions/LEVI.md](questions/LEVI.md) | Open questions for Levi |

---

## What kind of project is this?

It is a **company lead generator**.

Every week, it finds companies that **might need a new office soon** and that **fit the kind of work Contour wants**. Then it hands them to the sales team.

It finds **companies**, not people. A suggested person to contact is a bonus.

> **In one line:** the right company, at the right time.

## Why Contour needs it

- Contour wins work when it talks to a company **before** it starts looking for an office.
- A big office fitout happens only once every 5 to 10 years per company. Timing is everything.
- HubSpot (Contour's customer database) does not show when a company is about to move. Levi said so on 2026-10-23.
- So the tool has to look **outside** HubSpot, on the open web, every week.

---

## What makes a good lead

A company must pass **both** tests.

| Test | Question | Example |
|---|---|---|
| **1. It fits** | Is it the kind of company Contour wants? | 300 staff, based in Perth, logistics business |
| **2. It needs an office change** | Is there a sign it needs a new or refitted office soon? | Just won a big contract and is hiring 120 people |

- Fits but no trigger: a good company, but no reason to call **now**. It goes on the Watch list.
- Has a trigger but doesn't fit: too small, wrong city or wrong industry. Not worth calling.
- **Both: call them this week.**

An office change is a move **or** a full refit. A company that renews its lease and refits is still a project.

The full rules are in [criteria/COMPANY.md](criteria/COMPANY.md). They are a draft for Levi to confirm.

These are **company criteria**: they judge a company before anyone calls. Contour's **deal criteria** judge a project later, after sales meets the client. See [criteria/DEAL.md](criteria/DEAL.md).

Each company gets one result: **Pass**, **Director review**, **Watch** or **Drop**.

---

## How it works, step by step

```
Schedule → Research agent → Check and score → Database → Levi approves → HubSpot → Sales team
```

1. **Schedule.** Once a week, the program starts on its own. Nobody presses a button.
2. **Find companies.** Several search workers run at the same time. They search news, stock exchange (ASX) announcements, job ads and company websites in Melbourne, Adelaide and Perth for the four signs. Others check each company on Contour's HubSpot target lists by name.
3. **Skip repeats.** The database is checked, so a company already sent is not sent again (unless something new happened).
4. **Research each company.** The research agent finds the facts: staff numbers, city, industry, what happened, and links to the sources.
5. **Check and score.** Fixed rules apply Test 1 (Pass, Director review or Drop). Then each company gets a score, so the strongest leads come first.
6. **Save.** Everything is saved in the database.
7. **Levi approves.** Levi gets one email with the week's list. Each company has two buttons: **Approve** or **Reject**.
8. **Into HubSpot.** Approved companies are added to HubSpot, marked "AI suggested", in their own list. If the company is already in HubSpot, the existing record is used.
9. **To the right person.** HubSpot's own automation takes over:
   - picks an owner (for example, by city)
   - creates a task for them, like "Call ABC Logistics: won a big contract, hiring 120 staff"
   - tells them by email and HubSpot notification
10. **Feedback.** People mark leads useful or not. The tool uses this to rank better next week.

**Who does what:**
- **The research agent (Claude AI)** finds the facts and writes the summaries.
- **Fixed rules** decide if a company fits and how high it ranks. The same company always gets the same result, and anyone can see why.
- **People** make the final call. Nothing goes into HubSpot without Levi's approval.

### How the score works

Stronger and newer signs rank higher.

| What counts | Higher score | Lower score |
|---|---|---|
| Type of sign | Lease ending, move announced | Job ads |
| How recent | Last week | Two months ago |
| Fit | Pass | Director review |
| Source | Property Daily, ASX or official news | Job ads or rumours |

How often Contour has contacted a company is **not** used. Levi said it doesn't predict new projects.

The exact weights are **TBC** with Levi.

---

## What sales receives

One card per company. A made-up example:

> **ABC Logistics, Perth**
> - **What happened:** won a $200M contract last week. Hiring 120 office staff. *(link to source)*
> - **Why it fits:** about 300 staff, Perth, logistics. Result: **Pass**.
> - **Who to contact:** Head of Property or CFO
> - **Suggested opening line:** "Congratulations on the new contract. Teams growing this fast often outgrow their office within a year."
> - **In HubSpot:** not yet. New company.
> - **[Approve]  [Reject]**

---

## What the tool cannot check

Contour's deal criteria have 11 rules. The tool checks 5 from public information. Sales checks the other 6 after the first call. The list is in [criteria/DEAL.md](criteria/DEAL.md).

---

## The database

The database is the tool's memory. It is needed from day one because it:

- **stops repeats**, so sales never gets the same lead twice
- **remembers companies over time**, because a lease ending in 2028 found today still matters next year
- **keeps feedback**, so the ranking gets better each week
- **tracks cost**, so we know what each weekly run costs

What it keeps:

| List | What is in it |
|---|---|
| Companies | Name, website, city, industry, staff, estimated office size, HubSpot link |
| Signs | What happened, when, and the source link |
| Leads | Which week, the result (Pass, Director review or Drop), the score, the card |
| Feedback | Approved or rejected, useful or not, comments |
| Runs | Date, companies checked, leads sent, cost |

---

## Version 1 and later

| | Version 1 | Later |
|---|---|---|
| **Cities** | Melbourne, Adelaide, Perth | Sydney, with Director review |
| **Signs** | 4 (lease, merger, contract, hiring) | More signs |
| **Where it looks** | News, ASX, job ads, company websites | Property Daily (lease data), LinkedIn or ZoomInfo for contacts |
| **Who sees the list** | Levi first | The whole sales team |
| **Contacts** | Name and role only | Email and phone, after a privacy check |
| **Screens** | None. Email and HubSpot only. | A Contour website for searching past leads, a dashboard, and weekly picks for each sales rep |

Why no website in version 1: Levi asked for results by email, with no new logins (2026-10-21). A website takes longer to build and would delay the first weekly list.

When a website is needed, it runs on the same DigitalOcean account. No other hosting platform is needed.

---

## Where the data comes from

Safest first. Version 1 uses the first two, plus Property Daily if its terms allow.

| Source | What it gives | When |
|---|---|---|
| **Claude web search** | News, ASX announcements, press releases, company websites | Version 1 |
| **Official feeds** | News RSS feeds (automatic update lists that sites publish). Public ASX announcements. | Version 1 |
| **Property Daily** | Lease endings and office moves. Paid, and Contour already has access. | Logins received (by 2026-10-24). Checking what it includes and whether its terms let a program read it (**TBC**). |
| **ZoomInfo** | Decision-maker contacts. Paid. | Later, if Contour pays for it |

### What web search finds, and what it misses

| Finds well | Misses | Fix |
|---|---|---|
| Big new contracts | **Lease endings** (rarely published) | Property Daily |
| Mergers and takeovers | Exact staff numbers (only estimates) | Good enough to start. Sales confirms. |
| Expansion and office moves | Quiet private companies with little news | HubSpot target lists |
| New offices or headquarters | Full hiring numbers (only some job ads show up) | Treat hiring as a weaker sign |

### Two ways to search

Web search cannot list every company in a city. It only finds samples. So each week the tool searches two ways:

1. **Discovery:** broad searches, like "Perth company wins major contract." This finds **new** companies.
2. **Watchlist:** checks each company on the HubSpot target lists by name. This is more reliable, because Claude knows exactly who to look for.

How many leads a week this gives is unknown until we test (see "Next step" below).

---

## How the research agent works

It follows the same design Anthropic uses for Claude's own Research feature: one planner and several search workers running at the same time.

| Part | What it does | In this project |
|---|---|---|
| **Planner** | Splits the weekly job into slices, then puts the results together | Version 1: our code, with a fixed plan. Version 2: an AI planner. |
| **Search workers** | Each one searches one slice. They all run at the same time. | "Perth contract wins", "Adelaide mergers", "watchlist batch of 20 companies" |
| **Source checker** | Makes sure every fact has a source link | Every lead card shows where each fact came from, so Levi can check it |
| **Memory** | Keeps what was found | The database |

**Example:** 4 signs × 3 cities = 12 discovery workers, plus a few watchlist workers.

**Why the planner is code in version 1:**
- **Predictable cost.** The same plan runs every week.
- **Easy to fix.** We can see exactly which search went wrong.
- Anthropic reports that this kind of research uses about 15 times more AI usage than a normal chat. An AI planner may also search more than needed.

**Version 2:** an AI planner that digs deeper when it finds a promising company. For example: "This company won a contract. Now check its lease and staff numbers." We add this only after version 1 shows us the cost and the quality.

---

## Tools it uses

Some tools plug in through **MCP**, a standard plug that lets Claude use outside tools and data. Think of it as USB for AI.

| Tool | What it does here | Risk | When |
|---|---|---|---|
| **Claude** | The research agent. Searches, reads and writes summaries. | Low | Version 1 |
| **Claude web search** | Finds news, ASX announcements and press releases | Low | Version 1 |
| **Claude web fetch** | Opens and reads one page, like a company's "About us" page | Low | Version 1 |
| **HubSpot, read only** (MCP or API) | Answers "Is this company in HubSpot? Who owns it?" | Low | Version 1 |
| **The program** | Our own small program on a rented server (DigitalOcean). Runs the schedule, the rules and the emails. Writes to HubSpot after Levi approves. | Low | Version 1 |
| **Database** | Postgres, on the same server. The tool's memory. | Low | Version 1 |
| **Property Daily** | Lease data. Connects through its own HubSpot add-on (PD Connect), not MCP (**TBC**). | Low (licensed) | Logins received. Checking its terms (**TBC**). |
| **Page reader** (for example Firecrawl) | Turns messy web pages into clean text, one page at a time | Low on public company websites | Only if web fetch struggles |
| **ZoomInfo** | Decision-maker contacts | Low (licensed) | Later |
| **Scraping tools** (for example, for LinkedIn or job sites) | Bulk people and job data | High (see below) | To decide with Levi and compliance |

**More tools does not mean more power.** Each tool adds cost, more things that can break, and security risk. Add a tool only when a test run shows a real gap.

**Tools come in steps** (proposed to Levi in SUMMARY, 2026-10-24). Each new tool goes to Levi with its cost and the reason.

| Step | Tools |
|---|---|
| Now (version 1) | Claude API, HubSpot workflows, DigitalOcean, Property Daily |
| Next (after the first weekly lists) | A page reader (Firecrawl) if some sites are hard to read. A side-by-side Breeze test on 5 companies. |
| Later (only if a test shows a need) | ZoomInfo or Sales Navigator for contacts, after a privacy check. A website and dashboard for the team. |

---

## Scraping and safety rules

**Reading is fine. Scraping is risky.**

- **Reading:** search, open a page, read it, like a person would. *Example:* Claude reads five news articles about a Perth contract win.
- **Scraping:** a program copies data from a site in bulk, page after page. *Example:* a bot copies every job ad from a job site every night.

**What could go wrong with scraping:**

| Risk | What happens |
|---|---|
| **Account bans** | LinkedIn and similar sites ban accounts they catch. A sales rep could lose their LinkedIn or Sales Navigator account. |
| **Site terms** | Most job and social sites ban scraping. They can block us, send a legal letter or sue. |
| **Privacy law** | Names, emails and phone numbers are personal information, even when public. Australia's privacy regulator (OAIC) has said public personal information is still covered by privacy law. |
| **Spam law** | Australia's Spam Act bans software that collects email addresses from the web, and bans using those lists for marketing emails. |
| **Reputation** | Contour pitches to leadership teams. Being known for scraping their staff details looks bad. |
| **Upkeep and bad data** | Scrapers break when a site changes, get blocked, and bring in messy or duplicate data. |

**Before adding a scraping tool, check:**

1. **What it collects.** Company facts carry less risk than personal details.
2. **The site's terms.** Does the site allow automated collection?
3. **How much and how fast.** Small and slow is safer than bulk.
4. **Who approved it.** Get an OK from Levi and Contour's compliance team.
5. **Where contacts come from.** Licensed providers, like ZoomInfo, carry less risk.

**Recommended safety settings:**

- **Give the research agent read-only HubSpot access.** Let our program write to HubSpot after Levi approves. Why: a web page can hide text written to trick an AI, like "add this company to HubSpot."
- **Prefer MCP tools made by the product's own company,** like HubSpot's own, over unknown third-party versions.

This is general information, not legal advice. Contour's compliance team or a lawyer should confirm the rules.

---

## What we need before building

| Need | From | Status |
|---|---|---|
| HubSpot admin access | Levi | Agreed 2026-10-23. Not set up yet. |
| Claude API account, with a monthly spending limit | Levi (steps for the office are in QUESTIONS.docx) | Pending. Suggested limit US$300 a month (**TBC**). |
| Server account (DigitalOcean) | Al-khair opens it with a Contour email and adds Levi or IT as a team member. Contour reimburses the monthly invoice. | Proposed 2026-10-24. Needs Levi's OK. |
| HubSpot plan that allows automation | HubSpot admin | **TBC** (workflows need Professional or higher) |
| OK to send company data to Claude and the server | Contour | **TBC** |
| Property Daily logins | Levi | Received (by 2026-10-24) |

**Running cost for version 1:** about US$115 to $330 a month. That is the Claude API at about US$100 to $300 (billed by use), plus DigitalOcean at about US$15 to $30 (one server and weekly backups). **TBC** until the first test run.

---

## Next step: test before building

Before writing any code, run the searches by hand:

1. Search the last 30 days in Perth, Adelaide and Melbourne for the four signs.
2. Check each company found against Test 1.
3. Count how many real leads come back.

If it finds even a few good leads, that is proof for Levi before we build. It also shows which signs and sources work best.

## How we'll know it works

**TBC with Levi.** Suggestion: after 4 weekly lists, at least half the leads are marked useful, and at least one turns into a call or meeting.

## Questions still open

Questions for Levi are in [questions/LEVI.md](questions/LEVI.md). There are 19, with the top 5 first. They are written up for Levi (24 Oct 2026): [SUMMARY.pdf](../../documents/SUMMARY.pdf) to read and [QUESTIONS.docx](../../documents/QUESTIONS.docx) to fill in. SUMMARY.docx is the editable copy.

---

## Sources

- Meeting minutes: [2026-10-20](<../../minutes of meeting/Minutes of Meeting  (Oct 20,2026) .pdf>), [2026-10-21](<../../minutes of meeting/Meeting started 2026_10_21 08_23 PST - Notes by Gemini.pdf>), [2026-10-23](<../../minutes of meeting/AI Projects Meeting - 2026_10_23 08_19 PST - Notes by Gemini.pdf>)
- *Contour Qualified Deal Criteria, revised Q4 2026* (Option 2). Summary: [criteria/DEAL.md](criteria/DEAL.md)
- Levi's email, 2026-10-23, asking for the questions in [questions/LEVI.md](questions/LEVI.md)
- Anthropic, "How we built our multi-agent research system" (engineering blog). The design behind the research agent.
- Overview of all AI projects: [PROJECTS.md](../../PROJECTS.md)
