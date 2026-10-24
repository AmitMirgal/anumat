---
name: verify-anumat
description: "Drive the Anumat HTTP API (no web UI) and prove payer, source, check, review, and publish behavior. Use when changing routes, bearer auth, migrations, or the local run steps, or when asked to verify Anumat."
---

# Verify Anumat

Anumat's primary surface is the HTTP API. There is no web UI. Drive it with `curl` against a server this skill started. The feature map in `features/` is the maintained list of journeys. Run `doctor` before a drive whenever the server looks wrong.

The bearer key for this instance is the name `verify` and the secret `anumat-local-verify-key` (`ANUMAT_API_KEYS=verify:anumat-local-verify-key`). Send `Authorization: Bearer anumat-local-verify-key`. Do not print that header into evidence. Do not create or overwrite `.env`. Exported variables win over `--env-file-if-exists=.env`.

Two processes can listen on different ports and use different `ANUMAT_DATA_DIR` values, but they share the `anumat` Postgres database. Do not launch a second verification instance while one is running, and do not drive an Anumat process this run did not start.

## Launch

From the repo root:

```bash
.cursor/skills/verify-anumat/verify.sh launch
```

Launch refuses to start when the `anumat-verify` tmux session is already up. Run cleanup first.

What launch does, in order:

1. Require Node 24 (`.nvmrc`). When nvm is installed, run `nvm install 24` and `nvm use 24`, then prepend that Node's bin directory to `PATH` so a different `node` earlier on `PATH` is not used. `node -v` must print `v24` something.
2. If `pg_isready -h 127.0.0.1 -p 5432` succeeds and `psql postgres://anumat:anumat@127.0.0.1:5432/anumat -c 'select 1'` succeeds, use that server. Do not start another Postgres and do not stop it. If nothing is accepting connections, start only the container named `anumat-verify-postgres` with the README `docker run` (`POSTGRES_USER=anumat`, `POSTGRES_PASSWORD=anumat`, `POSTGRES_DB=anumat`, port 5432) and create `anumat_test` inside that container. If Postgres is listening but the `anumat` role cannot connect, stop and leave that process alone.
3. Listen on `127.0.0.1:4471` unless something is already bound there. If it is, do not kill it. When the listener's command line contains `src/main.ts`, it is an Anumat this run did not start: pick the next free port from 4472 upward and print `port 4471 is already taken by pid <pid> (anumat); verification instance is on <port>`. If the listener is not Anumat, print the same sentence without `(anumat)`. Every later request uses the printed URL, not a hardcoded 4471.
4. Create `/tmp/anumat-verify-<utc-compact-timestamp>` and a slug `verify-<that timestamp>`. Record both in `.cursor/skills/verify-anumat/run/state.env`.
5. Export `DATABASE_URL=postgres://anumat:anumat@127.0.0.1:5432/anumat`, `ANUMAT_API_KEYS=verify:anumat-local-verify-key`, `ANUMAT_LLM_MODE=replay`, `HOST=127.0.0.1`, `PORT` as chosen above, `ANUMAT_DATA_DIR` as the new directory, `ANUMAT_STORAGE=local`, `LOG_LEVEL=info`, and `RATE_LIMIT_PER_MINUTE=120`. Unset `FIRECRAWL_API_KEY` and provider keys for this process only. Replay is a documented mode: checks still fetch and convert PDFs, and they do not call a model provider.
6. Run `pnpm install`, `pnpm db:migrate`, and `pnpm db:seed` from the repo root. Migrate applies `prisma/migrations`. Seed registers UnitedHealthcare, Cigna, and the three policy PDFs and skips rows that already exist.
7. Start `pnpm dev` in tmux session `anumat-verify` (the script `run/serve.sh`). That is `tsx watch --env-file-if-exists=.env src/main.ts`. Do not kill `tsx` by name later; stop this session.

Ready is not "the port is open". Launch waits until `run/server.log` contains `anumat listening`, `GET /ready` is HTTP 200 with `"status":"ready"`, `"database":"up"`, and `"llm_mode":"replay"`, and `GET /v1/payers?limit=1` with the bearer key is HTTP 200 and its body has `items`. Then it prints:

