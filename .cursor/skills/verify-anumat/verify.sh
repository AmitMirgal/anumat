#!/usr/bin/env bash
# Launch, check, and stop one Anumat verification server.
# Specified in SKILL.md. Invoke from anywhere:
#   .cursor/skills/verify-anumat/verify.sh launch
#   .cursor/skills/verify-anumat/verify.sh doctor
#   .cursor/skills/verify-anumat/verify.sh cleanup
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
RUN_DIR="$SKILL_DIR/run"
EVIDENCE_DIR="$SKILL_DIR/evidence"
STATE="$RUN_DIR/state.env"
SESSION="anumat-verify"
VERIFY_KEY="anumat-local-verify-key"
DATABASE_URL="postgres://anumat:anumat@127.0.0.1:5432/anumat"

usage() {
  echo "usage: verify.sh launch|doctor|cleanup" >&2
  exit 2
}

ensure_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 24 >&2
    nvm use 24 >&2
    local node24
    node24="$(nvm which 24)"
    export PATH="$(dirname "$node24"):$PATH"
    hash -r
  fi
  local ver
  ver="$(node -v)"
  if [[ "$ver" != v24.* ]]; then
    echo "Node 24 is required (.nvmrc). Found $ver at $(command -v node)." >&2
    exit 1
  fi
}

ensure_postgres() {
  POSTGRES_STARTED=0
  POSTGRES_CONTAINER=""
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    if ! psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
      echo "Postgres is listening on 127.0.0.1:5432 but $DATABASE_URL failed. Not stopping that server." >&2
      exit 1
    fi
    echo "postgres already accepting connections on 127.0.0.1:5432; not starting or stopping it" >&2
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "Postgres is not accepting connections on 127.0.0.1:5432 and docker is not available. Not starting a replacement." >&2
    exit 1
  fi
  POSTGRES_CONTAINER="anumat-verify-postgres"
  docker run -d --name "$POSTGRES_CONTAINER" -p 5432:5432 \
    -e POSTGRES_USER=anumat -e POSTGRES_PASSWORD=anumat -e POSTGRES_DB=anumat postgres:16
  POSTGRES_STARTED=1
  local i
  for i in $(seq 1 30); do
    if psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
    echo "The verification Postgres container did not become ready. Not touching any other server." >&2
    exit 1
  fi
  if ! docker exec "$POSTGRES_CONTAINER" psql -U anumat -d anumat -tAc "SELECT 1 FROM pg_database WHERE datname = 'anumat_test'" | grep -q 1; then
    docker exec "$POSTGRES_CONTAINER" createdb -U anumat anumat_test
  fi
}

listener_pid() {
  local port="$1" pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  printf '%s\n' "$pids" | awk 'NR == 1 { gsub(/ /, ""); print }'
}

choose_port() {
  PORT=4471
  PORT_NOTE=""
  local holder args
  holder="$(listener_pid 4471)"
  if [[ -z "$holder" ]]; then
    return 0
  fi
  args="$(ps -p "$holder" -o args= 2>/dev/null || true)"
  PORT=4472
  while [[ -n "$(listener_pid "$PORT")" ]]; do
    PORT=$((PORT + 1))
    if [[ "$PORT" -gt 4500 ]]; then
      echo "no free verification port between 4472 and 4500" >&2
      exit 1
    fi
  done
  if [[ "$args" == *src/main.ts* ]]; then
    PORT_NOTE="port 4471 is already taken by pid ${holder} (anumat); verification instance is on ${PORT}"
  else
    PORT_NOTE="port 4471 is already taken by pid ${holder}; verification instance is on ${PORT}"
  fi
  echo "$PORT_NOTE" >&2
}

write_state() {
  mkdir -p "$RUN_DIR"
  cat >"$STATE" <<EOF
PORT=${PORT}
PID=${PID:-}
SLUG=${SLUG}
DATA_DIR=${DATA_DIR}
BASE_URL=${BASE_URL}
SESSION=${SESSION}
POSTGRES_STARTED=${POSTGRES_STARTED}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER}
EOF
}

