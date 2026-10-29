# Company criteria, version 2

**Draft.** Levi to confirm. Last updated 2026-10-30. The engine on `master` still follows [version 1](Criteria_v1.md). Version 2 is built on the branch `engine-criteria-v2` (see [PLAN-V2.md](../../../plan/PLAN-V2.md)). It goes live only after Levi confirms it.

These rules decide which companies the research agent looks for, **before anyone calls them**. Everything new in this version is **TBC** (to be confirmed) until Levi checks it.

Version 2 adds these sources to version 1:
- **Target Customer Profile** ([PDF](../../../documents/lead-finder-docs/Contour_Target_Customer_Profile.pdf)). A working draft from October 2026, for leadership review. Its industry tiers, 75-staff hint and score still need leadership approval.
- **Levi's brief for the tool** ([AI Research tool prompts](../../../documents/lead-finder-docs/AI%20Research%20tool%20prompts.xlsx)).
- **Daily Meeting, 27 Oct 2026** ([minutes](../../../minutes%20of%20meeting/Daily%20Meeting%20-%202026_10_28%2007_15%20PST%20-%20Notes%20by%20Gemini.pdf)). These are Gemini's summary, so when they disagree with a written document, the document wins.
- **Levi's email, 29 Oct 2026.** A small company that will soon grow into the size range still counts. His example is Southern Launch in Adelaide.
- **Contour's Gold customers.** Levi sent 23 current customers from HubSpot on 29 Oct. The list has contact names, so it isn't saved in the repo. Section 11 has what it shows.

The revised deal criteria Word file has the same 11 rules as [DEAL.md](DEAL.md).

A company needs two things: it **fits** (section 2), and it **needs an office change** (section 4). The score (section 6) decides how high it ranks. Contour helps companies make better workplace decisions as they go through significant business change.

## 1. What changed from version 1

| # | Rule | Version 1 | Version 2 (all TBC) |
|---|---|---|---|
| 1 | Staff | 100 to 600 staff in that city, used when the office size isn't known | A hint, not a Drop: 75+ office staff (Profile) or 100+ in one office (brief). More than one office is a plus. A small company that will soon grow into range counts (Levi's email). |
| 2 | Industry | Site-heavy industries get a "check office size" flag | Judge the office, not the industry. A miner's corporate office counts. Industry tiers add points. |
| 3 | Triggers | 4 main, 3 other, 2 weak | New: a new facility with a big office part, a new business unit, an underperforming workplace. A leadership change counts only when strategy changes. |
| 4 | Timing | Within 3 years | Also: a consultant appointed within 18 months |
| 5 | Office age | "Office is due" booster: 6+ years | More than 5 to 8 years at the same address. A move or fitout in the last 3 years lowers the rank. |
| 6 | Score | Our own guessed weights | The Profile's 100-point model, in 6 parts |
| 7 | Results | Pass, Director review, Watch, Drop | Same results, matched to the Profile's 3 stages. Watch goes to sales to build relationships. |

**No change:** the size range, Sydney (still a Director decision), the local team, healthy, the Director sectors, and never-suggest.

An earlier draft of version 2 said Sydney Passes and the tenure is 7 to 8 years. Both came from Gemini's meeting summary. All three written sources say Sydney is case by case, and the brief says 5 to 8 years, so both are corrected here.

## 2. Does it fit?

Fail any rule → **Drop**. The exceptions are the Director cases in section 5.

| # | Rule | Passes if |
|---|---|---|
| 1 | Size | An office of 1,000 to 6,000 m² in that city. That's a $1.5M to $10M fitout. If the size isn't known, staff is a hint: 75+ office staff (Profile) or 100+ in one office (brief), at about 10 m² per person. Below that, the company gets a "check office size" flag, not a Drop (**TBC**). A company that will soon grow into range also passes (see below). |
| 2 | City | An office in Melbourne, Adelaide or Perth. Sydney and other cities go to a Director (section 5). |
| 3 | Office | The office matters to how they work: growth, performance, culture, collaboration or talent. Judge the office, not the industry. A miner's or engineering firm's corporate or technical office counts. Warehouses, plants and shops don't. If unsure: a "check office size" flag (**TBC**). |
| 4 | Local team | Local decision makers have real influence over the project, even if the company is owned overseas. Red flag example from the brief: "the whole team is in Singapore" (**TBC**). |
| 5 | Healthy | Not in administration, and not cutting staff fast (**TBC**) |

