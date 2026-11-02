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
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "python is required to check the sidecar binary" >&2
  exit 1
fi
"$PYTHON" - "$stage/$binary_name" "$root" <<'PY'
import subprocess
import sys
from pathlib import Path

path = Path(sys.argv[1])
root = sys.argv[2]
data = path.read_bytes()
needles = [root.encode()]


def cygpath(flag: str) -> str:
    try:
        completed = subprocess.run(
            ["cygpath", flag, root],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return ""
    if completed.returncode != 0:
        return ""
    return completed.stdout.strip()


for flag in ("-w", "-m"):
    form = cygpath(flag)
    if not form:
        continue
    needles.append(form.encode())
    needles.append(form.replace("\\", "\\\\").encode())
for needle in needles:
    if needle and needle in data:
        raise SystemExit(f"binary contains the repo root path {needle!r}")
if b"amitmirgal" in data.lower():
    raise SystemExit("binary contains a local username")
PY
startup=$(mktemp)
"$stage/$binary_name" --help >"$startup" 2>&1 || true
cat "$startup"
if ! grep -q "Usage: anumat-engine" "$startup"; then
  echo "compiled sidecar did not start" >&2
  rm -f "$startup"
  exit 1
fi
rm -f "$startup"

export ANUMAT_ENGINE_PLATFORM="$platform"
mkdir -p "$out"
uv build --wheel --package anumat-engine --out-dir "$out"
