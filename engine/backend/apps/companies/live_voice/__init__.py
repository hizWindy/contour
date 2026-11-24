"""Live voice (PLAN-V28): the Assistant talks back, through Gemini 3.8 Live.

The browser sends the rep's sound to our server, and the relay passes it to Google and Google's
voice back, so the key never leaves the server and every token is counted against the month's
limit. Claude still writes every card: Gemini asks the browser through one tool, `ask_contour`,
and the browser runs it with today's command step.

- `models.py`: the talk's row, `companies.voice_sessions` (counts only: no sound, no words, no
  names); `store.py` reads and writes it.
- `service.py`: starting a talk (the checks, in the plan's order), opening its socket, and the
  month's line for Admin settings; `api.py` has the routes.
- `talks.py`: the talks in this backend (one a person, 10 at once).
- `relay.py`: one talk's relay; `google_live.py` the connection to Google; `setup.py` and
  `instruction.md` what Google is told; `messages.py` the socket's messages.
- `meter.py` and `pricing.py`: the tokens Google reports, in US dollars.
- `words.py`: what a person reads.
"""
