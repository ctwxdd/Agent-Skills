import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

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

function profileDir() {
  return path.resolve(env('BROWSER_PROFILE_DIR', './browser-profile'));
}

function logsDir() {
  const dir = path.resolve(env('LOG_DIR', './logs'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isHeadless() {
  return env('HEADLESS', '1') !== '0';
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
      challengeScreenshot: '',
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
    challengeScreenshot: '',
    loginRequired: /register and login|login to shop|sign in/i.test(body),
    pageOutOfStock,
    hasAddToCart: /Add To Cart/i.test(body)
  };
}

async function readProductPage(page, product, response) {
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(Number(env('PAGE_SETTLE_MS', '1500')));
  const body = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');
  return parseProduct(product, body, await page.title(), response?.status() || 0, page.url());
}

async function checkProduct(product) {
  const context = await chromium.launchPersistentContext(profileDir(), {
    headless: isHeadless(),
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: JST_TIMEZONE,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    let response = await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let result = await readProductPage(page, product, response);
    if (result.status === 'cloudflare_challenge') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshot = path.join(logsDir(), `cloudflare-${product.name}-${stamp}.png`);
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      result.challengeScreenshot = screenshot;

      if (!isHeadless()) {
        await page.waitForTimeout(Number(env('MANUAL_SOLVE_MS', '120000')));
        response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
        result = await readProductPage(page, product, response);
        result.challengeScreenshot = result.status === 'cloudflare_challenge' ? screenshot : '';
      }
    }
    return result;
  } finally {
    await context.close();
  }
}

async function checkStock() {
  const compact = [];
  for (const product of PRODUCTS) {
    compact.push(await checkProduct(product));
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
  const challenges = payload.compact.filter((item) => item.status === 'cloudflare_challenge');
  const shouldSend = available.length || challenges.length || env('EMAIL_ALWAYS') === '1';
  if (!shouldSend) return false;

  const lines = [
    challenges.length
      ? `Marukyu Koyamaen Cloudflare challenge at ${payload.checkedAtJst}`
      : available.length
      ? `Marukyu Koyamaen stock found at ${payload.checkedAtJst}`
      : `Marukyu Koyamaen stock check at ${payload.checkedAtJst}`,
    '',
    ...payload.compact.flatMap((item) => [
      `${item.displayName}`,
      `status: ${item.status}`,
      ...(item.availableVariants.length ? item.availableVariants.map((variant) => `available: ${variant}`) : []),
      ...(item.outOfStockVariants.length ? item.outOfStockVariants.map((variant) => `out: ${variant}`) : []),
      ...(item.unknownVariants.length ? item.unknownVariants.map((variant) => `unknown: ${variant}`) : []),
      ...(item.challengeScreenshot ? [`challenge screenshot: ${item.challengeScreenshot}`] : []),
      item.url,
      ''
    ])
  ];
  const subject = challenges.length
    ? `Marukyu action needed: Cloudflare challenge (${challenges.map((item) => item.displayName).join(', ')})`
    : available.length
    ? `Marukyu stock alert: ${available.map((item) => item.displayName).join(', ')}`
    : 'Marukyu stock check: no stock detected';
  const text = lines.join('\n');

  return sendRawEmail(subject, text);
}

async function sendRawEmail(subject, text) {
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

async function sendProgramError(error) {
  const { isoLike } = nowInTokyo();
  const stack = error?.stack || String(error);
  return sendRawEmail(
    'Marukyu monitor error',
    [
      `Marukyu stock monitor crashed at ${isoLike}`,
      '',
      stack
    ].join('\n')
  );
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

main().catch(async (error) => {
  console.error(error);
  await sendProgramError(error).catch((emailError) => {
    console.error('Failed to send error email:', emailError);
  });
  process.exitCode = 1;
});
