#!/usr/bin/env bash
set -euo pipefail

# uv --clear refuses a leftover directory that is not a virtualenv. --force
# may only be aimed at this exact smoke path, never the repo or home.
reset_py_smoke_venv() {
  local venv=/tmp/anutest
  if [[ "$venv" != /tmp/anutest ]]; then
    echo "refusing to reset $venv" >&2
    exit 1
  fi
  if [[ -L "$venv" ]]; then
    echo "refusing to replace symlink $venv" >&2
    exit 1
  fi
  python3 - "$venv" <<'PY'
import os
import sys

requested = sys.argv[1]
if requested != "/tmp/anutest":
    raise SystemExit(f"refusing to reset {requested}")
venv = os.path.realpath(requested)
repo = os.path.realpath(os.getcwd())
home = os.path.realpath(os.path.expanduser("~"))
tmp = os.path.realpath("/tmp")
parent, name = os.path.split(venv)
if name != "anutest" or os.path.realpath(parent) != tmp:
    raise SystemExit(f"refusing to reset {requested} (resolved to {venv})")
if venv in {repo, home, "/"} or repo.startswith(venv + os.sep) or home.startswith(venv + os.sep):
    raise SystemExit(f"refusing to reset {venv}")
PY
  uv venv "$venv" --clear --force -q
}

target="${1:-}"
[[ "$target" == js || "$target" == py ]] || { echo "Use: pnpm release:anumat or pnpm release:anumat-py"; exit 1; }

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

if [[ "$target" == js ]]; then
  name="@anumat/js"
  version=$(node -p "require('./packages/sdk-js/package.json').version")
  npm whoami >/dev/null || { echo "Run npm login first."; exit 1; }
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "$name $version is already on npm. Bump the version first."; exit 1
  fi
else
  name="anumat-py"
  version=$(cd packages/sdk-python && uv version --short)
  : "${PYPI_TOKEN:?PYPI_TOKEN is not set. Add it to ~/.zshrc}"
  if curl -sf "https://pypi.org/pypi/$name/$version/json" >/dev/null; then
    echo "$name $version is already on PyPI. Bump the version first."; exit 1
  fi
fi

pnpm turbo run build test

if [[ "$target" == js ]]; then
  pnpm --filter "$name" publish --dry-run --access public --no-git-checks
else
  rm -rf dist
  generated="packages/sdk-python/src/anumat_py/_generated/client.py"
  if [[ ! -f "$generated" ]]; then
    echo "Missing $generated. Run pnpm turbo run generate --filter=anumat-py first." >&2
    exit 1
  fi
  uv build --package anumat-py
  python3 scripts/strip-sdist-orig.py dist
  reset_py_smoke_venv
  uv pip install -q --python /tmp/anutest dist/anumat_py-*.whl
  /tmp/anutest/bin/python -c "import anumat_py; print('Wheel installs and imports fine')"
  ls dist
fi

read -r -p "Publish $name $version for real? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

if [[ "$target" == js ]]; then
  pnpm --filter "$name" publish --access public --no-git-checks
else
  uv publish --token "$PYPI_TOKEN" dist/*
fi

git tag "$name@$version"
echo "git push origin main && git push origin tag $name@$version"
echo "Published $name $version and tagged it locally."