```text
ready url=http://127.0.0.1:<port> pid=<pid> slug=<slug> llm_mode=replay
```

Read `BASE_URL`, `SLUG`, `PORT`, and `DATA_DIR` from `.cursor/skills/verify-anumat/run/state.env` after that line. A failed launch runs cleanup itself so it does not leave the session or the data directory behind.

## Doctor

```bash
.cursor/skills/verify-anumat/verify.sh doctor
```

Doctor is read-only. It does not insert rows. It exits 0 only when all of these are true:

- State file exists and tmux session `anumat-verify` is alive.
- The pane pid matches `PID` in the state file, and `lsof` shows that pid or a descendant listening on `PORT`.
- `node -v` is v24.
- `run/server.log` contains `anumat listening`.
- `GET /health` returns `{"status":"ok"}`.
- `GET /ready` reports `ready`, `database` `up`, and `llm_mode` `replay`.
- `GET /v1/payers?limit=1` with `Authorization: Bearer anumat-local-verify-key` returns 200 and an `items` array.
- The same GET without a header returns 401 and `"code":"unauthorized"`.

A healthy doctor prints `doctor ok url=<BASE_URL> pid=<pid> node=v24... database=up llm_mode=replay auth=bearer`. Anything else means do not drive this instance.

## Drive

Source the state file and the bearer secret in the shell that sends requests:

```bash
set -a
. .cursor/skills/verify-anumat/run/state.env
set +a
export ANUMAT_VERIFY_KEY='anumat-local-verify-key'
export RUN_DIR='.cursor/skills/verify-anumat/run'
```

Send JSON as `content-type: application/json`. Paths below are on `$BASE_URL`. Every `/v1` route requires the bearer key. `/health` and `/ready` do not. Errors are `{ "error": { "code", "message", "details", "request_id" } }` plus an `X-Request-Id` header. List routes take `limit` (1 to 100, default 20) and `cursor` and return `{ "items", "next_cursor" }`. Stay under 120 requests a minute for this key; a 429 carries `Retry-After`.

The canonical authenticated call is:

```bash
curl -sS -D - -o "$RUN_DIR/drive/create.json" -w '%{http_code}' \
  -X POST "$BASE_URL/v1/payers" \
  -H "authorization: Bearer $ANUMAT_VERIFY_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Verify Payer","slug":"'"$SLUG"'","market":"us"}'
```

Follow one feature file for the journey under test. Do not skip an entry point and call a different route verified. There is no browser harness and no test-only HTTP route.

## Evidence

After a drive, and before cleanup, write one JSON file per feature to `.cursor/skills/verify-anumat/evidence/<feature-id>.json`. Cleanup must not delete that directory. Capture each request method, path, and body together with the HTTP status and response body, then a second read that shows the stored row. Do not record the `Authorization` header or the bearer secret.

For `register-payer`, the second read is `GET /v1/payers`. Save the drive bodies under `$RUN_DIR/drive/` using the names in `features/register-payer.md`, then from the repo root:

