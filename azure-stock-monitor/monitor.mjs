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

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|article|button|a)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;/g, '$')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function pageTitle(html) {
  return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
      cookie: env('MARUKYU_COOKIE')
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45000)
  });
  const html = await response.text();
  return { html, statusCode: response.status, observedUrl: response.url };
}

function parseProduct(input, html, statusCode, observedUrl) {
  const title = pageTitle(html);
  const body = htmlToText(html);

  if (/just a moment/i.test(title) || /cloudflare|challenge-platform|__cf_chl_|verify you are human/i.test(html)) {
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
    const { html, statusCode, observedUrl } = await fetchHtml(product.url);
    compact.push(parseProduct(product, html, statusCode, observedUrl));
  }

  return {
    checkedAt: new Date().toISOString(),
    checkedAtJst: nowInTokyo().isoLike,
    sourceUrl: 'https://www.marukyu-koyamaen.co.jp/english/shop/products/catalog/matcha',
    mode: 'azure_fetch',
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
