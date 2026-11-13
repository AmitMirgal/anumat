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
if [[ ! -f "$stage/anydoc.node" ]]; then
  echo "Compile did not write $stage/anydoc.node" >&2
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
# bun --compile on darwin can leave an ad-hoc signature the kernel rejects.
# macOS then SIGKILLs the process (Killed: 9, exit 137) before any JavaScript
# runs. Re-sign a Mach-O binary on the build host so --help is a real startup
# check. A cross-compiled binary still cannot be executed here; that is not a
# SyntaxError, so the embedded entry module is checked instead.
if [[ "$(uname -s)" == "Darwin" ]] && command -v codesign >/dev/null 2>&1; then
  magic=$(od -An -t x1 -N 4 "$stage/$binary_name" 2>/dev/null | tr -d ' \n' | tr 'A-F' 'a-f' || true)
  case "$magic" in
    cffaedfe|feedfacf|cefaedfe|feedface|cafebabe)
      codesign --remove-signature "$stage/$binary_name" >/dev/null 2>&1 || true
      if ! codesign --force --sign - "$stage/$binary_name" >/dev/null 2>&1; then
        echo "ad-hoc codesign failed; --help may be SIGKILLed" >&2
      fi
      ;;
  esac
fi
startup=$(mktemp)
set +e
"$stage/$binary_name" --help >"$startup" 2>&1
status=$?
set -e
if grep -q "Usage: anumat-engine" "$startup" && ! grep -Eq "SyntaxError|Unexpected EOF" "$startup"; then
  cat "$startup"
  rm -f "$startup"
elif [[ "$status" -eq 137 || "$status" -eq 126 || "$status" -eq 127 ]]; then
  if [[ "$status" -eq 137 ]]; then
    reason="SIGKILL (Killed: 9). The OS stopped the unsigned compiled binary before JavaScript ran"
  else
    reason="the host cannot execute this binary (exit ${status})"
  fi
  echo "compiled sidecar was not executed: ${reason}. Checking the embedded entry module for a SyntaxError." >&2
  if [[ -s "$startup" ]]; then
    cat "$startup" >&2
  fi
  rm -f "$startup"
  "$PYTHON" "$root/packages/engine-py/scripts/check-sidecar-syntax.py" "$stage/$binary_name"
else
  echo "compiled sidecar did not start (exit ${status})" >&2
  cat "$startup" >&2
  rm -f "$startup"
  exit 1
fi

sha_file="$root/packages/engine/.sidecar/migration.sha256"
if [[ ! -f "$sha_file" ]]; then
  echo "missing migration checksum $sha_file" >&2
  exit 1
fi
export ANUMAT_ENGINE_PLATFORM="$platform"
mkdir -p "$out"
cp "$sha_file" "$out/migration.sha256"
uv build --wheel --package anumat-engine --out-dir "$out"
