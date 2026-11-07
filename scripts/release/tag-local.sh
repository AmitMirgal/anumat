#!/usr/bin/env bash
set -euo pipefail

# Create a local lightweight tag at HEAD, or accept one that already points at
# HEAD. Never pushes. Never moves a tag that points at another commit.

tag=${1:?tag name}

if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null; then
  current=$(git rev-parse HEAD)
  tagged=$(git rev-parse "${tag}^{}")
  if [[ "$current" != "$tagged" ]]; then
    echo "tag ${tag} points at ${tagged}, HEAD is ${current}. Refusing to move it." >&2
    exit 1
  fi
  echo "Local tag ${tag} already points at HEAD."
else
  git tag "$tag"
  echo "Created local tag ${tag}."
fi

echo "This script does not push. To put the tag on GitHub:"
echo "  git push origin tag ${tag}"
