#!/usr/bin/env bash
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/release/make-smoke-venv.sh" "${1:-anumat-engine-smoke}"
