# Research parameters

How the research agent checks the [company criteria](../criteria/Criteria_v1.md): how each rule is measured, where it looks, and what it records. The rules themselves are in Criteria_v1.md, and this file doesn't repeat them.

Last updated 2026-10-25. **TBC** marks what is not confirmed or not tested yet.

## 1. How each rule is measured

| Rule | How the agent measures it | Notes |
|---|---|---|
| Size | Office m² from Property Daily, a lease record or a deal. If not known: staff in that city × 10 m². | In Contour's deals, m² per person runs from 2.7 to 18 (median about 8). So staff × 10 is a rough guess (question 8). |
| Staff in the city | LinkedIn staff at that office × 2 | LinkedIn shows about half the real staff (median 0.51 across 19 HubSpot companies). HubSpot's "Employees" field is often the whole company, so don't use it for one city. |
| Fitout value | Office m² × $1,500 | The same rate as every deal in HubSpot. Example: 3,000 m² → at least $4.5M. |
| Office-based | The office size, not the industry. Builders, miners and similar firms get a "check office size" flag. | **TBC** |
| Local team | An Australian head office, or a local leader who runs property. Check the leadership page and annual report. | **TBC** |
| Healthy | ABN Lookup and ASIC: still active, no administration notice. News: no big layoffs. | |
| Move window | From the trigger date or the lease end date. Best 1 to 3 years out. | **TBC** |
| Who to contact | A role first: Head of Property or Workplace, then COO or CFO. Names come later. | Only 6 of 129 HubSpot contacts have a property or workplace role. |

**Staff counts for new companies:** HubSpot already holds LinkedIn staff per office. Where those counts come from is **TBC**. LinkedIn blocks automated reading, so for companies not in HubSpot, Claude can only estimate from the web.

## 2. What it records for each company

| Fact | Example |
|---|---|
| Name and website | ABC Logistics |
| City, and staff in that city | Perth, 300 |
| Office size, and whether it is known or estimated | 3,000 m², estimated |
| Fitout value | $4.5M |
| Industry | Logistics |
| Owner | Private, Australian |
| Trigger, its date and its source | Won a $200M contract, 14 Oct 2026, ASX announcement |
| Expected move date | 2027 (estimate) |
| In HubSpot? | No, or yes with the owner and any open or dissolved deal |

Every fact has a **source link**, a **date** and a label: **confirmed**, **estimated** or **guessed**. This lets Levi check a lead in seconds.

## 3. Where it looks

Each company is searched from three angles: property (lease, move), people (hiring) and money (contracts, growth).

| Trigger | Where, strongest first |
|---|---|
| Lease ending | Property Daily, annual reports (the lease note), property news |
| Merger or takeover | ASX announcements, news |
| Big contract or fast growth | ASX announcements, AusTender and state tender sites, news, job ads (weak) |
| Return to office or restructure | News |
| New CEO or hiring push | News, careers pages (weak signs) |

**Checks for every company:**
- **HubSpot**, read only: is it already a record, who owns it, and is there an open or dissolved deal?
- **ABN Lookup and ASIC**, both free: legal name, still active, any administration notice.
- **WGEA list**, free: staff size band. Whether it shows the city is **TBC**.

Reading only. No scraping of LinkedIn, Seek or other sites that ban it. See the safety rules in [LEADS.md](../LEADS.md).

## 4. Source strength

This feeds the score, strongest first:
1. Property Daily move or lease record
2. ASX announcement or official news
3. Other news
4. Job ads or rumours

Why Property Daily comes first: in HubSpot, 4 of 5 Property Daily deals are still open, while 3 of 4 "INTEL" deals were dissolved ([EXPORT.md](EXPORT.md)).

## 5. Weekly settings

| Setting | Version 1 |
|---|---|
| Cities | Melbourne, Adelaide, Perth |
| Triggers | Lease, merger, contract, growth |
| How far back | 30 days the first time, then 7 days each week |
| Watchlist | HubSpot target lists, checked by name. Start with the 47 companies in [EXPORT.md](EXPORT.md), the 11 likely office-based ones first. |
| Breadth | How many searches run per slice (**TBC**) |
| Depth | 1 follow-up round: the gap check |
| Budget per company | Example: 1 worker and up to 10 searches for a watchlist company (**TBC**) |
| Limits | Most companies per week, and a spending cap (**TBC**) |

## 6. Ideas to test

1. **Best timing is 1 to 3 years before the move.** Any closer, and a consultant is probably already hired. (**TBC**)
2. **Use the WGEA list.** Private employers with 100+ staff report to the Workplace Gender Equality Agency, which publishes them by industry and size. It could be the starting list of companies. (**TBC**: does it show the city, and can we use it?)
3. **Read the lease note in annual reports.** Listed companies often show when their leases end. That is the strongest sign, and it's free. (**TBC**)
4. **Watch building news.** When a building is sold or redeveloped, every tenant must move. One story can give several leads.
5. **Watch the fitout cycle.** Companies refit every 5 to 10 years. A client from 6 or more years ago may be due again.
