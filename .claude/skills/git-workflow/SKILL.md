---
name: git-workflow
description: How to branch, commit, merge, tag, push and clean up in Contour's repo - master, the plan branches, the track worktrees and their cleanup. Use before any git commit, branch, worktree, merge, tag, push or cleanup, and when asked about git practice or tidying branches.
---

# Git workflow

The record of the work is git and the plan, so both must stay clean. Merging, pushing and deploying happen only on Al-khair's own word.

## The shape

| Branch | What it is | How it moves |
|---|---|---|
| `master` | What is live, or about to be | Only by fast-forward, after a merge check says Ready |
| `plan-vNN` | One per plan, made from `master` | Takes the tracks as merge commits |
| `plan-vNN-trackN` | One per track, in its own worktree | Small commits by that track only |
| A short job outside a plan | Named for what it does, like `home-bento` | Same rules as a plan |
| `backup/<what>` | A safety copy before something risky, like `backup/master-before-clean` | Kept until Al-khair says |

- **Worktrees:** a track works in its own copy, beside the main folder: `git worktree add ../contour-v16-t1 -b plan-v16-track1 plan-v16`. A new copy needs `npm ci` in `engine/frontend/`, and a copy of `projects/leads/research/COMPANIES.xlsx` from the main folder (it is kept off GitHub).
- **The main folder stays on `master`.** The running app uses it. Don't switch its branch.
- **Tags** mark a hand-off between tracks, like `v15-api` (the API contract is ready).

## Commits

1. **Check the branch:** `git branch --show-current`.
2. **Look before you stage:** `git status`, then stage files by name. No `git add -A` or `git add .`.
3. **Never stage:** `engine/.env` or any key, `COMPANIES.xlsx`, `plan/shots/` (screenshots can show a real client), or `plan/PLAN-V1.md` (Al-khair's own edit).
4. **Small commits,** one idea each.
5. **The message** says what changed, in plain words, with the plan step:
   - code: `PLAN-V15 T1-6: safe deploys and limits`
   - a plan tick: `Plan: PLAN-V15 T1-8 done, Track 1 ready to merge`
   - outside a plan: `Website: a failed preload never reloads the page`
   - End it with the attribution lines your session gives.
6. **The pre-commit hook** runs Ruff, mypy and the fast tests. Never skip it with `--no-verify`. If it fails, fix the cause and commit again.
7. **Generated files** (`engine/frontend/openapi.json` and `src/api/schema.d.ts`): run `uv run engine openapi`, then `npm run types`. Never edit them by hand, even in a merge conflict.

## Merging

Only on Al-khair's word (the go signal `merge vNN`), and only after the `merge-check` skill says Ready.

1. Work in a worktree on `plan-vNN`, not in the main folder.
2. Merge each track in the plan's order, as a merge commit: `git merge --no-ff plan-vNN-track1 -m "Merge plan-vNN-track1 into plan-vNN: <what it brings>"`.
3. Fix the joins the plan lists: one migration chain, both sides of the route lists, and the generated files made again.
4. Run all the checks again on the joined branch.
5. Move `master` in the main folder: `git merge --ff-only plan-vNN`. If it won't fast-forward, stop and ask. Never a merge commit or a reset on `master`.

## Pushing and deploying

Only on Al-khair's word (the go signal `deploy vNN`).

- `git push origin master`. Never force-push `master`, and never rewrite history that has been pushed.
- Deploying is a separate step on App Platform: pushing doesn't deploy (`deploy_on_push` is false).

## Cleaning up

After a plan is deployed and checked live:

1. **List** what's left: `git worktree list`, and `git branch --merged master`.
2. **Show the list to Al-khair,** and remove things only on his word.
3. **Remove the plan's worktrees:** `git worktree remove ../contour-vNN-tN`. It refuses if there is uncommitted work: then stop and ask. Then `git worktree prune`.
4. **Delete merged branches** with `git branch -d` (small d: it refuses unmerged work). Never `git branch -D` without Al-khair's word.
5. **Keep** tags and `backup/` branches until Al-khair says.

## When something goes wrong

- **Back up first:** `git branch backup/<what>-<date>`.
- **Undo a pushed commit** with `git revert`, never by rewriting history.
- **`git reset --hard`** only on a branch that was never pushed, after a backup, on Al-khair's word.
- **A conflict you don't understand:** stop, show both sides, and ask.