**Growing into the range (TBC).** A company below the size can still fit if it will soon need an office in range. The signs are big funding or a big announcement, plus a plan to hire. Judge the office it will need, not the one it has now. Example from Levi (29 Oct): Southern Launch in Adelaide had 30 to 40 staff when Contour first spoke to them. After big funding, it needed an office for 150 staff, about 1,500 m². How soon it must reach the range is **TBC**.

**Where staff numbers come from (TBC).** Try these in order:
1. **HubSpot.** Levi showed that HubSpot holds office size, lease expiry and a manual headcount per city. Check whether our export has them.
2. **A headcount tool.** Signal Hire, which Al-khair will test with an account from Levi. Lusha and Apollo were also named. All three are on the engine's blocked list, because they sell personal contact data, so we propose using them for company headcount numbers only.
3. **LinkedIn.** Its number is about half the real staff, so we double it.
4. **The AI's web research.**

Scraping LinkedIn directly risks IP bans (27 Oct meeting).

## 3. Industry tiers

New, from the Profile, and **TBC** with leadership. A tier adds points to the score (section 6). It never decides fit.

- **Tier 1:** energy and infrastructure, mining and resources corporate or technical offices, technology and telecommunications, and engineering and technical professional services.
- **Tier 2:** defence and advanced manufacturing, life sciences and medtech corporate workplaces, selected financial and corporate services, and other corporate professional services.

## 4. Does it need an office change?

It needs at least one trigger: a sign of an office change. No trigger yet → **Watch**.

| Group | Triggers |
|---|---|
| Main | Lease ending in 1 to 3 years, or a relocation. A merger or acquisition, where one company has an old office. A big new contract or project award, needing about 100 more office staff. Fast or planned headcount growth, like many job ads, big funding or growth news. |
| Other | Merging offices. Return to office. A restructure. A **new business unit**. A **leadership change that changes direction or strategy** (moved up from Weak). A **new engineering, project or manufacturing facility with a big office part**. An **underperforming workplace**, or a major business or industry change. |
| Weak | Culture change. Pressure on talent, client experience or productivity, like a hiring push. |

**Timing**
- The project is likely within 3 years, and a consultant is appointed within 18 months (Profile and [DEAL.md](DEAL.md)).
- A lease ending 1 to 3 years out is the best timing (**TBC**).
- An event like a merger counts for 12 months (**TBC**).

Levi's brief gives an example website for mergers and acquisitions, but the link is missing.

## 5. Sent to a Director

These fit and have a trigger, but a Director decides:
- **Large:** over about 600 staff or 6,000 m². It may be a Whale Pipeline project.
- **Just under the minimum:** an office of 800 to 1,000 m². Contour validated a deal at 800 m² (Alvarez & Marsal). **TBC**
- **Other cities:** Sydney, or any city other than Melbourne, Adelaide and Perth. The Profile says "Sydney selectively".
- **Sectors:**
  - Government, education and industry-associated consultants.
  - Law firms, especially the biggest.
  - Premium banking and financial services.
  - Real estate agencies and standard not-for-profits.
  - Hospitals and direct healthcare providers.

  This is "not a blanket ban" (Profile). A Director needs a compelling reason and a strong chance of winning (deal criteria). Shakespeare Financial and Alvarez & Marsal are live deals.

## 6. Score

New, from the Profile, and **TBC** with leadership. It replaces the boosters and our own weights from version 1. The score ranks companies. It never overrides a Drop or a NO GO.

| Part | Points | What the tool looks at | Can the tool see it? |
|---|---|---|---|
| Business or property trigger | 25 | Trigger group, how strong the source is, and Property Daily moves (scored highest, but off in the engine for now) | Yes |
| Project size | 20 | Office m², staff as a hint, or the office it will need after planned growth | Yes |
| Timing | 15 | Lease end, how recent the trigger is, years at the address (more than 5 to 8), no move or fitout in the last 3 years | Yes |
| Decision-maker access | 15 | Contact role found, a contact already in HubSpot, a link to a current customer | Partly |
| Integrated strategic fit | 15 | Talks about culture, hybrid work or green ratings (NABERS, Green Star). Hires firms directly. Industry tier (**TBC**). | Partly |
| Competitive opportunity | 10 | Not in a competitor's case studies from the last 5 years. No known fitout contractor relationship. | Partly |

