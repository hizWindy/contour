# Property Daily

Last updated: 2026-11-15. **TBC** means to be confirmed.

**In one line:** a paid daily news and leads service for commercial leasing, office fitout and relocations. We want its lease and move data in the Lead Finder, but only after written approval.

## What it is

- Run by The Spatial Group. Site: https://www.propertydaily.com.au
- For senior executives and business development managers in Australia and New Zealand. Focus on Sydney, Melbourne and Auckland.
- Subscribers get an email of new leads and updates every working day.
- Sign-in is a username and password, or Google or Microsoft single sign-on. The pages themselves are on `www.spatialgroup.com.au`.
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
2. **After written OK:** a [Playwright](playwright.md) script on its own login reads new leads once each working day. It saves the company, address, m², lease end and link. It stays behind a switch ("Property Daily is on" in Settings, off by default) until then.
3. **Better, if they offer it:** an API, a data feed, or the OK to read the daily email.

## Pages

Mapped on 2026-11-15 (PLAN-V16 T2-2), signed in, by reading only. The site is plain server pages on `www.spatialgroup.com.au`. No page loads its data from a JSON address, so the connector reads each page's text. Every address below is on that host.

| Page | Address | What it holds |
|---|---|---|
| Sign-in | A form on `www.propertydaily.com.au` that posts `login` and `password` to `/cgi-bin/login.cgi` | A session cookie. How long it lasts: **TBC** |
| Home | `/cgi-bin/main.cgi` | "Latest Opportunities": the name, type, market and m² of each |
| Daily email | `/main/mailview/pd/<YYYY-MM-DD>` | That day's items (13 on 13 Nov), each with: the company and headline, the market, the firms appointed, the m² wanted, when more is expected, the latest paragraph, the current office and its lease expiry, and the report id |
| Company report | `/cgi-bin/report.cgi?id=<n>` | The title ("company - headline"), the type, market and published date, the firms appointed, the m² wanted, the current, future and past offices (floor, m², building, street, suburb, state, postcode, lease expiry), the company's website, and every past item back to 2005 ("As reported by Property Daily on <date>, ...") |
| Search | `/cgi-bin/search.cgi?page=1&search=<name>&type=Organisation` | One row per report: date, organisation, category, description, market, m², next update, firms |
| MarketView | `/cgi-bin/marketview.cgi?market=<SYD, MEL, ADL, PER or NEW>`, or `?type=<category>` | The open items in one market or one category, 25 a page |
| Lease database | `/cgi-bin/lease_expiry_news.cgi/` | "Latest Leases": name, locality, m², expiry |
| Leases ending soon | `/cgi-bin/lease_expiry_news.cgi/marketview?view=timeframe_12__24` (also `timeframe_6__12`, `timeframe_24__9999`, and views by size and grade) | Every lease in that window on one page (287 rows for 12 to 24 months on 15 Nov): published, organisation, location, m², expiry, firms, market |
| Lease search | `/cgi-bin/lease_expiry_news.cgi/marketview?search=<name>&search_type=company` | That company's leases, past and current |
| Lease report | `/cgi-bin/lease_expiry_news.cgi/report?id=<n>` | Floor, m², building, address, expiry, space use, industry, building grade, start date, term and options |

- **Categories:** FA facilities assessment, MA merger or acquisition, GR growth or restructuring, LE lease expiry, ASR active space requirement, SC space commitment, DT design tender, DD design and documentation, FT fit-out tenders, REL relocation planning. The search form also has FIN (**TBC**).
- **Markets in the search form:** SYD, MEL, BNE, PER, ADL, CAN, NEW, DRW, HBA, WOL, and three in New Zealand.
- **What a program needs:** a lookup is about 3 pages (the search, the lease search and the best report). The daily feed is 1 page a day. Leases ending in 12 to 36 months are 2 pages.
- **Never opened by the connector:** Logout, My ShortList, My Reminders, My Notes, Briefs, Payments, Account Details, Submit requirement, Request Update, "Add to shortlist" and the email's `check_login` links. Each one changes something, or isn't ours to read.
- **People's details:** the reports list names, emails and phone numbers under "Key contacts" and "Project appointments". The connector keeps only the firms' names and drops the rest.

**What it can't give us:**
- Staff numbers.
- A company it hasn't reported on.
- An API or a data feed (**TBC**: W1 in PLAN-V16).
- A lease view for one city: `market=` didn't narrow the "leases ending soon" view (**TBC**).

## Status and next step

- Levi gave the green light to read it with a program on 2026-11-15 (as Al-khair reports). The Spatial Group hasn't been asked.
- [PLAN-V16.md](../plan/PLAN-V16.md) builds the connector. It stays behind its switch until Al-khair turns it on.
- Sign-in takes a username and password, so the program can sign in by itself.
- **The login in `engine/.env` is Levi's own** (the site greeted him on 15 Nov). Two sessions at once lock both out. Until the connector has a login of its own, run it only when nobody else is signed in with that login.
- Still recommended: Levi asks The Spatial Group for written OK and a feed or API. Not sent yet.
