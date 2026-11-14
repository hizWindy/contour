# Property Daily

Last updated: 2026-11-15. **TBC** means to be confirmed.

**In one line:** a paid daily news and leads service for commercial leasing, office fitout and relocations. We want its lease and move data in the Lead Finder, but only after written approval.

## What it is

- Run by The Spatial Group. Site: https://www.propertydaily.com.au
- For senior executives and business development managers in Australia and New Zealand. Focus on Sydney, Melbourne and Auckland.
- Subscribers get an email of new leads and updates every working day.
- Login is Google or Microsoft single sign-on, through spatialgroup.com.au.
- Contour has logins. Levi sent them by 2026-10-24.

## Why we want it

- It is Contour's best deal source. In HubSpot, 4 of 5 Property Daily deals are still open. 3 of 4 "INTEL" deals were dissolved ([EXPORT.md](../projects/leads/research/EXPORT.md)).
- It has what the web rarely shows: lease endings, office moves and m². Example: Shakespeare Financial, Perth, 1,400 m², a $2.1M fitout.
- In the Lead Finder it would be the top-ranked source ([PARAMETERS.md](../projects/leads/research/PARAMETERS.md)).

## What the terms allow

From the [terms](https://www.propertydaily.com.au/terms-and-conditions/) and [FAQ](https://www.propertydaily.com.au/faq/), checked 2026-11-14:

- **Clause 5:** use is for "your own personal reference only". Storing it "in a retrieval system" needs written approval from The Spatial Group.
- **Clause 5.1:** you can't use it to build or run other products.
- **Clause 1.2:** one login per person. No sharing. Clause 1 lets Contour add logins for other staff.
- **FAQ:** if two people use one login at once, both are locked out for a while.
- **Clauses 1.1 and 7.1:** Contour is responsible for all use of its logins, and they may monitor use.
- There is no public API, data export, or HubSpot add-on on the site. An earlier note said "PD Connect" links it to HubSpot. That is **TBC**.

## How we would connect

1. **Now (allowed):** read it ourselves, by hand or with Claude in Chrome, on our own login.
2. **After written OK:** a [Playwright](playwright.md) script on its own login reads new leads once each working day. It saves the company, address, m², lease end and link. It stays behind a switch, `PROPERTY_DAILY_ON=false`, until then.
3. **Better, if they offer it:** an API, a data feed, or the OK to read the daily email.

## Status and next step

- Off. Our rule says it stays off until the terms allow a program to read it ([AGENTS.md](../engine/AGENTS.md)).
- Next: Levi (the account holder) asks The Spatial Group for written OK to use the data in an internal tool, and whether they offer a feed or API. Not sent yet.
- Al-khair gets his own login, not Levi's.
