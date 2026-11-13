#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

bundle_dir=${ANUMAT_ENGINE_RELEASE_DIR:-}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir)
      bundle_dir=${2:?--bundle-dir requires a directory}
      shift 2
      ;;
    *)
      echo "usage: $0 [--bundle-dir DIR]" >&2
      echo "Or set ANUMAT_ENGINE_RELEASE_DIR to a directory from: gh run download <run> --name anumat-engine-release --dir DIR" >&2
      exit 1
      ;;
  esac
done

bash scripts/release/require-clean-main.sh

name="anumat-engine"
version=$(bash scripts/engine-py-release-version.sh)
tag="${name}@${version}"

bash scripts/require-local-postgres.sh
pnpm turbo run test --filter=anumat-engine

owned_bundle=1
if [[ -n "$bundle_dir" ]]; then
  bundle=$(cd "$bundle_dir" && pwd) || {
    echo "ANUMAT_ENGINE_RELEASE_DIR / --bundle-dir is not a directory: $bundle_dir" >&2
    exit 1
  }
  owned_bundle=0
else
  bundle=$(mktemp -d "${TMPDIR:-/tmp}/anumat-engine-bundle.XXXXXX")
fi
smoke_work=
cleanup() {
  if [[ "$owned_bundle" -eq 1 ]]; then
    rm -rf "$bundle"
  fi
  if [[ -n "${smoke_work:-}" ]]; then
    rm -rf "$smoke_work"
  fi
}
trap cleanup EXIT

if [[ "$owned_bundle" -eq 0 ]]; then
  bash scripts/release/fetch-engine-ci-bundle.sh --bundle-dir "$bundle"
else
  bash scripts/release/fetch-engine-ci-bundle.sh "$bundle"
fi
python3 scripts/release/verify_engine_bundle.py \
  --repo "$root" \
  --bundle "$bundle" \
  --commit "$(git rev-parse HEAD)" \
  --version "$version"

wheel=$(python3 scripts/release/select_native_wheel.py "$bundle")
export DATABASE_URL="${DATABASE_URL:-postgres://anumat:anumat@127.0.0.1:5432/anumat_engine}"
export ANUMAT_MIGRATION_SQL="${ANUMAT_MIGRATION_SQL:-packages/db/prisma/migrations/20260929061425_init/migration.sql}"
node packages/engine/scripts/ensure-smoke-database.mjs

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
echo "Smoking $wheel from the Engine wheels CI bundle before publish."
"$smoke_python" packages/engine-py/scripts/smoke.py

# while-read, not mapfile: macOS /bin/bash is 3.2.
files=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  files+=("$line")
done < <(python3 -c 'import json,sys; from pathlib import Path; bundle=Path(sys.argv[1]); names=json.loads((bundle/"provenance.json").read_text())["files"]; print("\n".join(str(bundle/name) for name in names))' "$bundle")
if [[ "${#files[@]}" -ne 6 ]]; then
  echo "expected 5 wheels and 1 sdist in the CI bundle" >&2
  exit 1
fi
bash scripts/release/finish-pypi.sh "$name" "$version" "$tag" "${files[@]}"
