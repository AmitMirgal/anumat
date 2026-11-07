#!/usr/bin/env bash
set -euo pipefail

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

name="anumat-engine"
: "${PYPI_TOKEN:?PYPI_TOKEN is not set. Add it to ~/.zshrc}"

version=$(bash scripts/engine-py-release-version.sh)
bash scripts/require-local-postgres.sh

pnpm turbo run test --filter=anumat-engine

root=$(pwd)
rm -rf dist
while IFS= read -r row; do
  target=$(jq -r '.target' <<<"$row")
  platform=$(jq -r '.platform' <<<"$row")
  binary=$(jq -r '.binary' <<<"$row")
  bash packages/engine-py/scripts/build-wheel.sh "$target" "$platform" "$binary" "$root/dist"
done < <(jq -c '.[]' packages/engine-py/platforms.json)

uv build --sdist --package anumat-engine --out-dir dist

echo "$name $version"
echo "Wheels:"
ls dist

native=$(python3 - <<'PY'
import platform
import sys

system = platform.system().lower()
machine = platform.machine().lower()
if system == "darwin" and machine in {"arm64", "aarch64"}:
    print("macosx_11_0_arm64")
elif system == "darwin" and machine in {"x86_64", "amd64"}:
    print("macosx_11_0_x86_64")
elif system == "linux" and machine in {"x86_64", "amd64"}:
    print("manylinux_2_17_x86_64")
elif system == "linux" and machine in {"aarch64", "arm64"}:
    print("manylinux_2_17_aarch64")
elif system == "windows" and machine in {"x86_64", "amd64"}:
    print("win_amd64")
else:
    sys.exit(f"no anumat-engine wheel tag for {system} {machine}")
PY
)
wheel=$(ls "dist/"*"${native}"*.whl)
export DATABASE_URL="${DATABASE_URL:-postgres://anumat:anumat@127.0.0.1:5432/anumat_engine}"
export ANUMAT_MIGRATION_SQL="${ANUMAT_MIGRATION_SQL:-packages/db/prisma/migrations/20260929061425_init/migration.sql}"
# Migrate connects to that database, so a missing one exits before smoke.
# Create it when Postgres is up. If Postgres is down, this stops with that fact.
node packages/engine/scripts/ensure-smoke-database.mjs
smoke_work=
cleanup_smoke_work() {
  if [[ -n "${smoke_work:-}" ]]; then
    rm -rf "$smoke_work"
  fi
}
trap cleanup_smoke_work EXIT
{
  IFS= read -r smoke_work
  IFS= read -r smoke_python
} < <(bash scripts/engine-py-make-smoke-venv.sh)
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
echo "Smoking $wheel before publish."
"$smoke_python" packages/engine-py/scripts/smoke.py

read -r -p "Publish $name $version for real? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

uv publish --token "$PYPI_TOKEN" dist/*

tag="anumat-engine@$version"
git tag "$tag"
echo "Created local tag $tag."
echo "git push origin main && git push origin tag $tag"
