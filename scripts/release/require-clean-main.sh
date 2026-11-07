#!/usr/bin/env bash
set -euo pipefail

# Refuse to run a package release unless this checkout is a clean main that
# matches origin/main. Does not push.

if [[ "$(git branch --show-current)" != main ]]; then
  echo "Switch to main first." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi
git fetch -q origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "main is not in sync with GitHub. Pull first." >&2
  exit 1
fi
