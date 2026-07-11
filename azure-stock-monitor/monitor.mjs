import { chromium } from 'playwright';

const PRODUCTS = [
  { name: 'Yugen', displayName: '又玄 Yugen', url: 'https://www.marukyu-koyamaen.co.jp/english/shop/products/1171020c1' },
  { name: 'Isuzu', displayName: '五十鈴 Isuzu', url: 'https://www.marukyu-koyamaen.co.jp/english/shop/products/1191040c1' },
  { name: 'Aoarashi', displayName: '青嵐 Aoarashi', url: 'https://www.marukyu-koyamaen.co.jp/english/shop/products/11a1040c1' }
];

const JST_TIMEZONE = 'Asia/Tokyo';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function nowInTokyo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    isoLike: `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second} JST`,
    hour: Number(byType.hour)
  };
}

function shouldRunNow() {
  if (env('FORCE_RUN') === '1') return true;
  const { hour } = nowInTokyo();
  return hour >= 8 && hour <= 20;
}

function parseProduct(input, body, title, statusCode, observedUrl) {
  const cloudflareChallenge = /just a moment|verify you are human|cloudflare|challenge-platform|__cf_chl_|cf-browser-verification|cf-challenge/i.test(`${title}\n${body}`);
  if (cloudflareChallenge) {
    return {
      name: input.name,
      displayName: input.displayName,
      status: 'cloudflare_challenge',
      availableVariants: [],
      outOfStockVariants: [],
      unknownVariants: [],
      url: input.url,
      observedUrl,
      title,
      statusCode,
      loginRequired: false,
      pageOutOfStock: false,
      hasAddToCart: false
    };
  }

  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const sizeRe = /^(?:\d+(?:\.\d+)?\s?(?:g|kg)\b.*|.*(?:can|bag|box|packet|sticks|pieces|bags))$/i;
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length <= 100 && sizeRe.test(lines[i]) && /^[¥$€£]\s?[0-9,.]+/.test(lines[i + 1] || '')) starts.push(i);
  }

  const variants = starts.map((start, index) => {
    const end = starts[index + 1] || Math.min(start + 20, lines.length);
    const segment = lines.slice(start, end).join(' | ');
    const status = /Add To Cart/i.test(segment)
      ? 'available'
      : /Out of stock/i.test(segment)
        ? 'out_of_stock'
        : 'unknown';
    return { size: lines[start], price: lines[start + 1], status };
  });

  const pageOutOfStock = /currently out of stock and unavailable/i.test(body);
  const available = variants.filter((variant) => variant.status === 'available').map((variant) => `${variant.size} ${variant.price}`);
  const out = variants.filter((variant) => variant.status === 'out_of_stock').map((variant) => `${variant.size} ${variant.price}`);
  const unknown = variants.filter((variant) => variant.status === 'unknown').map((variant) => `${variant.size} ${variant.price}`);
  const status = available.length
    ? 'available'
    : pageOutOfStock
      ? 'out_of_stock'
      : out.length && !unknown.length
        ? 'out_of_stock'
        : 'unknown';

  return {
    name: input.name,
    displayName: input.displayName,
    status,
    availableVariants: available,
    outOfStockVariants: status === 'out_of_stock' && out.length === 0 ? unknown : out,
    unknownVariants: status === 'unknown' ? unknown : [],
    url: input.url,
    observedUrl,
    title,
    statusCode,
    loginRequired: /register and login|login to shop|sign in/i.test(body),
    pageOutOfStock,
    hasAddToCart: /Add To Cart/i.test(body)
  };
}

async function checkStock() {
  const compact = [];
  for (const product of PRODUCTS) {
    const browser = await chromium.launch({ headless: env('HEADLESS', '1') !== '0' });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    });

    try {
      const response = await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(Number(env('PAGE_SETTLE_MS', '1500')));
      const body = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');
      compact.push(parseProduct(product, body, await page.title(), response?.status() || 0, page.url()));
    } finally {
      await browser.close();
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    checkedAtJst: nowInTokyo().isoLike,
    sourceUrl: 'https://www.marukyu-koyamaen.co.jp/english/shop/products/catalog/matcha',
    mode: 'playwright',
    compact
  };
}

async function sendEmail(payload) {
  const available = payload.compact.filter((item) => item.availableVariants.length);
  const shouldSend = available.length || env('EMAIL_ALWAYS') === '1';
  if (!shouldSend) return false;

  const lines = [
    available.length
      ? `Marukyu Koyamaen stock found at ${payload.checkedAtJst}`
      : `Marukyu Koyamaen stock check at ${payload.checkedAtJst}`,
    '',
    ...payload.compact.flatMap((item) => [
      `${item.displayName}`,
      `status: ${item.status}`,
      ...(item.availableVariants.length ? item.availableVariants.map((variant) => `available: ${variant}`) : []),
      ...(item.outOfStockVariants.length ? item.outOfStockVariants.map((variant) => `out: ${variant}`) : []),
      ...(item.unknownVariants.length ? item.unknownVariants.map((variant) => `unknown: ${variant}`) : []),
      item.url,
      ''
    ])
  ];
  const subject = available.length
    ? `Marukyu stock alert: ${available.map((item) => item.displayName).join(', ')}`
    : 'Marukyu stock check: no stock detected';
  const text = lines.join('\n');

  if (env('ACS_CONNECTION_STRING') && env('ACS_SENDER') && env('EMAIL_TO')) {
    const { EmailClient } = await import('@azure/communication-email');
    const client = new EmailClient(env('ACS_CONNECTION_STRING'));
    const poller = await client.beginSend({
      senderAddress: env('ACS_SENDER'),
      content: { subject, plainText: text },
      recipients: { to: [{ address: env('EMAIL_TO') }] }
    });
    await poller.pollUntilDone();
    return true;
  }

  console.warn('Email requested, but ACS_CONNECTION_STRING, ACS_SENDER, or EMAIL_TO is missing.');
  return false;
}

async function main() {
  const { isoLike } = nowInTokyo();
  if (!shouldRunNow()) {
    console.log(JSON.stringify({ skipped: true, reason: 'outside Japan 08:00-20:00 window', checkedAtJst: isoLike }));
    return;
  }

  const payload = await checkStock();
  const emailed = await sendEmail(payload);
  console.log(JSON.stringify({ ...payload, emailed }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
