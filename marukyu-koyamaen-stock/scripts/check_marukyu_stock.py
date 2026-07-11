#!/usr/bin/env python3
"""Check Marukyu Koyamaen English matcha catalog stock signals."""

from __future__ import annotations

import argparse
import datetime as dt
import html
from html.parser import HTMLParser
import json
import re
import sys
import time
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


CATALOG_URL = "https://www.marukyu-koyamaen.co.jp/english/shop/products/catalog/matcha"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)
SOLD_OUT_PATTERNS = [
    r"\bsold\s*out\b",
    r"\bout\s*of\s*stock\b",
    r"\bcurrently\s*unavailable\b",
    r"\bunavailable\b",
    r"\btemporarily\s*closed\b",
    r"\bnot\s*available\b",
    r"品切",
    r"在庫切",
]
LOGIN_REQUIRED_PATTERNS = [
    r"you\s+must\s+register\s+and\s+login\s+to\s+shop",
    r"login\s+to\s+shop",
    r"sign\s+in\s+to\s+shop",
]
PRICE_RE = re.compile(r"(?:JPY|¥|&yen;)\s*[0-9][0-9,]*|[0-9][0-9,]*\s*yen", re.I)
SKU_RE = re.compile(r"\b(?:SKU|Item\s*No\.?|Product\s*No\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{2,})\b", re.I)
KANJI_NAMES = {
    "Tenju": "天授",
    "Kiwami Choan": "極長安",
    "Unkaku": "雲鶴",
    "Wako": "和光",
    "Choan": "長安",
    "Eiju": "栄寿",
    "Kinrin": "金輪",
    "Yugen": "又玄",
    "Chigi no Shiro": "千木の白",
    "Isuzu": "五十鈴",
    "Aoarashi": "青嵐",
}


def display_name(name: str) -> str:
    clean = name.strip()
    kanji = KANJI_NAMES.get(clean)
    return f"{kanji} {clean}" if kanji else clean


class LinkAndTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.text_parts: list[str] = []
        self.title_parts: list[str] = []
        self.heading_parts: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self._heading_tag: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in {"h1", "h2"} and self._heading_tag is None:
            self._heading_tag = tag
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if tag == "title":
            self._in_title = False
        if tag == self._heading_tag:
            self._heading_tag = None

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = " ".join(data.split())
        if not text:
            return
        self.text_parts.append(text)
        if self._in_title:
            self.title_parts.append(text)
        if self._heading_tag:
            self.heading_parts.append(text)

    @property
    def text(self) -> str:
        return html.unescape(" ".join(self.text_parts))

    @property
    def title(self) -> str:
        heading = " ".join(self.heading_parts).strip()
        title = " ".join(self.title_parts).strip()
        return heading or title or "Untitled product"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def fetch(url: str, timeout: int, cookie: str | None = None) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    }
    if cookie:
        headers["Cookie"] = cookie
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def body_from_http_error(exc: HTTPError) -> str:
    try:
        raw = exc.read()
    except Exception:
        return ""
    charset = "utf-8"
    headers = getattr(exc, "headers", None)
    if headers:
        charset = headers.get_content_charset() or charset
    return raw.decode(charset, errors="replace")


def detect_block(html_text: str) -> str | None:
    lower = html_text.lower()
    if "just a moment" in lower and "cloudflare" in lower:
        return "cloudflare_challenge"
    if "challenge-platform" in lower or "__cf_chl_" in lower:
        return "cloudflare_challenge"
    return None


def parse(html_text: str) -> LinkAndTextParser:
    parser = LinkAndTextParser()
    parser.feed(html_text)
    return parser


def product_links(html_text: str, base_url: str) -> list[str]:
    parser = parse(html_text)
    links: list[str] = []
    seen: set[str] = set()
    for href in parser.links:
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.netloc != "www.marukyu-koyamaen.co.jp":
            continue
        if "/english/shop/products/" not in parsed.path:
            continue
        if "/catalog/" in parsed.path:
            continue
        clean = parsed._replace(query="", fragment="").geturl()
        if clean not in seen:
            seen.add(clean)
            links.append(clean)
    return links


def status_from_text(text: str, prices: list[str]) -> tuple[str, list[str]]:
    reasons: list[str] = []
    lower = text.lower()
    for pattern in SOLD_OUT_PATTERNS:
        if re.search(pattern, lower, re.I):
            reasons.append(f"matched sold-out signal: {pattern}")
    login_required = any(re.search(pattern, lower, re.I) for pattern in LOGIN_REQUIRED_PATTERNS)
    if login_required:
        reasons.append("page says login is required to shop")
    if reasons and any("sold-out" in reason for reason in reasons):
        return "out_of_stock", reasons
    if prices:
        if login_required:
            return "available_candidate_login_required", reasons
        return "available_candidate", reasons
    if reasons:
        return "unknown_login_required", reasons
    return "unknown", ["no clear price or stock signal found"]


