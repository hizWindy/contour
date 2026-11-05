"""A big fake database for timing the website and the API (PLAN-V7 A2).

    uv run --no-sync python -m tests.e2e.perf_seed                # 10,000 leads and 50 runs
    uv run --no-sync python -m tests.e2e.perf_seed --leads 2000   # a smaller one
    uv run --no-sync python -m tests.e2e.serve --perf             # then serve it (API_PORT)

It makes `leadfinder_perf`, never `leadfinder` (the dev database) and never `leadfinder_e2e`. It
is made from nothing each time: migrated, the HubSpot export loaded, the one "Sample Headcount"
lead researched with the fake Claude and Signal Hire (the same start as the fake backend), and
then that lead's card is copied into 10,000 "Sample ..." leads and 50 runs by plain SQL, so it
takes seconds and no Claude call is made. The numbers are fixed by `setseed`, so every database
is the same.

What the leads look like (close to the real mix, TBC): 8% Pass, 15% Director review, 45% Watch and
32% Drop; four cities; 16 industries in 5 groups; 11 signs, one or two on each lead; created over
the last 120 days; spread over the runs. Their cards are all copies of one card, so the lead
page has real content, but the company named on a card is not the lead's.
"""

import argparse
import asyncio
import sys
from datetime import date
from typing import Any

from tests.e2e import serve

# Fixed lists, so a test can read the same words back.
CITY_SQL = """CASE WHEN x.c < 0.45 THEN 'Melbourne' WHEN x.c < 0.65 THEN 'Sydney'
    WHEN x.c < 0.83 THEN 'Perth' ELSE 'Adelaide' END"""

RUNS_SQL = """
INSERT INTO core.runs (id, app, mode, status, params, caps, rules_version, prompt_versions,
    cost_usd, web_searches, claude_requests, counts, stop_reason, created_at, started_at,
    finished_at)
SELECT gen_random_uuid(), 'lead_finder',
    (ARRAY['discovery', 'discovery', 'watchlist'])[1 + mod(g, 3)],
    CASE WHEN mod(g, 9) = 0 THEN 'cancelled' ELSE 'done' END,
    '{}'::jsonb,
    jsonb_build_object('run_cap_usd', '20', 'max_companies', 20, 'company_cap_usd', '1',
        'discovery_cap_usd', '5'),
    t.rules_version, 'perf', round((1 + random() * 8)::numeric, 6), 12 + mod(g, 30),
    20 + mod(g, 40),
    jsonb_build_object('slices', 12, 'slices_done', 12, 'candidates', 60, 'unique', 40,
        'chosen', 20, 'researched', 20,
        'by_result', jsonb_build_object('pass', 2, 'watch', 12, 'drop', 6)),
    CASE WHEN mod(g, 9) = 0 THEN 'Stopped by a person.' END,
    x.ts, x.ts + interval '1 minute', x.ts + interval '14 minutes'
FROM generate_series(1, %(runs)s) AS g
CROSS JOIN (SELECT rules_version FROM lead_finder.leads WHERE company = 'Sample Headcount'
    LIMIT 1) AS t
CROSS JOIN LATERAL (SELECT now() - g * interval '2 days' - random() * interval '1 day' AS ts) AS x
"""

