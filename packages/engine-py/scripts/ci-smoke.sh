#!/usr/bin/env bash
set -euo pipefail

dist=${1:-dist}
export DATABASE_URL="${DATABASE_URL:-postgres://anumat:anumat@127.0.0.1:5432/anumat_engine}"
export ANUMAT_MIGRATION_SQL="${ANUMAT_MIGRATION_SQL:-packages/db/prisma/migrations/20260929061425_init/migration.sql}"

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Postgres is not running, and Docker is not available to start it." >&2
    exit 1
  fi
  docker rm -f anumat-pg >/dev/null 2>&1 || true
  docker run -d --name anumat-pg \
    -e POSTGRES_USER=anumat \
    -e POSTGRES_PASSWORD=anumat \
    -e POSTGRES_DB=anumat_engine \
    -p 5432:5432 \
    postgres:16 >/dev/null
  ready=0
  for _ in $(seq 1 30); do
    if docker exec anumat-pg pg_isready -U anumat >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != 1 ]]; then
    echo "Postgres did not become ready." >&2
    exit 1
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  bindir=$(mktemp -d)
  cat >"$bindir/psql" <<'SH'
#!/bin/sh
exec docker exec -i anumat-pg psql "$@"
SH
  chmod +x "$bindir/psql"
  export PATH="$bindir:$PATH"
fi

wheel=$(ls "$dist"/*.whl)
uv venv /tmp/anumat-engine-smoke --clear -q
uv pip install -q --python /tmp/anumat-engine-smoke "$wheel"
if [[ -x /tmp/anumat-engine-smoke/Scripts/python.exe ]]; then
  smoke_python=/tmp/anumat-engine-smoke/Scripts/python.exe
else
  smoke_python=/tmp/anumat-engine-smoke/bin/python
fi
"$smoke_python" packages/engine-py/scripts/smoke.py
