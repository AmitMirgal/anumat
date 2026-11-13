#!/usr/bin/env bash
set -euo pipefail

# Install the native wheel in an owned venv, start the sidecar, and convert a
# text PDF. Does not start Docker or Postgres.

root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$root"
dist=${1:-dist}

python_bin=python3
if ! command -v python3 >/dev/null 2>&1; then
  python_bin=python
fi
wheel=$("$python_bin" scripts/release/select_native_wheel.py "$dist")

smoke_work=
cleanup() {
  if [[ -n "${smoke_work:-}" ]]; then
    rm -rf "$smoke_work"
  fi
}
trap cleanup EXIT
{
  IFS= read -r smoke_work
  IFS= read -r smoke_python
} < <(bash scripts/release/make-smoke-venv.sh anumat-engine-convert-smoke)
if [[ -z "$smoke_work" || -z "${smoke_python:-}" || ! -x "$smoke_python" ]]; then
  echo "failed to create the engine convert-smoke virtualenv" >&2
  exit 1
fi
case "$smoke_python" in
  "$smoke_work"/*) ;;
  *)
    echo "convert-smoke python is not inside the owned workspace" >&2
    exit 1
    ;;
esac
uv pip install -q --python "$smoke_python" "$wheel"
"$smoke_python" packages/engine-py/scripts/convert_smoke.py
