#!/usr/bin/env bash
set -euo pipefail

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

name="anumat-engine"
: "${PYPI_TOKEN:?PYPI_TOKEN is not set. Add it to ~/.zshrc}"

engine_version=$(node -p "require('./packages/engine/package.json').version")
if curl -sf "https://pypi.org/pypi/$name/$engine_version/json" >/dev/null; then
  echo "$name $engine_version is already on PyPI. Bump @anumat/engine first."
  exit 1
fi

pnpm turbo run test --filter=anumat-engine

current=$(uv version --short --directory packages/engine-py)
if [[ "$current" != "$engine_version" ]]; then
  uv version "$engine_version" --directory packages/engine-py --frozen
  ENGINE_VERSION="$engine_version" python3 - <<'PY'
import os
from pathlib import Path

path = Path("uv.lock")
text = path.read_text()
needle = 'name = "anumat-engine"\nversion = "'
start = text.find(needle)
if start < 0:
    raise SystemExit("uv.lock is missing anumat-engine")
ver_at = start + len(needle)
end = text.find('"', ver_at)
path.write_text(text[:ver_at] + os.environ["ENGINE_VERSION"] + text[end:])
PY
fi
version=$(uv version --short --directory packages/engine-py)

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
uv venv /tmp/anumat-engine-smoke --clear -q
uv pip install -q --python /tmp/anumat-engine-smoke "$wheel"
if [[ -x /tmp/anumat-engine-smoke/Scripts/python.exe ]]; then
  smoke_python=/tmp/anumat-engine-smoke/Scripts/python.exe
else
  smoke_python=/tmp/anumat-engine-smoke/bin/python
fi
echo "Smoking $wheel before publish."
"$smoke_python" packages/engine-py/scripts/smoke.py

read -r -p "Publish $name $version for real? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

uv publish --token "$PYPI_TOKEN" dist/*

git add packages/engine-py/pyproject.toml uv.lock
if ! git diff --cached --quiet; then
  git commit -m "chore(anumat-engine): release $version"
fi

tag="anumat-engine@$version"
git tag "$tag"
echo "Created local tag $tag."
echo "git push origin main && git push origin tag $tag"
