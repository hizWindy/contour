"""A browser our connectors drive, to read Property Daily (PLAN-V16 T2-3).

- `sites.py`: a site we may read: its hosts, the paths we never open, and how its sign-in page
  and its blocks look.
- `stops.py`: the stop rules, in plain code: what a page says about whether to go on.
- `worker.py`: one headless Chromium in a thread of its own, with its own event loop.
- `reader.py`: reads one site's pages through the worker, one at a time, at a slow pace, within
  the limits for a day and a run, and pauses the site for 24 hours at the first block.

Nothing here hides that it is a program. A site that blocks it is left alone until a person
resumes it.
"""
