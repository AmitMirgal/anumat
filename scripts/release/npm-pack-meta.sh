#!/usr/bin/env bash
set -euo pipefail

# Pack a JS package into a temp dir and print one npm pack JSON object with
# filename, shasum, and integrity. Runs prepack. Not a publish.

package_dir=${1:?package directory}
if [[ ! -f "$package_dir/package.json" ]]; then
  echo "missing $package_dir/package.json" >&2
  exit 1
fi
dir=$(mktemp -d "${TMPDIR:-/tmp}/anumat-npm-pack.XXXXXX")
cleanup() {
  rm -rf "$dir"
}
trap cleanup EXIT
json=$(
  cd "$package_dir"
  npm pack --json --pack-destination "$dir"
)
python3 -c 'import json,sys; data=json.loads(sys.argv[1]); print(json.dumps(data[0] if isinstance(data, list) else data))' "$json"
