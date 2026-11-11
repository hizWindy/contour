"""Health checks for Admin's Health tab (PLAN-V13 T1-2): is each system working?

One check for each system: the database, Claude, HubSpot, Signal Hire, email, the runs, the
schedules and the API. Each gives a state (`ok`, `problem` or `off`), one plain sentence, what
to do next when there is a problem, the time it took and when it ran.

**The rules every check keeps:**
- **Free.** No check spends money. Claude is asked for its model list, never for an answer.
  Signal Hire is asked for its credit balance. HubSpot gets the permission probes the HubSpot tab
  already makes (they change nothing). No email is sent.
- **5 seconds at most**, and all at the same time (`run.run_checks`), so one slow system never
  holds up the others. A check that is still going at 5 seconds is stopped and says so.
- **No error text from outside.** A sentence is fixed words and our own numbers, never an
  exception's text, which could hold a key or a person's data. The details go to the backend log.
- **A problem means it needs you.** Something planned and passing, like the minute or two a new
  backend waits to take over the runs after a deploy, is said plainly but isn't a problem.
- **Never in the way.** The checks change nothing. "Check again" pressed while a check is going gets
  that check's answer, not a second one. Counting the API's requests can't fail a request.

`GET /api/v1/health/details` (core/api/health.py) runs them for an Admin, and keeps the answer for
60 seconds so a page refresh doesn't check again. `GET /api/v1/health` stays the plain up check.
"""