```bash
mkdir -p .cursor/skills/verify-anumat/evidence
python3 - <<'PY'
import json
from pathlib import Path

root = Path(".cursor/skills/verify-anumat")
state = {}
for line in (root / "run" / "state.env").read_text().splitlines():
    key, value = line.split("=", 1)
    state[key] = value
drive = root / "run" / "drive"
slug = state["SLUG"]

def load(name):
    return {
        "status": int((drive / f"{name}.status").read_text().strip()),
        "body": json.loads((drive / f"{name}.json").read_text()),
    }

create = load("create")
conflict = load("conflict")
invalid = load("invalid")
unauth = load("unauth")
pages = []
for path in sorted(drive.glob("list-*.json")):
    status = int(path.with_name(path.name.replace(".json", ".status")).read_text().strip())
    body = json.loads(path.read_text())
    pages.append({"file": path.name, "status": status, "body": body})

items = [item for page in pages for item in page["body"]["items"]]
match = next(item for item in items if item["slug"] == slug)
issues = invalid["body"]["error"]["details"]["issues"]
assert create["status"] == 201, create
assert create["body"]["slug"] == slug
assert create["body"]["name"] == "Verify Payer"
assert create["body"]["market"] == "us"
assert match["id"] == create["body"]["id"]
assert all(page["status"] == 200 for page in pages)
assert conflict["status"] == 409 and conflict["body"]["error"]["code"] == "conflict"
assert invalid["status"] == 400 and invalid["body"]["error"]["code"] == "validation_failed"
assert {issue["path"] for issue in issues} >= {"slug", "market"}
assert unauth["status"] == 401 and unauth["body"]["error"]["code"] == "unauthorized"
assert "anumat-local-verify-key" not in json.dumps({
    "create": create, "pages": pages, "conflict": conflict, "invalid": invalid, "unauth": unauth
})

proof = {
    "feature": "register-payer",
    "entry_point": "POST /v1/payers",
    "base_url": state["BASE_URL"],
    "slug": slug,
    "steps": [
        {
            "name": "create",
            "method": "POST",
            "path": "/v1/payers",
            "request_body": {"name": "Verify Payer", "slug": slug, "market": "us"},
            **create,
        },
        {
            "name": "list",
            "method": "GET",
            "path": "/v1/payers",
            "request_body": None,
            "pages": pages,
        },
        {
            "name": "conflict",
            "method": "POST",
            "path": "/v1/payers",
            "request_body": {"name": "Verify Payer", "slug": slug, "market": "us"},
            **conflict,
        },
        {
            "name": "invalid",
            "method": "POST",
            "path": "/v1/payers",
            "request_body": {"name": "Aetna", "slug": "Aetna Inc", "market": "in"},
            **invalid,
        },
        {
            "name": "unauth",
            "method": "GET",
            "path": "/v1/payers",
            "request_body": None,
            **unauth,
        },
    ],
}
out = root / "evidence" / "register-payer.json"
out.write_text(json.dumps(proof, indent=2) + "\n")
print(out)
PY
```

The file must still be at `.cursor/skills/verify-anumat/evidence/register-payer.json` after cleanup. Other features use the same shape: `feature`, `entry_point`, `base_url`, the steps with method, path, request body, status, and body, and a later GET that shows stored state. A check proof also records `watch_run.outcome` and the follow-up `GET /v1/policies/:policyKey` (404 `policy_not_published` before approval, 200 after). Replay mode still fetches the PDF; a second check of that source must come back `unchanged`. Do not point a source at a stand-in host to avoid the network. If `uhcprovider.com` or `static.cigna.com` fails, record `fetch_failed` and stop that journey.

## Cleanup

```bash
.cursor/skills/verify-anumat/verify.sh cleanup
```

Cleanup stops only the `anumat-verify` tmux session recorded in `run/state.env`, then signals that pane's pid if it is still alive. It never kills by process name and it never signals a `postgres` pid. It does not stop a Postgres this run did not start. It removes a Docker container only when state says this run started `anumat-verify-postgres`.

It deletes the run's payer slug only when no source still references it. `policy_versions` and `policy_diffs` cannot be deleted (the database rejects the delete), so a check or approval leaves those rows and the payer that owns them. Say so when that happens. Do not delete the seeded `uhc` or `cigna` rows.

It removes `ANUMAT_DATA_DIR` only when the path is under `/tmp/anumat-verify-`, and it removes `.cursor/skills/verify-anumat/run/` (the server log, pid, and drive scraps). It does not remove `.cursor/skills/verify-anumat/evidence/`.

Run cleanup after every failed launch, doctor, or drive so a broken attempt does not keep the port.

## Helpers

`.cursor/skills/verify-anumat/verify.sh` is the only helper. It is executable.

```bash
.cursor/skills/verify-anumat/verify.sh launch
.cursor/skills/verify-anumat/verify.sh doctor
.cursor/skills/verify-anumat/verify.sh cleanup
```

Drive commands stay in `features/` because each journey is a different request sequence. There is no drive subcommand.
