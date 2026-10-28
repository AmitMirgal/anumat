#!/usr/bin/env bash
set -euo pipefail

[[ "$(git branch --show-current)" == main ]] || { echo "Switch to main first."; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash your changes first."
  exit 1
fi
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with GitHub. Pull first."; exit 1; }

version=$(node -p "require('./apps/api/package.json').version")
tag="server@${version}"

if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
  echo "${tag} is already present. Bump the version first."
  exit 1
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/${tag}")" ]; then
  echo "${tag} is already present. Bump the version first."
  exit 1
fi

read -r -p "Tag ${tag}? Type ${version} to confirm: " answer
[[ "$answer" == "$version" ]] || { echo "Cancelled. Nothing was tagged."; exit 1; }

git tag "$tag"
git push origin "$tag"
echo "Tagged ${tag}."
