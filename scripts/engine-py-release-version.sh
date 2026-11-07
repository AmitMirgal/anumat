#!/usr/bin/env bash
set -euo pipefail

# Source of truth is packages/engine-py (what pnpm bump:engine:version writes).
# Do not read the JavaScript engine package version. Do not write manifests.
# Registry existence is checked later against artifact hashes, not here.

version=$(uv version --short --directory packages/engine-py)
if [[ -z "$version" ]]; then
  echo "Could not read the anumat-engine version from packages/engine-py." >&2
  exit 1
fi
printf '%s\n' "$version"
