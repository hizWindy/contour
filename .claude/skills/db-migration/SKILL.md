---
name: db-migration
description: Change the database in Contour's engine safely - an Alembic migration, the schema map, the test table lists, and one migration chain at a merge. Use for any new table, column, index or constraint, and for a migration conflict between branches.
---

# Change the database

Every table change goes through an Alembic migration. Nobody edits tables by hand.

## Steps

1. **Change the model** in the table's module. A project's tables live in its own schema (`lead_finder`, `companies`). The shared ones live in `core`.
2. **Start the database:** `docker compose up -d` in `engine/`, or the plan's own database in a worktree.
3. **Generate:** from `engine/backend/`, run `uv run alembic revision --autogenerate -m "what changed"`. Name it like the others: `00NN_short_name`.
4. **Read the file and fix it.** Autogenerate often gets these wrong: renames (it drops and adds), server defaults, enum changes, partial indexes, pgvector columns, and moving data.
5. **Make it safe on a live table:**
   - a new column is nullable or has a server default;
   - fill big tables in steps;
   - avoid long locks. App connections stop a statement after 30 seconds and a lock wait after 10. Whether the migrate step has the same limits is **TBC**, so a long backfill sets its own.
6. **Write a working downgrade.**
7. **Apply it:** `uv run engine migrate`.
8. **The schema map:** `uv run --no-sync python scripts/schema_map.py`, then commit the new `engine/schema/SCHEMA-<number>.md` with the migration. `--check` proves it matches.
9. **A new table joins the test lists:**
   - `TEST_TABLES` in `tests/conftest.py`;
   - `fill_every_table` in `tests/core/test_fixtures.py`;
   - the `TRUNCATE` lines in `tests/core/test_first_admin.py` and `tests/core/test_auth_admin.py`.
10. **Data rules:** times in UTC with the zone; money as exact decimals, never floats; no contact emails or phones in any table.
11. **Run the checks:** ruff, mypy, and all tests with the database up.

## One chain at a merge

- `uv run alembic heads` must show **one** head.
- Two branches that each added a migration after the same parent: point the later one's `down_revision` at the other. PLAN-V15 did this with `0017_call_prep`, which now comes after `0016_sync_cancel`.
- Never edit a migration that has been deployed. Add a new one.
- A deploy runs `engine migrate` first, as App Platform's pre-deploy job, so a failing migration stops the deploy.
