# Arealytics

Last updated: 2026-11-15. **TBC** means to be confirmed.

**In one line:** a paid database of Australian commercial property, including who rents each office and when the lease ends. It could find lease endings for the Lead Finder, but its terms block AI use without written approval.

## What it is

- Run by Empirical CRE Pty Ltd. Site: https://arealytics.com.au. Login: https://pro.arealytics.com.au
- Covers Sydney, Melbourne, Brisbane, Perth and Adelaide. Office, industrial and retail. 450,000+ property parcels.
- Six linked datasets: properties, ownership, sales, lease deals, occupiers (tenants) and listings. Data is refreshed weekly to quarterly.
- Products: Arealytics Pro (search and export), a lease tool, bulk datasets ("via export or API"), and a mobile app.
- Users: agents, funds, banks, valuers and tenant reps.
- Whether Contour has access, and at what price: **TBC**.

## What data it has

- **Lease deals:** tenant, industry, area (m²), rent, start date, end date and term. Incentives are not captured.
- **Occupiers:** company and branch at each address, floor and suite, industry, revenue, staff numbers, ABN, chief executive and contact details.
- Lease deals and occupiers are licensed separately. They link by a property ID.

## Why we want it

- **Lease end dates** are the strongest trigger event, and the web rarely shows them. Example: ABC Logistics, Perth, lease ends 2028, 1,200 m². That's a lead 1 to 3 years out.
- **m² from a real lease** beats our guess of staff × 10 m². That makes the fitout value (m² × $1,500) more reliable.
- It covers Brisbane, which Property Daily doesn't focus on.

## What the terms allow

From the [platform terms](https://arealytics.com.au/platform-terms-of-use), checked 2026-11-15. They are much stricter than Property Daily's:

- **4.3:** no scraping, bots, scripts or bulk downloads. **Playwright is not allowed.**
- **4.4:** no storing it in our own database, except a reasonable extract for internal use.
- **4.8:** no connecting it to another system, unless Arealytics provides that integration.
- **5.2, 5.3 and 5.7:** no putting its data into an AI tool unless Arealytics approved that tool. It can't be used to "ground" or "retrieve-augment" an AI either. **The Lead Finder sends data to Claude, so this blocks it.**
- **2.2 and 4.2:** one login per person. **8.1:** they log exports, downloads and API calls.
- Contact details: our rule says never an email or phone in the Lead Finder ([AGENTS.md](../engine/AGENTS.md)). That applies here too.

## How we would connect

Only through their own route. Ask Arealytics for:
1. the bulk dataset or API, licensed for an internal tool, and
2. written approval of the Lead Finder (with Claude) as a "Permitted AI Tool".

Without both, use it by hand only: look up a company's lease when preparing a call.

## Pages

- **None mapped.** On 2026-11-15 (PLAN-V16 T2-2), `pro.arealytics.com.au` showed "Automated access detected" at its sign-in page, before anyone signed in. It said an AI browser agent was using the page and that automated access is not permitted.
- We stopped there, as the plan says, and tried nothing to get past it.

**What it can't give us:** anything, through a program, until Arealytics agrees. Use it by hand only.

## Status and next step

- Levi gave the green light to read it with a program on 2026-11-15 (as Al-khair reports). He says it has building records, some office sizes, and leases in Melbourne, Perth and Sydney. Arealytics hasn't been asked.
- **Dropped from [PLAN-V16.md](../plan/PLAN-V16.md)** by Al-khair on 2026-11-15, after the site refused automated access. Its switch stays off, and the lead card says "Arealytics: switched off".
- Next: Levi asks Arealytics for an API (it sells one) and written approval for an internal tool (W1). A later plan builds the connector on that API.
