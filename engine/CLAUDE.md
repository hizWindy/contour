# Claude Code

Read [AGENTS.md](AGENTS.md) before changing anything in `engine/`. It has the commands, the folder map and the coding practices.

- To run the app, start the **real** backend (`uv run engine serve`, or `backend` in `.claude/launch.json`). Start the fake one (`backend-fake`) only when asked by name. Both use port 8000, so check what holds it first. See "Which backend is running" in AGENTS.md.
- Website work follows [DESIGN.md](DESIGN.md).
- Documents follow the plain-words rules in [../CLAUDE.md](../CLAUDE.md).
