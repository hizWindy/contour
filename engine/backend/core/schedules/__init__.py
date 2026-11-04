"""Schedules: jobs that start on their own (PLAN-V6 Part D).

- `calc`: when a schedule runs next (pure: no database, no clock), daylight saving included.
- `models`: the `core.schedules` table.
- `jobs`: what a project (or the core) offers to run on a schedule.
- `service`: the table's reads and writes.
- `runner`: the loop that checks once a minute and starts what is due.
"""
