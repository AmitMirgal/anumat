#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$root"
dist=${1:-dist}

export DATABASE_URL="${DATABASE_URL:-postgres://anumat:anumat@127.0.0.1:5432/anumat_engine}"
export ANUMAT_MIGRATION_SQL="${ANUMAT_MIGRATION_SQL:-packages/db/prisma/migrations/20260929061425_init/migration.sql}"

bash scripts/require-local-postgres.sh
node packages/engine/scripts/ensure-smoke-database.mjs

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
} < <(bash scripts/release/make-smoke-venv.sh anumat-engine-smoke)
if [[ -z "$smoke_work" || -z "${smoke_python:-}" || ! -x "$smoke_python" ]]; then
  echo "failed to create the engine smoke virtualenv" >&2
  exit 1
fi
case "$smoke_python" in
  "$smoke_work"/*) ;;
  *)
    echo "smoke python is not inside the owned workspace" >&2
    exit 1
    ;;
esac
uv pip install -q --python "$smoke_python" "$wheel"
"$smoke_python" packages/engine-py/scripts/smoke.py
