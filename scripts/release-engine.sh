#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

bash scripts/release/require-clean-main.sh

name="@anumat/engine"
version=$(node -p "require('./packages/engine/package.json').version")
tag="${name}@${version}"

bash scripts/require-local-postgres.sh
pnpm turbo run build test --filter=@anumat/engine
node packages/engine/scripts/check-pack.mjs

bash scripts/release/finish-npm.sh "$name" "$version" "$root/packages/engine" "$tag"
