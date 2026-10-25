# HubSpot export: analysis and watchlist

What Contour's HubSpot companies look like when run through the draft [company criteria](../criteria/COMPANY.md).

- **Source:** HubSpot export pulled by Al-khair Pama on 25 Oct 2026 (`hubspot_companies_full.xlsx`).
- **Company data:** [COMPANIES.xlsx](COMPANIES.xlsx), a copy with the Companies, Office Locations and Deals sheets.
- **Privacy:** this file and the copy hold company names and counts only. The Contacts sheet (names, emails, phones) was left out on purpose.
- **Last updated:** 2026-10-25. **TBC** marks what is not confirmed yet.

## In short

- HubSpot shows who Contour knows, not who is about to need an office change. No company has a trigger on record.
- On our estimate, 47 of 100 companies fit and go on **Watch**. Only about 11 of them look mostly office-based.
- The deals confirm two of our rules: fitout value = m² × $1,500, and Property Daily is the main deal source.

## 1. What's in the export

- **100 companies**, 185 office records, 12 deals. All created between 7 Aug and 22 Oct 2026.
- Exactly 100 companies may be one page of a HubSpot pull, which returns at most 100 at a time. Check it is the full list (**TBC**).
- **Lifecycle:** 92 Lead, 8 Opportunity, no Customer. None of the 11 clients on Contour's website is in it, so past wins are not in this export.
- **Owners:** Levi Young 51, Nikko Trinidad 39, five others 10 in total.
- **Offices on record:** Melbourne 62, Perth 45, Sydney 33, Brisbane 23, Adelaide 18. 88 of 100 companies have an office in Melbourne, Adelaide or Perth.

## 2. Staff counts

- **LinkedIn staff per office is the only near-complete size field:** 178 of 185 office records. "Employees" is filled for 34 of 100 and is often the whole company.
- **LinkedIn shows about half the real staff.** Across 19 companies with 100 to 600 staff, LinkedIn staff ÷ real staff has a median of 0.51 (middle half 0.43 to 0.63). Small sample (**TBC**).
- **Rule of thumb:** real staff ≈ LinkedIn staff × 2. Example: 60 on LinkedIn ≈ 120 staff, which passes the 100-staff rule.
- Without it, almost everyone drops. Only 15 offices in the three cities show 100+ on LinkedIn, and none in Perth. With × 2 it is 69: Melbourne 39, Perth 27, Adelaide 3.

## 3. Criteria run

Staff = the company's largest office in Melbourne, Adelaide or Perth, × 2. Triggers are not in HubSpot, so no company can reach Pass yet.

| Result | Companies | Detail |
|---|---|---|
| **Watch** | 47 | Fits, no trigger on record. Melbourne 26, Perth 20, Adelaide 1. |
| **Director review** | 15 | Healthcare 7, finance 4, insurance 2, real estate 1, law 1. Goes to a Director only if a trigger appears. |
| **Drop** | 31 | 21 under 100 staff. 10 with no office in the three cities. |
| **Never suggest** | 7 | Open deal: 209 Greenhill Road, Alvarez & Marsal, Ascaro Padel, Kyndryl, Nilsen Group, PYC Therapeutics, Shakespeare Financial Group |

**The "mostly office-based" rule matters most.** 36 of the 47 Watch companies are in construction, civil, mining, machinery, manufacturing, food, retail, automotive or similar, where most staff work on sites or in shops. Keep the rule and Watch drops to about 11. This is judged from the industry field only (**TBC**).

## 4. Deals

| Company | m² | Amount (AUD) | Source in deal name | Stage |
|---|---|---|---|---|
| Kyndryl | 787 | $1,180,500 | Lease expiry | Unqualified Information Deal |
| Ascaro Padel | 3,000 | $4,500,000 | INTEL | Unqualified Information Deal |
| Online Lead Management | 390 | $585,000 | INTEL | Dissolved |
| Shakespeare Financial Group | 1,400 | $2,100,000 | Property Daily | Verified Information Deal |
| Alvarez & Marsal | 800 | $1,200,000 | Property Daily | Contour Validated Deal |
| Nilsen Group | 1,000 | $1,500,000 | Property Daily | Verified Information Deal |
| Patties Food Group | 1,000 | $1,500,000 | INTEL | Dissolved |
| Dollarama (The Reject Shop) | 3,500 | $5,250,000 | New office | Dissolved |
| PYC Therapeutics | 1,300 | $1,950,000 | Property Daily | Verified Information Deal |
| 209 Greenhill Road | – | $1,000,000 | Spec suite | Contour Validated Deal |
| FYI | 800 | $1,200,000 | Property Daily | Dissolved |
| Baker Bleu | 2,000 | $3,000,000 | INTEL | Dissolved |

