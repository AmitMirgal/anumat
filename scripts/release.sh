#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

target="${1:-}"
[[ "$target" == js || "$target" == py ]] || { echo "Use: pnpm release:anumat or pnpm release:anumat-py" >&2; exit 1; }

bash scripts/release/require-clean-main.sh
bash scripts/require-local-postgres.sh

export DATABASE_URL="${DATABASE_URL:-postgres://anumat:anumat@127.0.0.1:5432/anumat_test}"
export ANUMAT_MIGRATION_SQL="${ANUMAT_MIGRATION_SQL:-packages/db/prisma/migrations/20260929061425_init/migration.sql}"
node packages/engine/scripts/ensure-smoke-database.mjs

if [[ "$target" == js ]]; then
  name="@anumat/js"
  version=$(node -p "require('./packages/sdk-js/package.json').version")
  tag="${name}@${version}"
  pnpm turbo run build --filter=@anumat/js
  pnpm --filter @anumat/js test
  node packages/sdk-js/scripts/check-pack.mjs
  bash scripts/release/finish-npm.sh "$name" "$version" "$root/packages/sdk-js" "$tag"
  exit 0
fi

name="anumat-py"
version=$(cd packages/sdk-python && uv version --short)
tag="${name}@${version}"
generated="packages/sdk-python/src/anumat_py/_generated/client.py"
pnpm turbo run build --filter=anumat-py
if [[ ! -f "$generated" ]]; then
  echo "Missing $generated after anumat-py build." >&2
  exit 1
fi
uv run --frozen --package anumat-py --group dev pytest packages/sdk-python/tests

dist=$(mktemp -d "${TMPDIR:-/tmp}/anumat-py-dist.XXXXXX")
smoke_work=
cleanup() {
  rm -rf "$dist"
  if [[ -n "${smoke_work:-}" ]]; then
    rm -rf "$smoke_work"
  fi
}
trap cleanup EXIT

uv build --package anumat-py --out-dir "$dist"
python3 scripts/strip-sdist-orig.py "$dist"

{
  IFS= read -r smoke_work
  IFS= read -r smoke_python
} < <(bash scripts/release/make-smoke-venv.sh anumat-py-smoke)
if [[ -z "$smoke_work" || -z "${smoke_python:-}" || ! -x "$smoke_python" ]]; then
  echo "failed to create the anumat-py smoke virtualenv" >&2
  exit 1
fi
case "$smoke_python" in
  "$smoke_work"/*) ;;
  *)
    echo "smoke python is not inside the owned workspace" >&2
    exit 1
    ;;
esac
wheel=$(find "$dist" -maxdepth 1 -name 'anumat_py-*.whl' -type f)
count=$(find "$dist" -maxdepth 1 -name 'anumat_py-*.whl' -type f | wc -l)
if [[ "${count//[[:space:]]/}" != 1 ]]; then
  echo "expected one anumat-py wheel in ${dist}" >&2
  ls "$dist" >&2
  exit 1
fi
uv pip install -q --python "$smoke_python" "$wheel"
"$smoke_python" -c "import anumat_py; print('Wheel installs and imports fine')"

mapfile -t files < <(find "$dist" -maxdepth 1 -type f \( -name 'anumat_py-*.whl' -o -name 'anumat_py-*.tar.gz' \) | sort)
if [[ "${#files[@]}" -lt 2 ]]; then
  echo "expected anumat-py wheel and sdist in ${dist}" >&2
  ls "$dist" >&2
  exit 1
fi
bash scripts/release/finish-pypi.sh "$name" "$version" "$tag" "${files[@]}"