is_descendant() {
  local root="$1" needle="$2" child
  [[ "$root" == "$needle" ]] && return 0
  for child in $(ps -o pid= --ppid "$root" 2>/dev/null); do
    if is_descendant "$child" "$needle"; then
      return 0
    fi
  done
  return 1
}

kill_tree() {
  local pid="$1" sig="$2" child args
  if [[ -z "$pid" || "$pid" -le 1 ]]; then
    return 0
  fi
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  if [[ "$args" == *postgres* ]]; then
    echo "refusing to kill postgres pid $pid" >&2
    return 0
  fi
  for child in $(ps -o pid= --ppid "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

delete_run_rows() {
  local slug="$1"
  local relation
  relation="$(psql "$DATABASE_URL" -tAc "select to_regclass('public.payers')" || true)"
  if [[ "$relation" != "payers" ]]; then
    echo "cleanup: payers table is absent; skipped row delete" >&2
    return 0
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v slug="$slug" <<'SQL'
BEGIN;
DELETE FROM watch_runs
WHERE source_id IN (
  SELECT s.id FROM policy_sources s
  JOIN payers p ON p.id = s.payer_id
  WHERE p.slug = :'slug'
);
DELETE FROM policy_documents d
WHERE d.artifact_id IN (
  SELECT a.id FROM policy_artifacts a
  JOIN policy_sources s ON s.id = a.source_id
  JOIN payers p ON p.id = s.payer_id
  WHERE p.slug = :'slug'
)
AND NOT EXISTS (SELECT 1 FROM policy_versions v WHERE v.document_id = d.id);
DELETE FROM policy_artifacts a
WHERE a.source_id IN (
  SELECT s.id FROM policy_sources s
  JOIN payers p ON p.id = s.payer_id
  WHERE p.slug = :'slug'
)
AND NOT EXISTS (SELECT 1 FROM policy_documents d WHERE d.artifact_id = a.id);
DELETE FROM policy_sources s
USING payers p
WHERE s.payer_id = p.id
  AND p.slug = :'slug'
  AND NOT EXISTS (SELECT 1 FROM policy_versions v WHERE v.source_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM policy_artifacts a WHERE a.source_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM watch_runs w WHERE w.source_id = s.id);
DELETE FROM payers p
WHERE p.slug = :'slug'
  AND NOT EXISTS (SELECT 1 FROM policy_sources s WHERE s.payer_id = p.id);
COMMIT;
SQL
  local left
  left="$(psql "$DATABASE_URL" -tAc "select count(*) from payers where slug = '$slug'")"
  left="${left// /}"
  if [[ "$left" != "0" ]]; then
    echo "cleanup: left payer $slug in place because a source or version still references it; policy_versions and policy_diffs cannot be deleted" >&2
  fi
}

cmd_cleanup() {
  if [[ ! -f "$STATE" ]]; then
    echo "cleanup: no verification instance state"
    echo "cleanup: evidence directory kept at $EVIDENCE_DIR"
    return 0
  fi
  # shellcheck disable=SC1090
  source "$STATE"
  if [[ -n "${SESSION:-}" ]] && tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
  fi
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill_tree "$PID" TERM
    local i
    for i in $(seq 1 20); do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 0.25
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill_tree "$PID" KILL
    fi
  fi
  if [[ -n "${PORT:-}" ]]; then
    local i holder
    for i in $(seq 1 20); do
      holder="$(listener_pid "$PORT")"
      if [[ -z "$holder" ]]; then
        break
      fi
      sleep 0.25
    done
    holder="$(listener_pid "$PORT")"
    if [[ -n "$holder" ]]; then
      echo "cleanup: port $PORT is still held by pid $holder; not killing a process this run does not own" >&2
    fi
  fi
  if [[ -n "${SLUG:-}" ]]; then
    delete_run_rows "$SLUG"
  fi
  if [[ "${POSTGRES_STARTED:-0}" == "1" && -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker rm -f "$POSTGRES_CONTAINER" >/dev/null
  fi
  if [[ -n "${DATA_DIR:-}" && "$DATA_DIR" == /tmp/anumat-verify-* ]]; then
    rm -rf "$DATA_DIR"
  fi
  rm -rf "$RUN_DIR"
  echo "cleanup stopped session ${SESSION:-anumat-verify}"
  echo "cleanup: evidence directory kept at $EVIDENCE_DIR"
}

cmd_launch() {
  LAUNCH_FAILED=1
  trap 'status=$?; if [[ ${LAUNCH_FAILED:-0} == 1 ]]; then cmd_cleanup || true; fi; exit $status' EXIT

  command -v tmux >/dev/null
  command -v lsof >/dev/null
  command -v curl >/dev/null
  command -v psql >/dev/null
  command -v pg_isready >/dev/null

  if [[ -f "$STATE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE"
    if [[ -n "${SESSION:-}" ]] && tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "verification instance already running (session $SESSION, pid ${PID:-unknown}). Run cleanup before launching another." >&2
      LAUNCH_FAILED=0
      trap - EXIT
      exit 1
    fi
  fi

  ensure_node
  ensure_postgres
  choose_port

  local run_id
  run_id="$(date -u +%Y%m%dt%H%M%S)"
  SLUG="verify-${run_id}"
  DATA_DIR="/tmp/anumat-verify-${run_id}"
  BASE_URL="http://127.0.0.1:${PORT}"
  PID=""
  mkdir -p "$DATA_DIR" "$RUN_DIR"
  write_state

  cd "$ROOT"
  export DATABASE_URL
  export ANUMAT_API_KEYS="verify:${VERIFY_KEY}"
  export ANUMAT_LLM_MODE="replay"
  export HOST="127.0.0.1"
  export PORT
  export ANUMAT_DATA_DIR="$DATA_DIR"
  export ANUMAT_STORAGE="local"
  export LOG_LEVEL="info"
  export RATE_LIMIT_PER_MINUTE="120"
  unset FIRECRAWL_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY XAI_API_KEY ANUMAT_EVAL_LIVE || true

  pnpm install
  pnpm db:migrate
  pnpm db:seed

  cat >"$RUN_DIR/serve.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH='$PATH'
export DATABASE_URL='$DATABASE_URL'
export ANUMAT_API_KEYS='verify:${VERIFY_KEY}'
export ANUMAT_LLM_MODE='replay'
export HOST='127.0.0.1'
export PORT='$PORT'
export ANUMAT_DATA_DIR='$DATA_DIR'
export ANUMAT_STORAGE='local'
export LOG_LEVEL='info'
export RATE_LIMIT_PER_MINUTE='120'
unset FIRECRAWL_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY XAI_API_KEY ANUMAT_EVAL_LIVE || true
cd '$ROOT'
exec pnpm dev >>'$RUN_DIR/server.log' 2>&1
EOF
  chmod +x "$RUN_DIR/serve.sh"
  tmux new-session -d -s "$SESSION" -c "$ROOT" -- "$RUN_DIR/serve.sh"
  PID="$(tmux list-panes -t "$SESSION" -F '#{pane_pid}')"
  write_state

  local i health_code payers_code
  for i in $(seq 1 60); do
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "verification server exited during startup" >&2
      tail -n 80 "$RUN_DIR/server.log" >&2 || true
      exit 1
    fi
    if [[ -f "$RUN_DIR/server.log" ]] && grep -q "anumat listening" "$RUN_DIR/server.log"; then
      health_code="$(curl -sS -m 5 -o "$RUN_DIR/ready.json" -w "%{http_code}" "$BASE_URL/ready" || true)"
      payers_code="$(curl -sS -m 5 -o "$RUN_DIR/payers.json" -w "%{http_code}" -H "authorization: Bearer ${VERIFY_KEY}" "$BASE_URL/v1/payers?limit=1" || true)"
      if [[ "$health_code" == "200" && "$payers_code" == "200" ]] \
        && grep -q '"status":"ready"' "$RUN_DIR/ready.json" \
        && grep -q '"database":"up"' "$RUN_DIR/ready.json" \
        && grep -q '"llm_mode":"replay"' "$RUN_DIR/ready.json" \
        && grep -q '"items"' "$RUN_DIR/payers.json"; then
        LAUNCH_FAILED=0
        trap - EXIT
        if [[ -n "$PORT_NOTE" ]]; then
          echo "$PORT_NOTE"
        else
          echo "port ${PORT}"
        fi
        echo "ready url=${BASE_URL} pid=${PID} slug=${SLUG} llm_mode=replay"
        return 0
      fi
    fi
    sleep 1
  done
  echo "verification server did not become ready" >&2
  tail -n 80 "$RUN_DIR/server.log" >&2 || true
  exit 1
}

cmd_doctor() {
  ensure_node
  if [[ ! -f "$STATE" ]]; then
    echo "doctor: no state file; launch first" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$STATE"
  local fail=0
  note() {
    echo "doctor: $*" >&2
    fail=1
  }

  if [[ -z "${SESSION:-}" ]] || ! tmux has-session -t "$SESSION" 2>/dev/null; then
    note "tmux session ${SESSION:-anumat-verify} is not running"
  else
    local pane listen
    pane="$(tmux list-panes -t "$SESSION" -F '#{pane_pid}')"
    if [[ "$pane" != "$PID" ]]; then
      note "pane pid $pane does not match recorded pid $PID"
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      note "pid $PID is not alive"
    fi
    listen="$(listener_pid "$PORT")"
    if [[ -z "$listen" ]]; then
      note "nothing is listening on $PORT"
    elif ! is_descendant "$PID" "$listen"; then
      note "port $PORT is owned by pid $listen, not recorded pid $PID"
    fi
  fi

  local ver
  ver="$(node -v)"
  if [[ "$ver" != v24.* ]]; then
    note "node is $ver, expected v24"
  fi
  if [[ ! -f "$RUN_DIR/server.log" ]] || ! grep -q "anumat listening" "$RUN_DIR/server.log"; then
    note "server log has no anumat listening line"
  fi

  local health ready code
  health="$(curl -sS -m 5 "$BASE_URL/health" || true)"
  [[ "$health" == *'"status":"ok"'* ]] || note "GET /health returned ${health:-<empty>}"
  ready="$(curl -sS -m 5 "$BASE_URL/ready" || true)"
  [[ "$ready" == *'"status":"ready"'* && "$ready" == *'"database":"up"'* && "$ready" == *'"llm_mode":"replay"'* ]] || note "GET /ready returned ${ready:-<empty>}"
  code="$(curl -sS -m 5 -o "$RUN_DIR/doctor-payers.json" -w "%{http_code}" -H "authorization: Bearer ${VERIFY_KEY}" "$BASE_URL/v1/payers?limit=1" || true)"
  [[ "$code" == "200" ]] || note "authenticated GET /v1/payers returned ${code:-<empty>}"
  grep -q '"items"' "$RUN_DIR/doctor-payers.json" || note "authenticated payer list has no items array"
  code="$(curl -sS -m 5 -o "$RUN_DIR/doctor-unauth.json" -w "%{http_code}" "$BASE_URL/v1/payers" || true)"
  [[ "$code" == "401" ]] || note "unauthenticated GET /v1/payers returned ${code:-<empty>}"
  grep -q '"code":"unauthorized"' "$RUN_DIR/doctor-unauth.json" || note "unauthenticated response was not unauthorized"

  if [[ "$fail" -ne 0 ]]; then
    exit 1
  fi
  echo "doctor ok url=$BASE_URL pid=$PID node=$ver database=up llm_mode=replay auth=bearer"
}

case "${1:-}" in
  launch) cmd_launch ;;
  doctor) cmd_doctor ;;
  cleanup) cmd_cleanup ;;
  *) usage ;;
esac