- **Open:** 7 deals, $13,430,500. **Dissolved:** 5 deals, $11,535,000. Total $24,965,500.
- **Every amount with a size is m² × $1,500.** This matches our fitout estimate in [COMPANY.md](../criteria/COMPANY.md).
- **Property Daily is the main source:** 5 of 12 deals are "PD Relocation". 4 are "INTEL" (meaning **TBC**).
- **The size minimum looks softer in practice.** 4 deals are under 1,000 m² (390 to 800 m²), below the $1.5M deal minimum. Alvarez & Marsal at 800 m² is still "Contour Validated".
- **Finding the decision maker is the bottleneck.** 10 of 12 deals have the next step "Find Decision Maker".
- **No reason is recorded** for the 5 dissolved deals.

## 5. Contacts (counts only)

- 129 contacts. 71 companies have one contact, 4 have none.
- 108 have an email and 86 a mobile. Where these came from is **TBC**.
- **Roles:** CEO, MD or GM 64, operations 21, finance 20, people or HR 3, other 15. Only **6 are in property or workplace roles**, across 5 companies.
- So the gap is the right person, not emails. Claude's web search should try to find the property or workplace lead before we pay for a contact tool.

## 6. Data quality

- **Lease Expiry** is filled for 1 of 185 offices (Kyndryl Melbourne, 30 Nov 2027). **Last Moved** is empty. The fields exist, so the tool could fill them later. That needs HubSpot write access.
- **State** is mixed: "SA" and "South Australia", "WA" and "Western Australia", "5000" in one row, 10 blank.
- **Country** is blank for 70. AusWISE is listed in Mexico, which looks wrong.
- **Industry** is blank for 8. **Last contacted** is filled for 27 of 100.
- Dollarama is Canadian but owns The Reject Shop (general knowledge, **TBC**). Its record holds the Reject Shop deal, so it is not a wrong match.

## 7. Questions this raises

1. Is this all of HubSpot's companies, or only the first 100?
2. Should "mostly office-based" drop builders and miners? Are the 12 construction companies clients, partners or competitors (for example Q Design + Construct)?
3. Is under 1,000 m² acceptable? Alvarez & Marsal at 800 m² is validated.
4. Why were the 5 deals dissolved? This is question 9 in [LEVI.md](../questions/LEVI.md).
5. What does "INTEL" mean as a deal source?

## 8. Watchlist (47)

Fits on our estimate, no trigger on record. Next step: check each by name for a trigger, likely office-based first. "Office-based?" is judged from the industry field only (**TBC**).

