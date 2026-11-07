#!/usr/bin/env bash
set -euo pipefail

version=${1:?version}
action=${2:?action description}
cancel=${3:-Cancelled. Nothing was published or tagged.}

read -r -p "Type ${version} to ${action}: " answer
if [[ "$answer" != "$version" ]]; then
  echo "$cancel" >&2
  exit 1
fi
