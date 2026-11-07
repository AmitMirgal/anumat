#!/usr/bin/env bash
set -euo pipefail

# Source of truth is packages/engine-py (what pnpm bump:engine:version writes).
# Do not read the JavaScript engine package version. Do not write manifests.
name="anumat-engine"
version=$(uv version --short --directory packages/engine-py)
if curl -sf "https://pypi.org/pypi/$name/$version/json" >/dev/null; then
  echo "$name $version is already on PyPI. Bump anumat-engine first with pnpm bump:engine:version." >&2
  exit 1
fi
printf '%s\n' "$version"
