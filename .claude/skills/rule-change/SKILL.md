---
name: rule-change
description: Change the Lead Finder's rules, prompts or scoring safely, and prove the change with free checks and then the test set. Use for any edit to engine/backend/apps/lead_finder/rules/*.yaml, prompts/*.md, scoring.py, sourcing.py, sources.py, fields.py, why.py or testset.yaml, or to projects/leads/criteria/.
---

# Change a rule, a prompt or the score

AGENTS.md: a change to a prompt or a rule stays only if the test set score holds.

## Steps

1. **Find the source.** Every number comes from Levi, a Contour document or Al-khair, and is written in `projects/leads/criteria/Criteria_v2.md`. With no source, don't change the number: add the question to `projects/leads/questions/LEVI.md` and mark it **TBC** (to be confirmed).
2. **Take a baseline.** From the last test set run: matched of expected, the average cost per company, the rules version and the prompt versions. They are on the Lead Finder's Test set page (`list_testset_runs` behind it).
3. **Make the change in the right place:**

   | What | Where | Note |
   |---|---|---|
   | A number or a list | `rules/criteria.yaml` (or `queries.yaml`, `watchlist.yaml`, `hubspot_map.yaml`) | Pydantic checks it at start-up. A wrong file stops the backend. |
   | A check or the score | `scoring.py` | Pure code. Add unit tests for the edges, like 99 against 100 staff, Sydney, or an open deal. |
   | Claude's wording | `prompts/*.md` | Any byte change is a new version, saved with every run. Keep instructions apart from page text, which is data only. |
   | An answer form | `fields.py` | Then `uv run lead-finder forms` (free) checks it's under Anthropic's limits for strict forms. |
   | Which source wins | `sourcing.py` | Pure code, with tests. |

4. **Free checks** from `engine/backend/`:
   - the fast tests: `uv run pytest -m "not integration"`;
   - `uv run lead-finder rejudge`: judges the saved leads again with the new rules, read only. Count how many change result, and look at each one that does.
5. **The paid check, only on Al-khair's word.** Say what it will cost first, from the baseline's total. Then `uv run lead-finder testset --yes` (10 companies, real searches).
6. **Keep it or drop it.** The change stays only if matched of expected doesn't drop, and the cost doesn't rise without a reason. A person checks the cards that changed against their sources.
7. **Write it down:** what changed, its source and the date in `Criteria_v2.md` (still **TBC** until Levi confirms), and a line in the plan step's Log.

## Lines that never move

- Up to 3 decision makers, only from public pages, each with its link. Never LinkedIn or a page behind a login.
- Never an email or a phone number (`fields.py` and `sources.py` remove them).
- Property Daily stays off until its terms allow a program to read it.
- HubSpot names reach Claude only when `HUBSPOT_NAMES_TO_CLAUDE_OK` is on.
- Signal Hire is switched by `size.staff_sources` and `data_sources` in `criteria.yaml`. A staff count from it is only a note for retail and site-heavy companies.
