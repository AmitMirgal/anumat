#!/usr/bin/env bash
set -euo pipefail

# After tests and artifact checks: upload only missing PyPI files whose hashes
# are not already on the registry. Matching files are skipped. Mismatches are
# fatal. Never pushes tags.

root=$(cd "$(dirname "$0")/../.." && pwd)
name=${1:?package name}
version=${2:?version}
tag=${3:?git tag}
shift 3
if [[ "$#" -lt 1 ]]; then
  echo "finish-pypi.sh requires artifact files" >&2
  exit 1
fi

plan_json=$(python3 "$root/scripts/release/registry.py" pypi-plan --name "$name" --version "$version" -- "$@")
state=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["state"])' "$plan_json")
count=$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])["to_upload"]))' "$plan_json")

if [[ "$state" == complete ]]; then
  bash "$root/scripts/release/confirm-version.sh" "$version" \
    "create local tag ${tag} (already on PyPI; files match)" \
    "Cancelled. Nothing was tagged."
  bash "$root/scripts/release/tag-local.sh" "$tag"
  exit 0
fi

: "${PYPI_TOKEN:?PYPI_TOKEN is not set. Add it to the environment. Do not put it in the repo or .env.}"
if [[ "$state" == partial ]]; then
  action="publish ${count} remaining ${name} file(s) and create local tag ${tag}"
else
  action="publish ${name} ${version} and create local tag ${tag}"
fi
bash "$root/scripts/release/confirm-version.sh" "$version" "$action" "Cancelled. Nothing was published."
bash "$root/scripts/release/publish-pypi.sh" "$name" "$version" "$@"
bash "$root/scripts/release/tag-local.sh" "$tag"
