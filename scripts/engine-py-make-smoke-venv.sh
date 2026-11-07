#!/usr/bin/env bash
set -euo pipefail

# Create an owned workspace and a venv *subdirectory* that does not exist yet.
# uv will not recreate a leftover directory that is not a virtualenv. This
# script never force-clears an existing path. Prints two lines:
#   workspace
#   python
# The caller must delete the workspace. This script does not touch any
# pre-existing path such as /tmp/anumat-engine-smoke.

work=$(mktemp -d "${TMPDIR:-/tmp}/anumat-engine-smoke.XXXXXX")
fail_cleanup() {
  rm -rf "$work"
}
trap fail_cleanup EXIT

uv venv "$work/venv" -q

python=""
if [[ -x "$work/venv/Scripts/python.exe" ]]; then
  python="$work/venv/Scripts/python.exe"
elif [[ -x "$work/venv/bin/python" ]]; then
  python="$work/venv/bin/python"
else
  echo "uv venv did not write a python executable under $work/venv" >&2
  exit 1
fi

trap - EXIT
printf '%s\n%s\n' "$work" "$python"