| # | Company | City | LinkedIn staff | Est. staff | Industry | Office-based? | Note |
|---|---|---|---|---|---|---|---|
| 1 | Synechron Australia | Adelaide | 107 | ~214 | Information Technology And Services | Likely |  |
| 2 | SME Powered Services | Melbourne | 101 | ~202 | Consumer Electronics | Likely |  |
| 3 | JAM TV | Melbourne | 82 | ~164 | Media Production | Likely |  |
| 4 | Cullen Jewellery | Melbourne | 80 | ~160 | Luxury Goods Jewelry | Likely |  |
| 5 | Clinibase | Melbourne | 78 | ~156 | Biotechnology | Likely |  |
| 6 | Cyclotek Pty Ltd | Melbourne | 74 | ~148 | Pharmaceuticals | Likely |  |
| 7 | Gibson Quai International (GQI) | Melbourne | 65 | ~130 | Professional Training Coaching | Likely |  |
| 8 | Otic Group | Melbourne | 57 | ~114 | Information Technology And Services | Likely |  |
| 9 | AusWISE | Melbourne | 56 | ~112 | Civic Social Organization | Likely |  |
| 10 | Crux Biolabs | Melbourne | 53 | ~106 | Biotechnology | Likely |  |
| 11 | Horizon Nexus Partners | Perth | 74 | ~148 | Professional Training Coaching | Likely |  |
| 12 | Lactalis-Mainland Dairy | Melbourne | 212 | ~424 | Food Beverages | Unlikely |  |
| 13 | Patties Food Group | Melbourne | 182 | ~364 | Food Beverages | Unlikely | Dissolved deal |
| 14 | The Body Shop | Melbourne | 128 | ~256 | Retail | Unlikely |  |
| 15 | Australian Meat Group | Melbourne | 88 | ~176 | Food Beverages | Unlikely |  |
| 16 | Mirrastone | Melbourne | 75 | ~150 | Construction | Unlikely |  |
| 17 | HARLI + HARPA | Melbourne | 72 | ~144 | Retail | Unlikely |  |
| 18 | Elastomers Australia | Melbourne | 71 | ~142 | Mining Metals | Unlikely |  |
| 19 | Victoria International Container Terminal | Melbourne | 69 | ~138 | Maritime | Unlikely |  |
| 20 | HomeRepair | Melbourne | 64 | ~128 | Construction | Unlikely |  |
| 21 | Action Rehab Hand Therapy | Melbourne | 63 | ~126 | Medical Practice | Unlikely |  |
| 22 | Mercedes-Benz Brighton | Melbourne | 59 | ~118 | Automotive | Unlikely |  |
| 23 | Unyte | Melbourne | 58 | ~116 | Civil Engineering | Unlikely |  |
| 24 | Tradetech Services Australia | Melbourne | 57 | ~114 | Construction | Unlikely |  |
| 25 | Trivantage Manufacturing | Melbourne | 56 | ~112 | Electrical Electronic Manufacturing | Unlikely |  |
| 26 | Advanced Cranes | Melbourne | 55 | ~110 | Construction | Unlikely |  |
| 27 | Hawk Logistics | Melbourne | 55 | ~110 | Transportation Trucking Railroad | Unlikely |  |
| 28 | Lantrak | Melbourne | 54 | ~108 | Civil Engineering | Unlikely |  |
| 29 | Adenco | Perth | 91 | ~182 | Construction | Unlikely |  |
| 30 | Aspect Engineering Solutions | Perth | 79 | ~158 | Civil Engineering | Unlikely |  |
| 31 | Q Design + Construct | Perth | 68 | ~136 | Construction | Unlikely |  |
| 32 | Endurance Mining | Perth | 64 | ~128 | Mining Metals | Unlikely |  |
| 33 | City Toyota Perth | Perth | 63 | ~126 | Automotive | Unlikely |  |
| 34 | Big Yellow Mining Pty Ltd | Perth | 63 | ~126 | Mining Metals | Unlikely |  |
| 35 | Allight | Perth | 61 | ~122 | Machinery | Unlikely |  |
| 36 | B1 Homes | Perth | 60 | ~120 | Construction | Unlikely |  |
| 37 | SGC Australia Pty Ltd | Perth | 60 | ~120 | Mining Metals | Unlikely |  |
| 38 | David Moss Corporation | Perth | 59 | ~118 | Mining Metals | Unlikely |  |
| 39 | General Crane Services (WA) Pty Ltd | Perth | 57 | ~114 | Machinery | Unlikely |  |
| 40 | PCH Civil | Perth | 55 | ~110 | Construction | Unlikely |  |
| 41 | Mandoon Estate | Perth | 54 | ~108 | Hospitality | Unlikely |  |
| 42 | Scott Park Group Pty Ltd | Perth | 53 | ~106 | Construction | Unlikely |  |
| 43 | Peritas | Perth | 52 | ~104 | Civil Engineering | Unlikely |  |
| 44 | Bluewaters Power | Perth | 51 | ~102 | Oil Energy | Unlikely |  |
| 45 | AMS Installation & Maintenance Solutions | Perth | 50 | ~100 | Construction | Unlikely |  |
| 46 | New Choice Homes | Perth | 50 | ~100 | Construction | Unlikely |  |
| 47 | MEGA Resources | Perth | 50 | ~100 | Mining Metals | Unlikely |  |

## 9. Director review if a trigger appears (15)

| # | Company | City | LinkedIn staff | Est. staff | Industry |
|---|---|---|---|---|---|
| 1 | Altaira | Adelaide | 211 | ~422 | Hospital Health Care |
| 2 | Bayside Health | Melbourne | 428 | ~856 | Hospital Health Care |
| 3 | Fitzroy Legal Service | Melbourne | 165 | ~330 | Law Practice |
| 4 | Adica Insurance | Melbourne | 142 | ~284 | Insurance |
| 5 | DBG Health | Melbourne | 128 | ~256 | Hospital Health Care |
| 6 | Scrubs Nursing Agency | Melbourne | 116 | ~232 | Hospital Health Care |
| 7 | AUSUN Finance | Melbourne | 63 | ~126 | Financial Services |
| 8 | Chris Barnard Health | Melbourne | 60 | ~120 | Hospital Health Care |
| 9 | Aviso Specialty | Melbourne | 56 | ~112 | Insurance |
| 10 | Hope Aged Care | Melbourne | 54 | ~108 | Hospital Health Care |
| 11 | Household Capital | Melbourne | 52 | ~104 | Financial Services |
| 12 | PictureWealth | Perth | 64 | ~128 | Financial Services |
| 13 | Edge Visionary Living | Perth | 63 | ~126 | Real Estate |
| 14 | Capital Partners Private Wealth Advisers | Perth | 58 | ~116 | Financial Services |
| 15 | Rural Health West | Perth | 57 | ~114 | Hospital Health Care |

Bayside Health is also over 600 staff on our estimate.

## About the copy

[COMPANIES.xlsx](COMPANIES.xlsx) keeps the original's columns, links and formulas, minus the Contacts sheet.
- The "# Contacts" column is now plain numbers, because its formula counted rows on the removed sheet. A note on its header says so.
- The other formulas ("# Deals", "Total Deal Value", the deal total) recalculate when the file is opened in Excel.
