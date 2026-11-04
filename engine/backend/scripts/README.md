# Scripts

Quick checks against outside APIs and the backend, run by hand. They are not part of the app.

Run them from `engine/backend`, like `uv run --no-sync python scripts/hubspot_schema.py`.

## Rules

1. **Keys stay in `engine/.env`.** A script reads them through `core.config.get_settings()`. It never prints a key and never has one written in it.
2. **Answers go to `scripts/out/`.** Git ignores that folder, because answers can hold client data. The exception is `schema_map.py`: it writes only table and column names, so its files go to `engine/schema/` and git tracks them.
3. **Read only by default.** A script that writes to HubSpot or spends money needs a `--yes` flag, like `lead-finder refill --yes`.
4. **A check used often becomes a real command,** with tests, in the engine. For example, `hubspot_schema.py` leads to `engine hubspot-check` in [PLAN-V5](../../../plan/PLAN-V5.md).

## The scripts

| Script | What it does | Cost |
|---|---|---|
| `hubspot_schema.py` | Contour's HubSpot company and deal fields (real names, labels, types, choices), the deal stages and any custom objects. Field definitions only, no records. | Free, read only |
| `schema_map.py` | Our own database: a diagram of the tables and links, every column, key, index and check, and what changed since the last version. Saves `engine/schema/SCHEMA-<migration number>.md`. Run it after every migration. `--check` writes nothing and fails if the saved file is missing or no longer matches the database. | Free, read only, no rows read |