**What the score means (Profile):** 75 to 100 means research first. 50 to 74 means investigate. Under 50 means nurture.

**Our proposal (TBC):** the tool can only partly see 40 of the 100 points. So it shows the points it could check, and marks the rest "not known yet", like "48 of 60 checked". Sales fills in the rest after the first call.

"Can pay" (profitable, growing or recently raised money) has no part in this model. We propose using it only to break ties (**TBC**).

## 7. Never suggest

- Companies already sent.
- Companies with an open deal or an active project in HubSpot.
- Companies whose deal was dissolved in the last 12 months, unless a new trigger appears. The 12 months is a guess (**TBC**).
- Companies on a do-not-contact list.

**Not used:** how often Contour has contacted a company. Levi said on 23 Oct that it doesn't predict projects.

## 8. Results and stages

| Result | When | Stage in the Profile | Next step |
|---|---|---|---|
| **Pass** | Fits and has a trigger | Active prospect | Sales looks into the need and access |
| **Director review** | Fits and has a trigger, but is on the Director list | Active prospect | A Director decides |
| **Watch** | Fits, but no trigger yet | Target account | Re-checked by the tool. Sales builds a relationship (**TBC**: for example, a monthly list). |
| **Drop** | Fails a fit rule | Not a target | None |

The third stage, **qualified deal**, comes after sales meets the client and checks the [deal criteria](DEAL.md). The tool doesn't decide it.

## 9. What the lead card shows

These are not rules. This is what sales sees. Levi said decision makers and talking points would be beneficial (27 Oct).
- **Result and score:** the result, the score with each part, and the facts with source links.
- **Contact role:** who to call first, like Head of Property or COO. Roles only. Names are **TBC**.
- **Talking points (new, TBC):** 2 or 3 short points tied to the trigger. Example: "Lease ends March 2028". Today the card has one opening line.
- **Office history (new, TBC):** years at the current address, and the last move or fitout date.
- **Links (new, TBC):** past design and fitout contractors, and links to current customers, if known.

## 10. What Levi's brief asks the tool to do

| Job | Today |
|---|---|
| 1. Rank current HubSpot companies every month, so none are missed | Partly. The HubSpot watchlist run exists. A monthly ranking is not built, and we planned weekly runs. |
| 2. Check HubSpot addresses and contacts | Not built. It touches contact details and writes to HubSpot, so it needs Levi's OK. |
| 3. Find new companies with triggers | Built: the "Find new leads" run |
| 4. Find companies linked to current customers, to follow up with a reference | Not built. Levi sent 23 Gold customers on 29 Oct (section 11). Check whether that's the full client list. |

The brief also has a **Prep Call** tool and a **Post Call** HubSpot tool, but both tabs are blank. The "Companies by name" run is a start for Prep Call.

## 11. What our current customers show

Levi sent 23 Gold customers from HubSpot on 29 Oct, all Active. They let us check version 2 against real customers. The list has contact names, so only company facts are kept here.

- **Industries match the tiers.** Defence and secure sites: C4i, Fivecast, SRC, Lockheed Martin, Softel. Energy and infrastructure: Horizon Power, Jemena, Engie, Consolidated Power Projects, McConnell Dowell. Life sciences and medtech: UCB, Draeger, 4DMedical, PolyNovo, Mettler-Toledo. Telco: Vocus, TPG. The rest are finance, logistics and professional services. Defence is Tier 2 today, but 5 of the 23 are defence or secure sites.
- **Office size fits.** Where the list gives a size, it's 1,400 to 3,000 m².
- **Some projects were smaller.** Projects were about $0.97M to $3.65M. 4 were under $1.5M: Softel ($1.2M), McConnell Dowell ($1.2M), TPG Perth ($1.37M) and TPG Adelaide ($0.97M).
- **The local office matters.** The head office is often in another city. C4i's head office is in Sydney, but its project was in Melbourne. SRC's is in Canberra, but its work was in Adelaide. This backs the local team rule.
- **Customers come back, and some may be due again.** Mettler-Toledo has been a client for 20 years and Qube for 15. Strategy work led to fitouts at Draeger and Engie. Fivecast took a 5-year lease at the end of 2022, with options, so it may end around late 2027. Bunge's Melbourne lease ends in 2029. Engie may still move.

