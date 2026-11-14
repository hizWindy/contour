---
name: api-change
description: Add or change an endpoint in Contour's engine end to end - the route, the service, the database code, the models, the errors, who may call it, the tests, and the API contract the website's types come from. Use for any new or changed route under /api/v1/.
---

# Add or change an endpoint

The rules are in `engine/AGENTS.md`, "Coding practices" and "API conventions". This is the order to work in.

## Steps

1. **Copy a pattern.** Find the nearest endpoint that does something similar and follow its shape. Shared routes are in `core/api/`; a project's are in `apps/<name>/api*.py`, mounted through its `AppSpec`.
2. **Three layers.** The route checks the request and calls a service. The service holds the logic. The database code sits in the table's module. Each layer calls only the one below it. Core never imports from apps.
3. **Models.** Pydantic request and response models, with `response_model`, a summary and examples on the route, so Swagger stays a complete guide. Money is `Decimal`, and times are UTC with the zone.
4. **Lists** are paged and filterable. No endpoint returns an unlimited list.
5. **Errors** use the one shape, `application/problem+json`: a title, a status, a plain detail and the `request_id`. The words follow PLAN-V15's "Words for errors". Never a command, a file name, a local address or a setting name (`tests/core/test_safe_deploys.py` checks this). The technical detail goes to the log. A 503 carries `Retry-After`.
6. **Who may call it.** The sign-in guard denies by default, so a new route needs a session wherever sign-in is on. Take `MaybeAuthDep` or `AdminDep` from `core/api/signin.py`. A project's rows and fields go only to people with that project's tick (`AppAccess`).
7. **Outside calls** (Claude, HubSpot, Signal Hire, websites): a timeout on each, and retries only where a repeat is safe. A HubSpot write goes only through `core/hubspot/writer.py`: `preview_write`, a person confirms, then `apply_write`.
8. **The event loop.** Heavy work runs in a thread. Don't hold a database connection while you wait on an outside answer.
9. **Tests:**
   - fast unit tests for the service, edge cases included;
   - an API test for the route, with and without sign-in;
   - the route added to `tests/core/test_contract_routes.py`;
   - fakes only: the fake Claude (`tests/lead_finder/samples.py`) and `FakeHubSpot` (`tests/core/hubspot_fake.py`).
10. **The contract.** From `engine/backend/`: `uv run engine openapi`. Then from `engine/frontend/`: `npm run types`. Never edit `openapi.json` or `schema.d.ts` by hand. Tell the frontend-agent which routes and types changed.
11. **Checks:** `uv run ruff check .`, `uv run ruff format .`, `uv run mypy`, the fast tests, then all tests with the database up.

## Done when

The route works with and without sign-in, every error has plain words, the contract and the website's types are made again, and all the checks pass.
