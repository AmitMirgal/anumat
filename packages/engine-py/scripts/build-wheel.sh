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
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
else
  PYTHON=python
fi
"$PYTHON" - "$stage/$binary_name" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = bytearray(path.read_bytes())

def blank(needle: bytes) -> None:
    start = 0
    while True:
        idx = data.find(needle, start)
        if idx < 0:
            return
        end = idx
        while end < len(data) and 32 <= data[end] < 127:
            end += 1
        for offset in range(idx, end):
            data[offset] = ord("x")
        start = end

for needle in (b"/home/", b"/Users/", b"C:\\Users", b"C:/Users"):
    blank(needle)
username = b"amitmirgal"
lower = bytes(data).lower()
start = 0
while True:
    idx = lower.find(username, start)
    if idx < 0:
        break
    for offset in range(idx, idx + len(username)):
        data[offset] = ord("x")
    lower = bytes(data).lower()
    start = idx + len(username)
path.write_bytes(data)
raw = bytes(data)
lower = raw.lower()
for needle in (b"/home/", b"/Users/", b"C:\\Users", b"C:/Users"):
    if needle in raw:
        raise SystemExit(f"binary contains {needle!r}")
if username in lower:
    raise SystemExit("binary contains a local username")
PY

export ANUMAT_ENGINE_PLATFORM="$platform"
mkdir -p "$out"
uv build --wheel --package anumat-engine --out-dir "$out"
