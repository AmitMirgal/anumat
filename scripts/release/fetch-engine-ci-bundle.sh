#!/usr/bin/env bash
set -euo pipefail

# Download the Engine wheels release bundle for HEAD. No local compile fallback.

root=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:?bundle directory}
mkdir -p "$out"
commit=$(git -C "$root" rev-parse HEAD)
gh_bin=${ANUMAT_GH:-gh}

if ! command -v "$gh_bin" >/dev/null 2>&1; then
  echo "gh is not on PATH. Install GitHub CLI and authenticate so this script can download Actions artifacts for ${commit}." >&2
  echo "This script will not compile wheels on this machine." >&2
  exit 1
fi

auth_log=$(mktemp)
if ! "$gh_bin" auth status >"$auth_log" 2>&1; then
  cat "$auth_log" >&2
  rm -f "$auth_log"
  echo "gh is not authenticated. Run gh auth login with repo and workflow access, then retry. This script will not compile wheels on this machine." >&2
  exit 1
fi
rm -f "$auth_log"

runs_file=$(mktemp)
if ! "$gh_bin" run list --workflow "Engine wheels" --commit "$commit" --limit 20 \
  --json databaseId,conclusion,status,headSha,url,event >"$runs_file"; then
  cat "$runs_file" >&2
  rm -f "$runs_file"
  echo "Failed to list Engine wheels runs for ${commit}. Check gh permissions. This script will not compile wheels on this machine." >&2
  exit 1
fi

run_info=$(python3 - "$runs_file" "$commit" <<'PY'
import json
import sys

path, commit = sys.argv[1], sys.argv[2]
runs = json.loads(open(path, encoding="utf-8").read())
if not isinstance(runs, list):
    raise SystemExit("gh run list did not return a list")
matching = [run for run in runs if run.get("headSha") == commit]
if not matching:
    print(
        f"No Engine wheels workflow run exists for {commit}. "
        "Wait for CI on this commit, or re-run: gh workflow run 'Engine wheels' --ref main",
        file=sys.stderr,
    )
    raise SystemExit(1)
pending = [
    run
    for run in matching
    if run.get("status") in {"queued", "in_progress", "pending", "waiting", "requested"}
]
success = [
    run
    for run in matching
    if run.get("conclusion") == "success"
    and run.get("status") == "completed"
    and run.get("event") in {"push", "workflow_dispatch", None}
]
push_success = [run for run in success if run.get("event") in {"push", "workflow_dispatch"}]
chosen = push_success or success
if not chosen:
    if pending:
        url = pending[0].get("url") or ""
        print(
            f"Engine wheels for {commit} is still running{(' at ' + url) if url else ''}. "
            "Wait until it succeeds. This script will not compile wheels locally.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    url = matching[0].get("url") or ""
    print(
        f"Engine wheels for {commit} did not succeed{(' (' + url + ')') if url else ''}. "
        "Fix CI and wait for a successful run. This script will not compile wheels locally.",
        file=sys.stderr,
    )
    raise SystemExit(1)
chosen.sort(key=lambda run: int(run.get("databaseId") or 0), reverse=True)
run = chosen[0]
print(f"{run['databaseId']}\t{run.get('url') or ''}")
PY
)
rm -f "$runs_file"

run_id=${run_info%%$'\t'*}
run_url=${run_info#*$'\t'}
if [[ -z "$run_id" ]]; then
  echo "failed to resolve an Engine wheels run for ${commit}" >&2
  exit 1
fi

echo "Downloading anumat-engine-release from Engine wheels run ${run_id}${run_url:+ at $run_url}"
download_err=$(mktemp)
set +e
"$gh_bin" run download "$run_id" --name anumat-engine-release --dir "$out" >"$download_err" 2>&1
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  cat "$download_err" >&2
  if grep -Eqi 'expired|gone|410' "$download_err"; then
    echo "The anumat-engine-release artifact for ${commit} has expired. Re-run Engine wheels on this ref: gh workflow run 'Engine wheels' --ref main" >&2
    echo "This script will not compile wheels locally." >&2
  elif grep -Eqi 'not found|no artifact|unknown artifact' "$download_err"; then
    echo "Run ${run_id} has no anumat-engine-release artifact. That job must succeed on this commit. This script will not compile wheels locally." >&2
  else
    echo "Failed to download anumat-engine-release for ${commit}. Check gh permissions (repo and workflow/artifact read). This script will not compile wheels locally." >&2
  fi
  rm -f "$download_err"
  exit 1
fi
rm -f "$download_err"

if [[ ! -f "$out/provenance.json" ]]; then
  nested=$(find "$out" -name provenance.json -type f | head -n 1)
  if [[ -n "$nested" ]]; then
    nested_dir=$(dirname "$nested")
    find "$nested_dir" -maxdepth 1 -type f -exec mv -f {} "$out"/ \;
  fi
fi
if [[ ! -f "$out/provenance.json" ]]; then
  echo "Downloaded artifact for run ${run_id} is missing provenance.json. Refusing to publish. This script will not compile wheels locally." >&2
  exit 1
fi
echo "Fetched Engine wheels bundle from run ${run_id}"
