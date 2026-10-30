#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
target=${1:?bun target}
platform=${2:?wheel platform tag}
binary_name=${3:?binary file name}
out=${4:-"$root/dist"}
stage="$root/packages/engine-py/src/anumat_engine/bin"

cleanup() {
  rm -rf "$stage"
}
trap cleanup EXIT

rm -rf "$stage"
mkdir -p "$stage"
outfile="$stage/$binary_name"
if [[ "$binary_name" == *.exe ]]; then
  outfile="$stage/${binary_name%.exe}"
fi

bun "$root/packages/engine-py/scripts/compile-sidecar.ts" "$target" "$outfile"
if [[ "$binary_name" == *.exe && -f "${outfile}.exe" && ! -f "$stage/$binary_name" ]]; then
  mv "${outfile}.exe" "$stage/$binary_name"
fi
if [[ ! -f "$stage/$binary_name" ]]; then
  echo "Compile did not write $stage/$binary_name" >&2
  exit 1
fi
chmod +x "$stage/$binary_name" || true

export ANUMAT_ENGINE_PLATFORM="$platform"
mkdir -p "$out"
uv build --wheel --package anumat-engine --out-dir "$out"
