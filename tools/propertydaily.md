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

- Levi gave the green light to read it with a program on 2026-11-15 (as Al-khair reports). The Spatial Group hasn't been asked.
- [PLAN-V16.md](../plan/PLAN-V16.md) builds the connector. It stays behind its switch until Al-khair turns it on.
- The FAQ says sign-in also works with a username and password, so the program can sign in by itself.
- It also has an online database of past and current leads, and "MarketView" (a table of a whole market). PLAN-V16 step T2-2 maps these pages.
- Still recommended: Levi asks The Spatial Group for written OK and a feed or API. Not sent yet.
- The connector needs a login of its own, not Levi's or Al-khair's.
