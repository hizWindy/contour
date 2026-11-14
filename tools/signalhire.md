# Signal Hire

Last updated: 2026-11-15. **TBC** means to be confirmed.

**In one line:** a paid people and company database. The Lead Finder already uses it to check company size and the names of senior people.

## What it is

- A contact and company data service with an API. Site: https://www.signalhire.com. Docs: https://docs.signalhire.com
- Paid with credits, plus a daily search quota.
- The key is `SIGNALHIRE_API_KEY` in `engine/.env`.

## Why we use it

- **Staff count in a city.** It drives the m² guess (staff × 10 m²) and the fitout value (m² × $1,500). Example: 120 staff in Perth means about 1,200 m² and a fitout of about $1.8M.
- **Company details:** checked name, website, industry, LinkedIn page, offices and total staff.
- **Senior people:** names and job titles of up to 3 decision makers. Levi said yes to names on 2 Nov.

## How it works here

- Code: `engine/backend/core/signalhire/` and `apps/lead_finder/signalhire_company.py`.
- One lookup per company: the details cost 1 credit, the city count uses 1 search, and the senior people use 1 search.
- Details are saved for a month, so each company is paid for once a month.
- A run reads at most 20 new companies (`SIGNALHIRE_MAX_CREDITS_PER_RUN`).
- HubSpot company names go to Signal Hire only if `HUBSPOT_NAMES_TO_SIGNALHIRE_OK=true`. It is off.

## Limits

- **No contact details.** The code has no call for emails, phones, the Person API or staff lists. Emails and phones are still open with Levi (**TBC**, PLAN-V4 Part E).
- **The Company API is off** for our account. It returned a 403 (no access) on 2 Nov. Until support switches it on, names are not checked and counts use the name as typed. The lead card says "name not checked".

## Status and next step

- Live in the Lead Finder.
- Next: ask Signal Hire support to switch on the Company API. Not confirmed if this was asked yet.

Full rules: [AGENTS.md](../engine/AGENTS.md), "Safety".
