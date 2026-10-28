#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

placeholder='dev:replace-with-a-random-string-of-16-or-more-characters'

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if grep -qxF "ANUMAT_API_KEYS=${placeholder}" .env; then
  secret="$(openssl rand -hex 24)"
  tmp="$(mktemp)"
  awk -v secret="$secret" -v placeholder="$placeholder" '
    $0 == "ANUMAT_API_KEYS=" placeholder { print "ANUMAT_API_KEYS=admin:" secret; next }
    { print }
  ' .env >"$tmp"
  mv "$tmp" .env
fi

if ! grep -qE '^POSTGRES_PASSWORD=[^[:space:]]+' .env; then
  password="$(openssl rand -hex 16)"
  tmp="$(mktemp)"
  if grep -qE '^POSTGRES_PASSWORD=' .env; then
    awk -v password="$password" '
      /^POSTGRES_PASSWORD=/ && !done { print "POSTGRES_PASSWORD=" password; done = 1; next }
      { print }
    ' .env >"$tmp"
  else
    cat .env >"$tmp"
    printf '\nPOSTGRES_PASSWORD=%s\n' "$password" >>"$tmp"
  fi
  mv "$tmp" .env
fi

line="$(grep -m 1 -E '^ANUMAT_API_KEYS=' .env)"
pair="${line#ANUMAT_API_KEYS=}"
pair="${pair%%,*}"
token="$(printf '%s' "$pair" | cut -d: -f2)"

printf 'API key (keep this private): %s\n' "$token"
printf 'Next, run pnpm selfhost:up\n'
