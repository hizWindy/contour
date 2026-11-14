---
name: merge-check
description: The gate before Contour's tracks are joined or master moves - the plan's steps and "Done when", branch hygiene, file owners, the known joins, every test and build, security, design and the docs. Use before `merge vNN`, before moving master, and before `deploy vNN`. It gives a verdict; it never merges.
---

# Merge check

The result is a verdict: **Ready**, **Ready with notes** or **Not ready**. This skill never merges, pushes or deploys.

## 1. The plan

- Read the plan's "How to work this plan" and "Merge and deploy" sections.
- Every step of every track is ticked with a date and a commit, or listed as "built, waiting for a look". Anything else is a Blocker.
- Each ticked step's "Done when" is really true. Spot-check at least one step per track against the code.

## 2. The branches (the `git-workflow` skill)

- Each track's worktree has no uncommitted work: `git -C ../contour-vNN-tN status --short`.
- Each track changed only its own files. Compare `git diff --name-only plan-vNN...plan-vNN-trackN` with the plan's owner table. A file outside it is a Blocker unless the Log records the hand-off.
- No new packages unless the plan allows them: `package-lock.json` and `uv.lock` unchanged.
- No secrets, `COMPANIES.xlsx`, `plan/shots/` or `plan/PLAN-V1.md` in any commit.
- The commit messages name their plan step.

## 3. The known joins

- **One migration chain:** `uv run alembic heads` shows one head.
- **Route lists:** `tests/core/test_contract_routes.py` keeps every track's lines.
- **Generated files** match a fresh run: `uv run engine openapi` and `npm run types` leave `git diff` empty.
- The schema map matches: `uv run --no-sync python scripts/schema_map.py --check`.

## 4. The checks

One at a time, through `bash engine/scripts/heavy.sh <cmd>`:

| Side | Commands |
|---|---|
| Backend (`engine/backend/`) | `uv run ruff check .`, `uv run mypy`, all tests with `RUN_GATES=1` and the database up |
| Website (`engine/frontend/`) | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `node scripts/bundle-report.js` against the last numbers |
| Plan extras | What the plan's merge step asks for, like `load.py` against its targets, or a browser pass |

Write down each result as a count, like "3,586 passed".

## 5. Security, design and docs

- The `security-check` skill on the whole diff: `git diff master...plan-vNN`.
- The `design-review` skill on the files changed under `engine/frontend/src/`.
- The docs match the code: `engine/AGENTS.md`, `engine/DESIGN.md`, `projects/prep/PREP.md` if call prep changed, and the go signals in `CLAUDE.md`.

## The verdict

- **Ready:** everything passes, and nothing is left but the screens waiting for Al-khair's look.
- **Ready with notes:** everything passes, with Should fix items or Notes.
- **Not ready:** any Blocker. List each one with its evidence and the fix.

Then list what wasn't checked, and why.
