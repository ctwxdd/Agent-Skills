const CATALOG_URL = "https://www.marukyu-koyamaen.co.jp/english/shop/products/catalog/matcha";
const KANJI_NAMES = {
  Tenju: "天授",
  "Kiwami Choan": "極長安",
  Unkaku: "雲鶴",
  Wako: "和光",
  Choan: "長安",
  Eiju: "栄寿",
  Kinrin: "金輪",
  Yugen: "又玄",
  "Chigi no Shiro": "千木の白",
  Isuzu: "五十鈴",
  Aoarashi: "青嵐",
};

function displayName(name) {
  const clean = String(name || "").trim();
  return KANJI_NAMES[clean] ? `${KANJI_NAMES[clean]} ${clean}` : clean;
}

function parseCatalogLinks() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const links = anchors
    .map((a) => ({
      href: a.href.split("#")[0],
      text: (a.innerText || a.textContent || "").trim().replace(/\s+/g, " "),
    }))
    .filter((item) => item.href.includes("/english/shop/products/") && !item.href.includes("/catalog/"));

  const unique = [];
  const seen = new Set();
  for (const item of links) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    const parts = item.text.split(/\s+/);
    const priceIndex = parts.findIndex((part) => /^¥[0-9,]+/.test(part));
    const withoutPrice = priceIndex >= 0 ? parts.slice(0, priceIndex).join(" ") : item.text;
    unique.push({ name: withoutPrice, url: item.href });
  }
  return unique;
}

function parseCurrentProductPage(input) {
  const text = document.body ? document.body.innerText : "";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sizeRe = /^(?:\d+(?:\.\d+)?\s?(?:g|kg)\b.*|\d+\s?(?:sticks|pieces|bags|pcs)\b.*|.*(?:can|bag|box|packet|sticks|pieces|bags))$/i;
  const starts = [];

  for (let i = 0; i < lines.length; i += 1) {
    const next = lines[i + 1] || "";
    if (lines[i].length <= 100 && sizeRe.test(lines[i]) && /^[¥$€£]\s?[0-9,]+/.test(next)) {
      starts.push(i);
    }
  }

  const variants = [];
  for (let idx = 0; idx < starts.length; idx += 1) {
    const start = starts[idx];
    const end = starts[idx + 1] || Math.min(start + 18, lines.length);
    const segment = lines.slice(start, end).join(" | ");
    let status = "unknown";
    if (/Out of stock/i.test(segment)) status = "out_of_stock";
    else if (/Add To Cart|Add to cart/i.test(segment)) status = "available";

    variants.push({
      size: lines[start],
      price: lines[start + 1],
      status,
      evidence: segment.slice(0, 240),
    });
  }

  const availableCount = variants.filter((variant) => variant.status === "available").length;
  const outCount = variants.filter((variant) => variant.status === "out_of_stock").length;
  const status = availableCount
    ? "available"
    : outCount && outCount === variants.length
      ? "out_of_stock"
      : outCount
        ? "mixed_unknown"
        : "unknown";

  return {
    name: input.name,
    displayName: displayName(input.name),
    url: input.url,
    status,
    variants,
    textHasLogin: /login to shop|register and login/i.test(text),
    textHasCart: /Add To Cart|Add to cart/i.test(text),
    textHasOut: /Out of stock/i.test(text),
  };
}

export async function runLoggedInStockCheck({ browser, nodeRepl, tab: providedTab } = {}) {
  if (!browser) throw new Error("browser is required; select the in-app browser before importing this script.");

  let tab = providedTab || await browser.tabs.selected();
  if (!tab) tab = await browser.tabs.new();

  await tab.goto(CATALOG_URL);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 12000 }).catch(() => {});

  const products = await tab.playwright.evaluate(parseCatalogLinks, null, { timeoutMs: 10000 });
  const results = [];

  for (const product of products) {
    try {
      await tab.goto(product.url);
      await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 8000 }).catch(() => {});
      const result = await tab.playwright.evaluate(parseCurrentProductPage, product, { timeoutMs: 5000 });
      results.push(result);
    } catch (error) {
      results.push({
        name: product.name,
        url: product.url,
        status: "error",
        error: String(error),
        variants: [],
      });
    }
  }

  const compact = results.map((result) => ({
    name: result.name,
    displayName: result.displayName || displayName(result.name),
    status: result.status,
    availableVariants: result.variants
      .filter((variant) => variant.status === "available")
      .map((variant) => `${variant.size} ${variant.price}`),
    outOfStockVariants: result.variants
      .filter((variant) => variant.status === "out_of_stock")
      .map((variant) => `${variant.size} ${variant.price}`),
    unknownVariants: result.variants
      .filter((variant) => variant.status === "unknown")
      .map((variant) => `${variant.size} ${variant.price}`),
    url: result.url,
  }));

  const payload = {
    checkedAt: new Date().toISOString(),
    sourceUrl: CATALOG_URL,
    mode: "logged_in_browser",
    count: results.length,
    availableProducts: compact.filter((item) => item.status === "available").length,
    outOfStockProducts: compact.filter((item) => item.status === "out_of_stock").length,
    unknownProducts: compact.filter((item) => item.status === "unknown" || item.status === "mixed_unknown").length,
    compact,
  };

  if (nodeRepl?.write) nodeRepl.write(JSON.stringify(payload, null, 2));
  return payload;
}
