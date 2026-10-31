#!/usr/bin/env bash
set -euo pipefail

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
  uv build --package anumat-py
  uv venv /tmp/anutest --clear -q
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
git push origin "$name@$version"
echo "Published $name $version and tagged it."
