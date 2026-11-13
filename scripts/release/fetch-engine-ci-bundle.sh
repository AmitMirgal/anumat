#!/usr/bin/env bash
set -euo pipefail

# Download the Engine wheels release bundle for HEAD, or use a directory
# already fetched with gh run download. No local compile fallback.
# macOS /bin/bash is 3.2: no mapfile.

root=$(cd "$(dirname "$0")/../.." && pwd)
use_existing=0
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir)
      use_existing=1
      out=${2:?--bundle-dir requires a directory}
      shift 2
      ;;
    -*)
      echo "usage: $0 [--bundle-dir DIR] [DIR]" >&2
      echo "Or set ANUMAT_ENGINE_RELEASE_DIR to a directory from: gh run download <run> --name anumat-engine-release --dir DIR" >&2
      exit 1
      ;;
    *)
      if [[ -n "$out" ]]; then
        echo "usage: $0 [--bundle-dir DIR] [DIR]" >&2
        exit 1
      fi
      out=$1
      shift
      ;;
  esac
done
if [[ -z "$out" && -n "${ANUMAT_ENGINE_RELEASE_DIR:-}" ]]; then
  use_existing=1
  out=$ANUMAT_ENGINE_RELEASE_DIR
fi
if [[ -z "$out" ]]; then
  echo "usage: $0 [--bundle-dir DIR] [DIR]" >&2
  echo "Or set ANUMAT_ENGINE_RELEASE_DIR to a directory from: gh run download <run> --name anumat-engine-release --dir DIR" >&2
  exit 1
fi
if [[ "$use_existing" -eq 0 && -n "${ANUMAT_ENGINE_RELEASE_DIR:-}" ]]; then
  use_existing=1
  out=$ANUMAT_ENGINE_RELEASE_DIR
fi

flatten_bundle() {
  local dest=$1
  if [[ ! -f "$dest/provenance.json" ]]; then
    nested=$(find "$dest" -name provenance.json -type f | head -n 1)
    if [[ -n "$nested" ]]; then
      nested_dir=$(dirname "$nested")
      find "$nested_dir" -maxdepth 1 -type f -exec mv -f {} "$dest"/ \;
    fi
  fi
}

clear_dir() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest"
}

download_is_expired() {
  grep -Eqi 'expired|gone|410' "$1"
}

download_is_missing() {
  grep -Eqi 'not found|no artifact|unknown artifact' "$1"
}

download_is_auth() {
  grep -Eqi 'HTTP[ /]401|HTTP[ /]403|status 401|status 403|403 forbidden|401 unauthorized|access denied|permission denied|not authenticated|bad credentials|resource not accessible' "$1"
}

download_is_network() {
  grep -Eqi 'timed out|timeout|i/o timeout|operation timed out|error writing zip|connection reset|connection refused|network is unreachable|temporary failure|tls handshake|EOF|broken pipe|slow download' "$1"
}

explain_download_failure() {
  local dest_err=$1
  local dest_commit=$2
  local dest_run=$3
  cat "$dest_err" >&2
  if download_is_expired "$dest_err"; then
    echo "The anumat-engine-release artifact for ${dest_commit} has expired. Re-run Engine wheels on this ref: gh workflow run 'Engine wheels' --ref main" >&2
    echo "This script will not compile wheels locally." >&2
  elif download_is_missing "$dest_err"; then
    echo "Run ${dest_run} has no anumat-engine-release artifact. That job must succeed on this commit. This script will not compile wheels locally." >&2
  elif download_is_network "$dest_err"; then
    echo "Network error downloading anumat-engine-release for ${dest_commit} (timeout or interrupted transfer). Retry later, or download it yourself and point the release at that directory:" >&2
    echo "  gh run download ${dest_run} --name anumat-engine-release --dir /tmp/anumat-engine-release" >&2
    echo "  ANUMAT_ENGINE_RELEASE_DIR=/tmp/anumat-engine-release pnpm release:engine-py" >&2
    echo "This script will not compile wheels locally." >&2
  elif download_is_auth "$dest_err"; then
    echo "Failed to download anumat-engine-release for ${dest_commit}: gh is missing repo or workflow/artifact read permission. Run gh auth login with those scopes. This script will not compile wheels locally." >&2
  else
    echo "Failed to download anumat-engine-release for ${dest_commit}. This was not classified as a timeout, missing artifact, or auth error. Re-run the download, or use ANUMAT_ENGINE_RELEASE_DIR after: gh run download ${dest_run} --name anumat-engine-release --dir DIR" >&2
    echo "This script will not compile wheels locally." >&2
  fi
}

if [[ "$use_existing" -eq 1 ]]; then
  if [[ ! -d "$out" ]]; then
    echo "ANUMAT_ENGINE_RELEASE_DIR / --bundle-dir is not a directory: $out" >&2
    echo "This script will not compile wheels locally." >&2
    exit 1
  fi
  flatten_bundle "$out"
  if [[ ! -f "$out/provenance.json" ]]; then
    echo "Pre-downloaded bundle at $out is missing provenance.json. Download with: gh run download <run> --name anumat-engine-release --dir DIR" >&2
    echo "This script will not compile wheels locally." >&2
    exit 1
  fi
  echo "Using pre-downloaded Engine wheels bundle from $out"
  exit 0
fi

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
backoff=${ANUMAT_ENGINE_DOWNLOAD_BACKOFF:-5:15:30}
d1=${backoff%%:*}
rest=${backoff#*:}
if [[ "$rest" == "$backoff" ]]; then
  d2=15
  d3=30
else
  d2=${rest%%:*}
  rest2=${rest#*:}
  if [[ "$rest2" == "$rest" ]]; then
    d3=30
  else
    d3=$rest2
  fi
fi
: "${d1:=5}"
: "${d2:=15}"
: "${d3:=30}"

attempt=1
download_err=$(mktemp)
while :; do
  clear_dir "$out"
  set +e
  "$gh_bin" run download "$run_id" --name anumat-engine-release --dir "$out" >"$download_err" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    break
  fi
  if download_is_expired "$download_err" || download_is_missing "$download_err"; then
    explain_download_failure "$download_err" "$commit" "$run_id"
    rm -f "$download_err"
    exit 1
  fi
  if [[ "$attempt" -ge 4 ]]; then
    explain_download_failure "$download_err" "$commit" "$run_id"
    rm -f "$download_err"
    exit 1
  fi
  case "$attempt" in
    1) delay=$d1 ;;
    2) delay=$d2 ;;
    3) delay=$d3 ;;
    *) delay=30 ;;
  esac
  echo "Download of anumat-engine-release failed (attempt ${attempt}/4). Retrying in ${delay}s. Partial files were discarded." >&2
  cat "$download_err" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
rm -f "$download_err"

flatten_bundle "$out"
if [[ ! -f "$out/provenance.json" ]]; then
  echo "Downloaded artifact for run ${run_id} is missing provenance.json. Refusing to publish. This script will not compile wheels locally." >&2
  exit 1
fi
echo "Fetched Engine wheels bundle from run ${run_id}"
