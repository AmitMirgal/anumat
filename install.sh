#!/bin/sh
# Install Anumat with Docker. A second run upgrades the stack.
# It does not change an existing API key or database password.
#
#   curl -fsSL https://raw.githubusercontent.com/AmitMirgal/anumat/main/install.sh | sh
#
# ANUMAT_DIR      Install directory. Default is $HOME/anumat.
# ANUMAT_VERSION  Image tag. Default is latest. Set this to upgrade to a tag.
# ANUMAT_REF      Git ref for downloaded files. Default is main.
# ANUMAT_SRC      Local repository path. Copy files from it and skip the image pull.

set -eu

: "${ANUMAT_DIR:=$HOME/anumat}"
: "${ANUMAT_REF:=main}"

RAW_URL="https://raw.githubusercontent.com/AmitMirgal/anumat/${ANUMAT_REF}"
created_key=
version_from_user=0

if [ -n "${ANUMAT_VERSION:-}" ]; then
  version_from_user=1
fi

check() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required." >&2
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is required." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running." >&2
    exit 1
  fi
}

get_file() {
  src=$1
  dest=$2
  if [ -n "${ANUMAT_SRC:-}" ]; then
    cp "${ANUMAT_SRC}/${src}" "$dest"
  else
    curl -fsSL "${RAW_URL}/${src}" -o "$dest"
  fi
}

random_hex() {
  nbytes=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$nbytes"
    return 0
  fi
  if ! command -v od >/dev/null 2>&1; then
    echo "openssl or od is required." >&2
    exit 1
  fi
  hex=$(od -An -N "$nbytes" -tx1 /dev/urandom | tr -d ' \n')
  if [ -z "$hex" ]; then
    echo "Could not generate a secret." >&2
    exit 1
  fi
  printf '%s\n' "$hex"
}

env_get() {
  key=$1
  if [ ! -f .env ]; then
    return 0
  fi
  line=$(grep -e "^${key}=" .env | head -n 1 || true)
  printf '%s' "${line#"${key}="}"
}

env_set() {
  key=$1
  value=$2
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0 }
    {
      if (!replaced && index($0, prefix) == 1) {
        print prefix value
        replaced = 1
        next
      }
      print
    }
    END {
      if (!replaced) print prefix value
    }
  ' .env >"$tmp"
  mv "$tmp" .env
  chmod 600 .env
}

ask_anthropic_key() {
  if [ ! -t 0 ]; then
    return 0
  fi
  current=$(env_get ANTHROPIC_API_KEY)
  if [ -n "$current" ]; then
    return 0
  fi
  printf 'Anthropic API key (Enter to skip): '
  stty -echo
  trap 'stty echo' EXIT
  read -r key || key=
  stty echo
  trap - EXIT
  printf '\n'
  if [ -n "$key" ]; then
    env_set ANTHROPIC_API_KEY "$key"
  fi
}

prepare_env() {
  get_file .env.example .env.example
  if [ ! -f .env ]; then
    cp .env.example .env
  fi
  chmod 600 .env

  keys=$(env_get ANUMAT_API_KEYS)
  case $keys in
    "" | *replace-with*)
      created_key=$(random_hex 24)
      env_set ANUMAT_API_KEYS "admin:${created_key}"
      ;;
  esac

  password=$(env_get POSTGRES_PASSWORD)
  if [ -z "$password" ]; then
    env_set POSTGRES_PASSWORD "$(random_hex 24)"
  fi

  file_version=$(env_get ANUMAT_VERSION)
  if [ "$version_from_user" -eq 1 ]; then
    env_set ANUMAT_VERSION "$ANUMAT_VERSION"
  elif [ -z "$file_version" ]; then
    env_set ANUMAT_VERSION latest
  fi

  ask_anthropic_key
}

start_services() {
  if [ -z "${ANUMAT_SRC:-}" ]; then
    docker compose pull
  fi
  docker compose up -d
}

wait_ready() {
  deadline=$(($(date +%s) + 120))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS -o /dev/null http://127.0.0.1:4471/ready 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  docker compose logs api >&2 || true
  echo "The API did not become ready at http://127.0.0.1:4471/ready." >&2
  exit 1
}

print_summary() {
  printf 'Anumat is running at http://127.0.0.1:4471\n'
  printf 'Directory: %s\n' "$ANUMAT_DIR"
  if [ -n "$created_key" ]; then
    printf 'API key: %s\n' "$created_key"
  else
    printf 'Existing API key was kept.\n'
  fi
  cat <<'EOF'

Install @anumat/js and call the API with that key.

import { createAnumatClient } from '@anumat/js';

const anumat = createAnumatClient({
  baseUrl: 'http://127.0.0.1:4471',
  apiKey: 'your-api-key',
});

Set an LLM key in .env, for example ANTHROPIC_API_KEY. Then run docker compose up -d.

To upgrade, run this installer again.
To read logs, run docker compose logs -f api from this directory.
To stop, run docker compose down from this directory.
To uninstall, run docker compose down -v from this directory. That deletes the database and the policy files.
EOF
}

main() {
  check
  if [ -n "${ANUMAT_SRC:-}" ]; then
    ANUMAT_SRC=$(cd -- "$ANUMAT_SRC" >/dev/null && pwd)
  fi
  mkdir -p "$ANUMAT_DIR"
  cd "$ANUMAT_DIR"
  get_file deploy/docker-compose.yml docker-compose.yml
  prepare_env
  start_services
  wait_ready
  print_summary
}

main
