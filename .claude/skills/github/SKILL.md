---
name: github
description: How Contour's repo uses GitHub (origin, hizWindy/contour) - pushing, pull requests with the gh CLI, reviewing a PR, and what must never go to GitHub. Use before any push, pull request, PR review or comment, issue, tag push or release, and when asked about GitHub practice.
---

# GitHub

GitHub is outside the laptop. Anything pushed or written there can be copied or cached, even after it is deleted. So every push, pull request, comment and issue happens only on Al-khair's word. For branches and commits, see the `git-workflow` skill.

## The set-up (checked 14 Nov 2026)

- **The remote** is `origin`: `https://github.com/hizWindy/contour.git`.
- **Pushing** works through git's own sign-in on this laptop.
- **The `gh` CLI** is installed (2.103.3) but not signed in. Al-khair signs in himself: `! gh auth login` in Claude Code. Never ask for, read or store a token.
- **Public or private** is **TBC** (to be confirmed). Until it is known, write every push, title and comment as if anyone can read it.
- **No GitHub Actions** (no `.github/` folder). The checks run on the laptop: the pre-commit hook, and the `merge-check` skill before a merge.
- **Pushing doesn't deploy.** App Platform's `deploy_on_push` is false: someone presses Deploy.

## Never on GitHub

- Keys, tokens or `engine/.env`.
- Client data: HubSpot names, contacts, call notes, `projects/leads/research/COMPANIES.xlsx`, and the screenshots in `plan/shots/`.
- The same goes for the words in a pull request, a comment or an issue. Use made-up examples, like "ABC Logistics, Perth, 300 staff".
- An `@name` only for a real GitHub login you mean to notify. Put roles and code in backticks, like `@types/node`.

## Pushing

- **`master`:** only with the go signal `deploy vNN`. Never force-push it.
- **A working branch:** push it to back it up or to open a pull request, on Al-khair's word: `git push -u origin <branch>`, then `git push` after that. Force-push only your own unmerged branch, with `--force-with-lease`, on his word.
- **Look first.** Before any push, see what will go: `git log --oneline origin/<branch>..<branch>` (or `origin/master..<branch>` for a new branch) and `git diff --stat` over the same range. Check nothing from "Never on GitHub" is in it.

## Pull requests

The usual flow is local: the `merge-check` skill, then `master` fast-forwards on Al-khair's word. A pull request helps when someone else should read the change on GitHub, or for a record.

1. **Push the branch** (above).
2. **Open it:** `gh pr create --base master --head <branch> --title "<plain title>" --body-file <file>`. The body says, in plain words:
   - what changed and why (answer first);
   - the plan step;
   - the checks run, with their results;
   - what wasn't checked;
   - at the end, the attribution lines your session gives.
3. **Review it:** run the `review-agent` on the branch. Post its verdict with `gh pr review <number> --comment --body-file <file>`, on Al-khair's word.
4. **Merge it the local way,** so `master` keeps the same commits: `git merge --ff-only <branch>` in the main folder, then push `master` with the deploy. GitHub marks the pull request merged by itself. Don't use GitHub's merge buttons: each one makes a new commit (a merge, a squash or rebased copies), so `master` would no longer match the commits that were checked.
5. **Tidy up** on his word: `git push origin --delete <branch>`, then the local cleanup in `git-workflow`.

## Tags and releases

Tags like `v15-api` mark hand-offs between local tracks. They stay local unless Al-khair wants them on GitHub (`git push origin <tag>`). No GitHub releases for now.

## If something sensitive was pushed

1. Stop, and tell Al-khair at once.
2. Treat a pushed key as leaked: make a new one with its provider, and put it in `engine/.env` and in App Platform's settings. Deleting the commit doesn't make the old key safe.
3. Rewrite history only on his say, and only after the key is changed.
