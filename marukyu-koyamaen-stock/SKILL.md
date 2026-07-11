---
name: marukyu-koyamaen-stock
description: Check Marukyu Koyamaen official English shop inventory for matcha products. Use when the user asks to check, monitor, schedule, compare, or summarize stock availability for Marukyu Koyamaen, Koyamaen, Japanese matcha, or the official catalog at marukyu-koyamaen.co.jp, including requests for periodic stock checks or restock alerts.
---

# Marukyu Koyamaen Stock

## Quick Start

```bash
python3 scripts/check_marukyu_stock.py
python3 scripts/check_marukyu_stock.py --format json
python3 scripts/check_marukyu_stock.py --state /tmp/marukyu-stock-state.json --only-changes
```

## Workflow

1. Run `scripts/check_marukyu_stock.py`.
2. If it returns `cloudflare_challenge`, report that code-based access is blocked; do not use the in-app browser.
3. Report timestamp, source URL, mode, and available variants first.
4. Use only official `marukyu-koyamaen.co.jp` pages unless the user asks for resellers.

## Output

- Prefer `displayName` in user-facing output; it includes kanji when known, e.g. `又玄 Yugen`.
- `availableVariants`: size section contains `Add To Cart` in code-fetched HTML.
- `outOfStockVariants`: size section contains `Out of stock` in code-fetched HTML.
- Each size is parsed only until the next size label; never use page-level `Out of stock` on mixed pages.

## Scripts

- `check_marukyu_stock.py`: stdlib HTTP checker, Markdown/JSON output, optional state diff, Cloudflare detection. No Excel writing.

Treat `available_candidate` as "listed/orderable-looking", not checkout-proof, unless a logged-in product page exposes `Add To Cart`.

## Scheduling

For recurring checks, default to 30-60 minutes and use `--state`. Create a macOS LaunchAgent only after confirming interval and notification method.
