#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")"
mkdir -p logs

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env.local
  set +a
fi

export EMAIL_ALWAYS="${EMAIL_ALWAYS:-1}"

node monitor.mjs 2>&1 | tee -a logs/local-monitor.log
