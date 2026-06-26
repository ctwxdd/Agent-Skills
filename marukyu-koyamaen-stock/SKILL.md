---
name: marukyu-koyamaen-stock
description: Check Marukyu Koyamaen official English shop inventory for matcha products. Use when the user asks to check, monitor, schedule, compare, or summarize stock availability for Marukyu Koyamaen, Koyamaen, Japanese matcha, or the official catalog at marukyu-koyamaen.co.jp, including requests for periodic stock checks or restock alerts.
---

# Marukyu Koyamaen Stock

## Quick Start

Use the official English catalog first:

```bash
python3 scripts/check_marukyu_stock.py
```

For machine-readable output:

```bash
python3 scripts/check_marukyu_stock.py --format json
```

For periodic checks with change detection:

```bash
python3 scripts/check_marukyu_stock.py --state /tmp/marukyu-stock-state.json --only-changes
```

If the user is logged in through the Codex in-app browser, use the logged-in browser fast path instead:

```js
const mod = await import(`${nodeRepl.cwd}/marukyu-koyamaen-stock/scripts/iab_logged_in_stock_check.mjs`);
await mod.runLoggedInStockCheck({ browser, nodeRepl });
```

## Workflow

1. Run `scripts/check_marukyu_stock.py` against the official catalog URL.
2. Report the check timestamp, source URL, and whether the result came from live HTTP, saved HTML, or manual browser inspection.
3. Treat `available_candidate` as "appears orderable/listed" rather than guaranteed purchasable unless the product page clearly exposes an order button or checkout availability.
4. If the script reports `cloudflare_challenge`, use a browser-capable tool or the user's Chrome/in-app browser session to inspect the official site, then summarize visible product statuses manually.
5. Never use reseller pages as the source of truth unless the user explicitly asks for reseller inventory.

## Logged-In Browser Workflow

Use this when the user says they have logged in, or when the HTTP script is blocked but a browser session can read product pages.

1. Use the browser skill and select the in-app browser or Chrome session that contains the user's Marukyu Koyamaen login.
2. Confirm the current page is on `marukyu-koyamaen.co.jp` or navigate to `https://www.marukyu-koyamaen.co.jp/english/shop/products/catalog/matcha`.
3. Run `scripts/iab_logged_in_stock_check.mjs` from the Node REPL after `browser` is selected.
4. Read `compact` from the JSON output:
   - `availableVariants` means the size section contains `Add To Cart`.
   - `outOfStockVariants` means the size section contains `Out of stock`.
   - The parser evaluates each size from its size label through the next size label; do not use broad page-level `Out of stock`, because mixed pages often have one available size and one sold-out size.
5. Report the timestamp, number of products checked, available product count, out-of-stock product count, and the available variants first.

Do not click `Add To Cart` for inventory checks. The visible `Add To Cart` signal is enough to determine that a size appears purchasable.

## Script Notes

`scripts/check_marukyu_stock.py` uses only the Python standard library. It:

- fetches the Marukyu Koyamaen English matcha catalog;
- follows product links under `/english/shop/products/`;
- detects common sold-out and unavailable text;
- extracts visible prices and SKU-like identifiers where present;
- writes Markdown or JSON summaries;
- optionally stores a state file to highlight status changes between runs.

If the site blocks automated HTTP with Cloudflare or another JavaScript challenge, do not claim products are unavailable. State that the automated fetch was blocked and switch to browser inspection.

`scripts/iab_logged_in_stock_check.mjs` is for logged-in browser sessions. It avoids browser `fetch` because the Codex in-app browser page scope may not expose it; instead it navigates product pages sequentially and extracts visible text from each page.

## Scheduling

When asked to set up a recurring local check, prefer a conservative interval such as every 30-60 minutes unless the user specifies otherwise. Use the script with `--state` so repeated runs can report only changed products. On macOS, create a LaunchAgent only after confirming the desired interval and notification method.
