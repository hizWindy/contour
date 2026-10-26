"""The steps of a Lead Finder run, as plain functions.

Each step takes plain values and returns plain values, so it is tested without LangGraph, a
database or Claude. The graph (a later package) wraps them in nodes.

- `plan`: the slices of a discovery run, the watchlist batches and the size check.
- `discover`: one slice, one Claude request with web tools, then the checks on the answer.
- `merge`: the same company found twice becomes one, with every signal kept.
- `choose`: which merged companies to research, and which to skip and why.

This file imports nothing, so importing one step never loads the others.
"""
