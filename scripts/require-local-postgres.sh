#!/usr/bin/env bash
set -euo pipefail

# Read-only check that the documented disposable Postgres is accepting TCP.
# Does not start Docker, drop databases, terminate sessions, or create roles.

host="${ANUMAT_POSTGRES_HOST:-127.0.0.1}"
port="${ANUMAT_POSTGRES_PORT:-5432}"

print_setup() {
  cat >&2 <<EOF
Postgres is not accepting connections at ${host}:${port}.
anumat-engine tests need the documented disposable Postgres (role anumat / anumat).
They recreate only database anumat_engine_parity. They do not drop anumat or anumat_test.

Start it with the README commands, then run the tests or release again:

docker run -d --name anumat-postgres -p 5432:5432 \\
  -e POSTGRES_USER=anumat -e POSTGRES_PASSWORD=anumat -e POSTGRES_DB=anumat postgres:16
docker exec anumat-postgres createdb -U anumat anumat_test

If that container already exists: docker start anumat-postgres

The policy-case test also needs psql on PATH. This check does not start Postgres
or change any database.
EOF
}

if python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(3)
try:
    sock.connect((host, port))
except OSError:
    raise SystemExit(1)
finally:
    sock.close()
PY
then
  exit 0
fi

print_setup
exit 1
