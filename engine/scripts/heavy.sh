#!/usr/bin/env bash
# Runs one heavy job at a time on this laptop, across both worktrees (PLAN-V6, "Two accounts").
# A full test run, a browser check or a Docker build each uses most of the memory, so the other
# track's job waits here until the lock is free.
#
#   bash engine/scripts/heavy.sh uv run --no-sync pytest
#
# The lock is a folder (making one is atomic). A lock older than 45 minutes is left over from a
# job that died, and is taken over.
set -u
LOCK="${HOME}/.contour-heavy.lock"
STALE_MINUTES=45

until mkdir "$LOCK" 2>/dev/null; do
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +"$STALE_MINUTES" 2>/dev/null)" ]; then
    echo "heavy.sh: taking over a lock older than ${STALE_MINUTES} minutes" >&2
    rm -rf "$LOCK"
    continue
  fi
  echo "heavy.sh: waiting for: $(cat "$LOCK/owner" 2>/dev/null || echo 'another job')" >&2
  sleep 20
done
trap 'rm -rf "$LOCK"' EXIT INT TERM
echo "$(basename "$PWD") since $(date +%H:%M): $*" > "$LOCK/owner"
"$@"