def summarize_product(url: str, html_text: str) -> dict:
    parser = parse(html_text)
    text = parser.text
    prices = sorted(set(match.group(0).replace("&yen;", "¥") for match in PRICE_RE.finditer(text)))
    skus = sorted(set(match.group(1) for match in SKU_RE.finditer(text)))
    status, reasons = status_from_text(text, prices)
    title = re.sub(r"\s*\|\s*.*$", "", parser.title).strip()
    return {
        "title": title,
        "display_title": display_name(title),
        "url": url,
        "status": status,
        "prices": prices,
        "skus": skus,
        "signals": reasons,
    }


def load_state(path: Path | None) -> dict:
    if not path or not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_state(path: Path | None, payload: dict) -> None:
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def add_changes(result: dict, previous: dict) -> None:
    old_products = {item["url"]: item for item in previous.get("products", [])}
    for product in result["products"]:
        old = old_products.get(product["url"])
        product["changed"] = old is None or old.get("status") != product.get("status")
        product["previous_status"] = old.get("status") if old else None


def markdown(result: dict, only_changes: bool) -> str:
    lines = [
        f"# Marukyu Koyamaen Matcha Stock Check",
        "",
        f"- Checked: {result['checked_at']}",
        f"- Source: {result['source_url']}",
        f"- Mode: {result['mode']}",
    ]
    if result.get("error"):
        lines.extend(["", f"Error: `{result['error']}`"])
        return "\n".join(lines)
    products = result["products"]
    if only_changes:
        products = [product for product in products if product.get("changed")]
    lines.extend(["", f"Products reported: {len(products)}"])
    for product in products:
        prices = ", ".join(product["prices"]) if product["prices"] else "no price found"
        changed = ""
        if product.get("changed"):
            previous = product.get("previous_status") or "new"
            changed = f" (changed from {previous})"
        lines.extend(
            [
                "",
                f"## {product.get('display_title') or display_name(product['title'])}",
                f"- Status: `{product['status']}`{changed}",
                f"- Prices: {prices}",
                f"- URL: {product['url']}",
            ]
        )
    return "\n".join(lines)


def run(args: argparse.Namespace) -> dict:
    result = {
        "checked_at": utc_now(),
        "source_url": args.url,
        "mode": "live_http",
        "products": [],
    }
    try:
        if args.html:
            result["mode"] = "saved_html"
            catalog_html = Path(args.html).read_text(encoding="utf-8")
            result["products"].append(summarize_product(args.url, catalog_html))
            return result
        else:
            catalog_html = fetch(args.url, args.timeout, args.cookie)
        blocked = detect_block(catalog_html)
        if blocked:
            result["error"] = blocked
            return result
        links = product_links(catalog_html, args.url)
        if not links:
            result["products"].append(summarize_product(args.url, catalog_html))
        for index, link in enumerate(links[: args.max_pages]):
            if index and args.delay:
                time.sleep(args.delay)
            page_html = fetch(link, args.timeout, args.cookie)
            blocked = detect_block(page_html)
            if blocked:
                result["products"].append(
                    {
                        "title": "Blocked product page",
                        "url": link,
                        "status": "unknown_blocked",
                        "prices": [],
                        "skus": [],
                        "signals": [blocked],
                    }
                )
                continue
            result["products"].append(summarize_product(link, page_html))
    except HTTPError as exc:
        body = body_from_http_error(exc)
        blocked = detect_block(body) if body else None
        result["error"] = blocked or f"HTTPError: HTTP {exc.code} {exc.reason}"
    except (URLError, TimeoutError, OSError) as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be >= 1")
    return parsed


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=CATALOG_URL, help="Catalog URL to check.")
    parser.add_argument("--html", help="Saved HTML file to parse instead of fetching live.")
    parser.add_argument("--cookie", help="Optional Cookie header for code-based requests.")
    parser.add_argument("--timeout", type=positive_int, default=20)
    parser.add_argument("--max-pages", type=positive_int, default=40)
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between product page fetches.")
    parser.add_argument("--state", type=Path, help="JSON state file for change detection.")
    parser.add_argument("--only-changes", action="store_true", help="Only show changed products in Markdown.")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")
    args = parser.parse_args(argv)

    previous = load_state(args.state)
    result = run(args)
    add_changes(result, previous)
    if not result.get("error"):
        save_state(args.state, result)

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(markdown(result, args.only_changes))
    return 1 if result.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
