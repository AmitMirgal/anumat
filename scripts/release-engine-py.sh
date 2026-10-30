#!/usr/bin/env bash
set -euo pipefail

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

name="anumat-engine"
version=$(cd packages/engine-py && uv version --short)
if curl -sf "https://pypi.org/pypi/$name/$version/json" >/dev/null; then
  echo "$name $version is already on PyPI. Bump the version first."
  exit 1
fi

pnpm turbo run build test

echo "$name $version"
echo "Wheels:"
jq -r --arg version "$version" '.[] | "anumat_engine-\($version)-py3-none-\(.platform).whl"' packages/engine-py/platforms.json

read -r -p "Tag engine-py@$version so CI can publish $name $version? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

git tag "engine-py@$version"
git push origin "engine-py@$version"
echo "Tagged engine-py@$version. GitHub Actions publishes the wheels."
