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

Logged-in browser fast path:

```js
const mod = await import(`${nodeRepl.cwd}/marukyu-koyamaen-stock/scripts/iab_logged_in_stock_check.mjs`);
await mod.runLoggedInStockCheck({ browser, nodeRepl });
```

## Workflow

1. Run `scripts/check_marukyu_stock.py` first.
2. If it returns `cloudflare_challenge`, use the logged-in browser fast path.
3. Report timestamp, source URL, mode, and available variants first.
4. Use only official `marukyu-koyamaen.co.jp` pages unless the user asks for resellers.

## Logged-In Checks

Use `scripts/iab_logged_in_stock_check.mjs` after selecting the browser that contains the user's login. It navigates the matcha catalog and product pages; do not click `Add To Cart`.

Interpret JSON:

- `availableVariants`: size section contains `Add To Cart`.
- `outOfStockVariants`: size section contains `Out of stock`.
- Each size is parsed only until the next size label; never use page-level `Out of stock` on mixed pages.

## Scripts

- `check_marukyu_stock.py`: stdlib HTTP checker, Markdown/JSON output, optional state diff, Cloudflare detection.
- `iab_logged_in_stock_check.mjs`: logged-in browser checker. It navigates pages because the in-app browser page scope may not expose `fetch`.

Treat `available_candidate` as "listed/orderable-looking", not checkout-proof, unless a logged-in product page exposes `Add To Cart`.

## Scheduling

For recurring checks, default to 30-60 minutes and use `--state`. Create a macOS LaunchAgent only after confirming interval and notification method.
