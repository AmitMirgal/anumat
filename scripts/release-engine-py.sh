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

echo "$name $version"
echo "Wheels:"
ls dist

read -r -p "Publish $name $version for real? Type $version to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was published."; exit 1; }

uv publish --token "$PYPI_TOKEN" dist/*

git add packages/engine-py/pyproject.toml uv.lock
if ! git diff --cached --quiet; then
  git commit -m "chore(anumat-py): release anumat-engine $version"
fi

tag="anumat-py@$version"
git tag "$tag"
echo "Created local tag $tag."
echo "git push origin main && git push origin tag $tag"
echo "git push origin main --follow-tags"