**Proposal (TBC):** use these 23 as a test set. The tool should rate them as a fit. Their lease and growth news also suits job 1, ranking current HubSpot companies.

### What version 2 says about the 16 leads we have (30 Oct)

The engine judged the 16 leads saved in the dev database again with the version 2 rules, using the facts in their cards. It made no new searches and cost nothing (`uv run lead-finder rejudge`). These cards were made under version 1, so version 2 facts like years at the address are missing. Those checks show as "not known yet", and the points are out of the points the tool could check.

**14 of the 16 keep their result.** Two change, and both were Dropped for size only because their size came from staff alone. Under version 2 staff is a hint, so a small count gives a "check office size" flag, not a Drop. Budget Direct goes to Director review, and JOEST Australia goes to Watch. No lead is in the top band yet, 10 are in the middle band (investigate) and 6 are in the bottom band (nurture). A Watch lead can score in the middle band, because it has no trigger but the other parts still earn points. Whether that is right is for Levi (the bands and how they scale are **TBC**).

| Company | Version 1 | Version 2 | Points | Band | What changed |
|---|---|---|---|---|---|
| Budget Direct | Drop | Director review | 31 of 77 | Nurture | Size: not met to check |
| Acciona | Watch | Watch | 31 of 57 | Investigate | |
| CPB Contractors | Watch | Watch | 31 of 57 | Investigate | |
| Cooper & Oxley | Watch | Watch | 5 of 57 | Nurture | |
| JOEST Australia | Drop | Watch | 5 of 77 | Nurture | Size: not met to check |
| KBR | Director review | Director review | 31 of 57 | Investigate | |
| Perenti | Watch | Watch | 15 of 57 | Nurture | |
| SMEC Australia | Watch | Watch | 31 of 57 | Investigate | |
| UGL | Watch | Watch | 31 of 57 | Investigate | |
| ASC | Watch | Watch | 26 of 57 | Nurture | |
| Canadian Utilities | Watch | Watch | 26 of 57 | Nurture | |
| SMEC | Watch | Watch | 31 of 57 | Investigate | |
| Ausgold Limited | Watch | Watch | 34 of 57 | Investigate | |
| Cygnus Metals Limited | Watch | Watch | 31 of 57 | Investigate | |
| European Lithium Limited | Watch | Watch | 31 of 57 | Investigate | |
| GenusPlus | Watch | Watch | 31 of 57 | Investigate | |

**Not done yet:** the same table for the test set and the 23 Gold customers. That needs real searches, which cost money, and Levi's OK to send the customer names to Claude ([PLAN-V2.md](../../../plan/PLAN-V2.md) step D2).

## 12. Questions for Levi

1. Is the Target Customer Profile approved: the industry tiers, the 75+ staff hint and the 100-point score? Should defence move to Tier 1, since 5 of the 23 Gold customers are defence or secure sites?
2. Can you fill in the **Importance** column in the brief? It sets how much each check counts.
3. Should the ranked list be monthly, as the brief says, or weekly?
4. May the tool check and fix HubSpot contacts (job 2)?
5. Can you send the missing items: the ideal project overview, strategy documents (the Profile mentions a Communication Framework draft), and the example website for mergers and acquisitions? Is the list of 23 Gold customers the full client list?

**Still open:**
- Using a headcount tool for company numbers only.
- Roles or names for decision makers.
- Numbers to set: the exact tenure (5 to 8 years), whether the 1,000 m² minimum should be lower (4 customer projects were under $1.5M), and how soon a growing company must reach the size range.
- The questions from version 1 in [LEVI.md](../questions/LEVI.md).

**Answered by the documents:** Sydney stays a Director decision. A "recent" fitout means the last 3 years. A small company that will soon grow into range counts (Levi's email, 29 Oct).

## 13. What stays the same

The HubSpot deal evidence and the map of the 11 deal rules are unchanged. See sections 7 and 8 of [version 1](Criteria_v1.md). On `master`, the engine's `criteria.yaml` follows version 1. The branch `engine-criteria-v2` holds version 2, and it is merged only after Levi confirms it.