LEADS_SQL = f"""
WITH t AS (SELECT * FROM lead_finder.leads WHERE company = 'Sample Headcount' LIMIT 1),
     r AS (SELECT id, row_number() OVER (ORDER BY created_at) AS n FROM core.runs
           WHERE app = 'lead_finder'),
     words AS (SELECT ARRAY['Atlas', 'Harbour', 'Summit', 'Meridian', 'Cobalt', 'Willow', 'Ember',
        'Granite', 'Lantern', 'Orchard', 'Quartz', 'Tidal', 'Vertex', 'Beacon', 'Cedar',
        'Delta', 'Fern', 'Glacier', 'Horizon', 'Indigo', 'Juniper', 'Kestrel', 'Lumen',
        'Maple'] AS first,
        ARRAY['Logistics', 'Software', 'Partners', 'Group', 'Health', 'Energy', 'Capital',
        'Systems', 'Legal', 'Mining', 'Analytics', 'Insurance'] AS second,
        ARRAY['lease_ending', 'merger_or_takeover', 'big_new_contract', 'fast_growth',
        'office_consolidation', 'return_to_office', 'restructure', 'new_ceo',
        'new_business_unit', 'new_facility', 'underperforming_workplace'] AS triggers,
        ARRAY['Software', 'Banking', 'Insurance', 'Law', 'Accounting', 'Consulting', 'Marketing',
        'Mining services', 'Energy', 'Hospital and health care', 'Aged care', 'Retail',
        'Government', 'Education', 'Logistics', 'Engineering'] AS industries,
        ARRAY['Technology', 'Finance', 'Finance', 'Professional services',
        'Professional services', 'Professional services', 'Professional services',
        'Resources', 'Resources', 'Health', 'Health', 'Retail', 'Government', 'Other',
        'Other', 'Professional services'] AS groups)
INSERT INTO lead_finder.leads (id, run_id, origin, is_test, company, company_key, domain, city,
    suburb, industry, industry_group, staff_in_city, office_m2, office_m2_estimated, result,
    score, score_checked, trigger_id, trigger_ids, trigger_date, contact_role, status,
    hubspot_status, card, cost_usd, web_searches, rules_version, prompt_version, created_at,
    updated_at)
SELECT gen_random_uuid(), r.id,
    CASE WHEN x.o < 0.05 THEN 'typed' WHEN x.o < 0.15 THEN 'hubspot' ELSE 'web' END,
    false,
    'Sample ' || w.first[1 + mod(g, 24)] || ' ' || w.second[1 + mod(g / 24, 12)] || ' ' || g,
    'sample-' || g, 'sample-' || g || '.com.au',
    {CITY_SQL},
    t.suburb, w.industries[ind.i], w.groups[ind.i],
    staff.n, staff.n * 10, x.e < 0.5,
    res.result,
    CASE res.result
        WHEN 'pass' THEN 70 + floor(x.b * 26)
        WHEN 'director_review' THEN 60 + floor(x.b * 26)
        WHEN 'watch' THEN 35 + floor(x.b * 35)
        ELSE floor(x.b * 40) END::int,
    CASE WHEN res.result = 'drop' THEN NULL ELSE t.score_checked END,
    w.triggers[trig.i],
    CASE WHEN x.e < 0.6 THEN ARRAY[w.triggers[trig.i]]
         ELSE ARRAY[w.triggers[trig.i], w.triggers[1 + mod(trig.i, 11)]] END,
    current_date - floor(x.f * 100)::int,
    t.contact_role,
    CASE WHEN x.s < 0.80 THEN 'new' WHEN x.s < 0.88 THEN 'watching'
         WHEN x.s < 0.98 THEN 'rejected' ELSE 'sent' END,
    CASE WHEN x.h < 0.50 THEN 'new' WHEN x.h < 0.70 THEN 'in_hubspot'
         WHEN x.h < 0.80 THEN 'open_deal' WHEN x.h < 0.85 THEN 'dissolved_deal'
         ELSE 'possible_match' END,
    t.card, t.cost_usd, t.web_searches, t.rules_version, t.prompt_version,
    now() - x.f * interval '120 days',
    now() - x.f * interval '120 days'
FROM generate_series(1, %(leads)s) AS g
CROSS JOIN t
CROSS JOIN words AS w
JOIN r ON r.n = 1 + mod(g, %(runs)s)
CROSS JOIN LATERAL (SELECT random() AS a, random() AS b, random() AS c, random() AS d,
    random() AS e, random() AS f, random() AS o, random() AS s, random() AS h) AS x
CROSS JOIN LATERAL (SELECT CASE WHEN x.a < 0.08 THEN 'pass' WHEN x.a < 0.23 THEN 'director_review'
    WHEN x.a < 0.68 THEN 'watch' ELSE 'drop' END AS result) AS res
CROSS JOIN LATERAL (SELECT 1 + floor(x.d * 16)::int AS i) AS ind
CROSS JOIN LATERAL (SELECT 1 + floor(x.d * 11)::int AS i) AS trig
CROSS JOIN LATERAL (SELECT 20 + floor(x.c * 780)::int AS n) AS staff
"""


def _conninfo(database: str) -> str:
    from psycopg.conninfo import make_conninfo

    from core.config import get_settings

    settings = get_settings()
    return make_conninfo(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password.get_secret_value(),
        dbname=database,
        connect_timeout=5,
    )


def fill(leads: int, runs: int) -> str:
    """Copies the "Sample Headcount" lead into `leads` leads and `runs` runs. One database only:
    `serve.PERF_DATABASE`."""
    import psycopg

    counts: dict[str, Any] = {"leads": leads, "runs": runs}
    with psycopg.connect(_conninfo(serve.PERF_DATABASE), autocommit=True) as connection:
        if connection.execute(
            "SELECT count(*) FROM lead_finder.leads WHERE company = 'Sample Headcount'"
        ).fetchone() != (1,):
            raise SystemExit("The 'Sample Headcount' lead is missing: nothing to copy.")
        connection.execute("SELECT setseed(0.42)")
        connection.execute(RUNS_SQL, counts)
        connection.execute(LEADS_SQL, counts)
        connection.execute("VACUUM (ANALYZE) lead_finder.leads")
        connection.execute("ANALYZE core.runs")
        found = connection.execute(
            "SELECT (SELECT count(*) FROM lead_finder.leads),"
            " (SELECT count(*) FROM core.runs WHERE app = 'lead_finder'),"
            " pg_size_pretty(pg_database_size(current_database()))"
        ).fetchone()
    if found is None:
        raise SystemExit("Could not count what was made.")
    return f"{serve.PERF_DATABASE} now has {found[0]} leads and {found[1]} runs ({found[2]})."


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Make the big fake database (PLAN-V7 A2).")
    parser.add_argument("--leads", type=int, default=10_000, help="How many leads (10,000).")
    parser.add_argument("--runs", type=int, default=50, help="How many runs (50).")
    args = parser.parse_args(argv)
    if args.leads < 1 or args.runs < 1:
        raise SystemExit("--leads and --runs must be 1 or more.")

    serve.use_e2e_database(database=serve.PERF_DATABASE)

    from core.runtime import loop_factory

    serve.prepare_database(serve.PERF_DATABASE)
    print(asyncio.run(serve.load_hubspot(), loop_factory=loop_factory()), file=sys.stderr)
    seeded = asyncio.run(serve.seed_signalhire_sample(date.today()), loop_factory=loop_factory())
    print(seeded, file=sys.stderr)
    print(fill(args.leads, args.runs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
