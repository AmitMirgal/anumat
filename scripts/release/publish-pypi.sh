#!/usr/bin/env bash
set -euo pipefail

# Re-plan local files against PyPI, then upload only files that are absent.
# Matching hashes are skipped. Mismatched hashes are fatal. Does not bump
# versions. Token is passed to uv through UV_PUBLISH_TOKEN, not argv.

root=$(cd "$(dirname "$0")/../.." && pwd)
name=${1:?package name}
version=${2:?version}
shift 2
if [[ "$#" -lt 1 ]]; then
  echo "publish-pypi.sh requires at least one file" >&2
  exit 1
fi

plan_json=$(python3 "$root/scripts/release/registry.py" pypi-plan --name "$name" --version "$version" -- "$@")
mapfile -t to_upload < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])["to_upload"]))' "$plan_json")
state=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["state"])' "$plan_json")

if [[ "$state" == complete || "${#to_upload[@]}" -eq 0 || -z "${to_upload[0]:-}" ]]; then
  echo "$name $version is already on PyPI and local files match."
  exit 0
fi

: "${PYPI_TOKEN:?PYPI_TOKEN is not set. Add it to the environment. Do not put it in the repo or .env.}"

uv_bin=${ANUMAT_UV:-uv}
export UV_PUBLISH_TOKEN="$PYPI_TOKEN"
for file in "${to_upload[@]}"; do
  if [[ -z "$file" ]]; then
    continue
  fi
  echo "Uploading $(basename "$file")"
  "$uv_bin" publish "$file"
done
unset UV_PUBLISH_TOKEN
