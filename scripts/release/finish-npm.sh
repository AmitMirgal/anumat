#!/usr/bin/env bash
set -euo pipefail

# After tests and pack checks: compare the local pack to npm, publish only when
# the version is absent, otherwise tag-only when hashes match. Never pushes.

root=$(cd "$(dirname "$0")/../.." && pwd)
name=${1:?package name}
version=${2:?version}
package_dir=${3:?package directory}
tag=${4:?git tag}

meta=$(bash "$root/scripts/release/npm-pack-meta.sh" "$package_dir")
integrity=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("integrity") or "")' "$meta")
shasum=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("shasum") or "")' "$meta")
if [[ -z "$integrity" && -z "$shasum" ]]; then
  echo "npm pack JSON is missing integrity and shasum" >&2
  exit 1
fi

status=$(python3 "$root/scripts/release/registry.py" npm-status --name "$name" --version "$version")
if [[ "$status" == present ]]; then
  python3 "$root/scripts/release/registry.py" compare-npm \
    --name "$name" --version "$version" --integrity "$integrity" --shasum "$shasum"
  bash "$root/scripts/release/confirm-version.sh" "$version" \
    "create local tag ${tag} (already on npm; pack matches)" \
    "Cancelled. Nothing was tagged."
  bash "$root/scripts/release/tag-local.sh" "$tag"
  exit 0
fi
if [[ "$status" != absent ]]; then
  echo "npm status was ${status}, expected present or absent" >&2
  exit 1
fi

if ! npm whoami >/dev/null; then
  echo "Run npm login first." >&2
  exit 1
fi
bash "$root/scripts/release/confirm-version.sh" "$version" \
  "publish ${name} ${version} and create local tag ${tag}" \
  "Cancelled. Nothing was published."
pnpm --filter "$name" publish --access public --no-git-checks
bash "$root/scripts/release/tag-local.sh" "$tag"
