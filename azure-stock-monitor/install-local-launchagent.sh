#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.local ]]; then
  echo "Create azure-stock-monitor/.env.local first. Start from .env.local.example." >&2
  exit 1
fi

npm install --omit=dev
npx playwright install chromium

support="$HOME/Library/Application Support/MarukyuStock"
plist="$HOME/Library/LaunchAgents/com.nick.marukyu-stock.plist"

mkdir -p "$support/logs" "$HOME/Library/LaunchAgents"
cp monitor.mjs package.json run-local-hourly.sh .env.local "$support/"
cp -R node_modules "$support/"
chmod 700 "$support" "$support/run-local-hourly.sh"
chmod 600 "$support/.env.local"

sed "s#$PWD#$support#g" com.nick.marukyu-stock.plist > "$plist"
plutil -lint "$plist"

launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl enable "gui/$(id -u)/com.nick.marukyu-stock"
launchctl kickstart -k "gui/$(id -u)/com.nick.marukyu-stock"

launchctl print "gui/$(id -u)/com.nick.marukyu-stock" | sed -n '1,80p'
