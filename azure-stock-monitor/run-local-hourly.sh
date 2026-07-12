#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")"
mkdir -p logs

if [[ -f .env.local ]]; then
  caller_email_always="${EMAIL_ALWAYS:-}"
  set -a
  # shellcheck disable=SC1091
  source ./.env.local
  set +a
  if [[ -n "$caller_email_always" ]]; then
    export EMAIL_ALWAYS="$caller_email_always"
  fi
fi

export EMAIL_ALWAYS="${EMAIL_ALWAYS:-0}"

if [[ "${USE_REAL_CHROME:-1}" == "1" ]]; then
  export BROWSER_CDP_URL="${BROWSER_CDP_URL:-http://127.0.0.1:9222}"
  chrome_profile="${REAL_CHROME_PROFILE_DIR:-$HOME/Library/Application Support/MarukyuStock/real-chrome-profile}"
  if ! /usr/bin/curl -fsS "$BROWSER_CDP_URL/json/version" >/dev/null 2>&1; then
    /usr/bin/open -na "Google Chrome" --args \
      --remote-debugging-port=9222 \
      --user-data-dir="$chrome_profile" \
      --no-first-run \
      --new-window "about:blank" >/dev/null 2>&1 || true
    sleep "${CHROME_BOOT_SECONDS:-3}"
  fi
fi

node monitor.mjs 2>&1 | tee -a logs/local-monitor.log
