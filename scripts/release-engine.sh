#!/usr/bin/env bash
set -euo pipefail

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

name="@anumat/engine"
version=$(node -p "require('./packages/engine/package.json').version")
npm whoami >/dev/null || { echo "Run npm login first."; exit 1; }
if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name $version is already on npm. Bump the version first."
  exit 1
fi

pnpm turbo run build test --filter=@anumat/engine

pack_json=$(cd packages/engine && npm pack --dry-run --json)
printf '%s\n' "$pack_json" | node scripts/check-engine-tarball.mjs

read -r -p "Publish $name $version for real? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

pnpm --filter @anumat/engine publish --access public

git tag "$name@$version"
git push origin "$name@$version"
echo "Published $name $version and tagged it."
