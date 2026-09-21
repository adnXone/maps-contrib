'use strict';

// Playwright orchestration. DOM reads stay dumb (raw strings out);
// all interpretation lives in lib/contrib.js so it stays unit-testable.

const { chromium } = require('playwright');
const {
  parseLevel,
  parsePoints,
  parseRating,
  parsePlaceFromShare,
  findRelativeDate,
  parseReviewBody,
  parseReviewPhotoCount,
  parseStatArias,
  toAbsoluteDate,
  splitOwnerResponse,
  parseContributions,
} = require('./contrib');

async function launchBrowser({ channel, headed, timeoutMs, proxy }) {
  try {
    return await chromium.launch({
      headless: !headed,
      ...(channel ? { channel } : {}),
      ...(proxy ? { proxy } : {}),
      timeout: timeoutMs,
    });
  } catch (e) {
    if (/Executable doesn't exist/i.test(e.message)) {
      throw new Error(
        'no Playwright browser found. Run `npx playwright install chromium` once, ' +
          'or pass --browser-channel msedge|chrome to reuse a system browser.'
      );
    }
    throw e;
  }
}

async function withRetries(fn, attempts, delayMs) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

async function dismissConsentIfNeeded(page, timeoutMs) {
  if (!page.url().includes('consent.google.')) return;
  const reject = page.getByRole('button', { name: 'Reject all' });
  if ((await reject.count()) === 0) {
    throw new Error('Google consent page without a "Reject all" button — page format changed.');
  }
  await reject.click();
  await page.waitForURL((u) => u.pathname.startsWith('/maps/contrib'), { timeout: timeoutMs });
}

async function extractHeader(page) {
  const raw = await page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;
    const buttons = [...main.querySelectorAll('button')]
      .map((b) => (b.innerText || '').trim().replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 140);
    const photoBtn = main.querySelector('button[aria-label="Profile photo"] img');
    const anyImg = main.querySelector('img');
    const arias = [...main.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));
    return {
      buttons,
      headerText: main.innerText || '',
      avatar: (photoBtn && photoBtn.src) || (anyImg && anyImg.src) || null,
      statArias: arias.filter((a) => /[\d.,]+\s+(photos?|reviews?|videos?|views?)\s*$/i.test(a)),
    };
  });
  if (!raw) throw new Error('profile panel ([role="main"]) did not render.');

  const levelText = raw.buttons.find((t) => /Local Guide Level/.test(t)) || '';
  const level = parseLevel(levelText);
  if (!level) throw new Error('profile header did not render (no "Local Guide Level" found).');

  const points = parsePoints(raw.headerText);
  const lines = raw.headerText.split('\n').map((l) => l.trim()).filter(Boolean);
  const pointsIdx = lines.findIndex((l) => /[\d.,]+\s*\/\s*[\d.,]+\s*points/.test(l));
  let bio = null;
  if (pointsIdx > 0) {
    const candidate = lines[pointsIdx - 1];
    if (candidate && !/Local Guide Level/.test(candidate) && !/^Looking for your own/.test(candidate)) {
      bio = candidate;
    }
  }

  return {
    name: raw.buttons[0] || null,
    level,
    bio,
    points: points.points,
    pointsForNextLevel: points.pointsForNextLevel,
    avatar: raw.avatar,
    stats: parseStatArias(raw.statArias),
  };
}

// Clicks the profile name button to open the "Contributions from <name>"
// dialog (per-category totals) and closes it again. Best-effort: callers
// treat a failure as "no contribution totals".
async function readContributionsDialog(page, profileName, timeoutMs) {
  const nameBtn = profileName
    ? page.getByRole('button', { name: profileName }).first()
    : page.locator('[role="main"] button').first();
  await nameBtn.click({ timeout: timeoutMs });
  await page.waitForSelector('[role="dialog"]', { timeout: timeoutMs });
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText || '' : '';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  return text;
}

async function clickTab(page, name) {
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) {
    await tab.first().click();
  } else {
    await page.locator('[role="main"] button', { hasText: name }).first().click();
  }
}

async function openReviewsTab(page, timeoutMs) {
  await clickTab(page, 'Reviews');
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector('[role="main"]');
        if (!main) return false;
        return [...main.querySelectorAll('span[aria-label]')].some((el) => /^\d stars?/.test(el.getAttribute('aria-label') || ''));
      },
      { timeout: timeoutMs }
    )
    .catch(() => {
      throw new Error('Reviews tab did not load any rated reviews (empty profile or format change).');
    });
}

async function openPhotosTab(page, timeoutMs) {
  await clickTab(page, 'Photos');
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector('[role="main"]');
        if (!main) return false;
        return [...main.querySelectorAll('img')].some((img) => (img.src || '').includes('lh3.googleusercontent.com/gps-cs'));
      },
      { timeout: timeoutMs }
    )
    .catch(() => {
      throw new Error('Photos tab did not load any photos (empty profile or format change).');
    });
}

async function readReviewChunks(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return [];
    const stars = [...main.querySelectorAll('span[aria-label]')].filter((el) =>
      /^\d stars?/.test(el.getAttribute('aria-label') || '')
    );
    const chunks = [];
    for (const s of stars) {
      let card = s;
      let box = null;
      for (let i = 0; i < 10 && card && card !== main; i++) {
        card = card.parentElement;
        if (card && card.querySelector('button[aria-label^="Share"]')) {
          box = card;
          break;
        }
      }
      if (!box) continue;
      const shareBtn = box.querySelector('button[aria-label^="Share"]');
      const photoArias = [...box.querySelectorAll('button[aria-label]')]
        .map((b) => b.getAttribute('aria-label'))
        .filter((a) => /^Photo \d+ on /.test(a) || /^\+\s*\d+\s+more photos? on /.test(a));
      chunks.push({
        ratingAria: s.getAttribute('aria-label'),
        shareAria: shareBtn ? shareBtn.getAttribute('aria-label') : null,
        text: box.innerText || '',
        photoArias,
      });
    }
    return chunks;
  });
}

async function readPhotoItems(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return [];
    return [...main.querySelectorAll('img')]
      .filter((img) => (img.src || '').includes('lh3.googleusercontent.com/gps-cs'))
      .map((img) => ({ url: img.src, place: (img.alt || '').trim() || null }));
  });
}

function reviewKey(c) {
  return `${c.shareAria || ''}|${c.ratingAria || ''}|${(c.text || '').slice(0, 120)}`;
}

// Clicks every truncated review's "More" via raw mouse events so the final
// read gets full text. Locator clicks don't work here: the "More" text Playwright
// matches lives in hidden a11y nodes, and scrollIntoView() navigates the map
// away — so scroll the tabpanel only, never the window.
async function expandAllMore(page) {
  let stagnant = 0;
  let lastRemaining = -1;
  for (let i = 0; i < 40; i++) {
    const target = await page.evaluate(() => {
      const panel = document.querySelector('div[role="tabpanel"][aria-label="Reviews"]');
      if (!panel) return null;
      const btns = [...panel.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === 'More');
      if (!btns.length) return { done: true };
      const btn = btns[0];
      const pr = panel.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      panel.scrollTop += br.top + br.height / 2 - (pr.top + pr.height / 2);
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, remaining: btns.length };
    });
    if (!target || target.done) return;
    if (target.remaining === lastRemaining) stagnant++;
    else stagnant = 0;
    lastRemaining = target.remaining;
    if (stagnant >= 3) return;
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(1500);
  }
}

async function scrollPanel(page, tabName) {
  await page.evaluate((name) => {
    const panel = document.querySelector(`div[role="tabpanel"][aria-label="${name}"]`);
    let sc = panel || document.querySelector('[role="main"]');
    while (sc && sc !== document.body && sc.scrollHeight <= sc.clientHeight + 10) {
      sc = sc.parentElement;
    }
    if (sc && sc !== document.body) sc.scrollTop = sc.scrollHeight;
    else window.scrollTo(0, document.body.scrollHeight);
  }, tabName);
  await page.waitForTimeout(1500);
}

async function collectPaginated(page, { tabName, max, timeoutMs, read, key }) {
  const seen = new Map();
  let stagnant = 0;
  for (let round = 0; round < 60; round++) {
    const items = await read(page);
    let added = 0;
    for (const it of items) {
      const k = key(it);
      if (!seen.has(k)) {
        seen.set(k, it);
        added++;
      }
      if (seen.size >= max) break;
    }
    if (seen.size >= max) break;
    if (added === 0) stagnant++;
    else stagnant = 0;
    if (stagnant >= 3) break;
    await scrollPanel(page, tabName);
  }
  return [...seen.values()].slice(0, max);
}

function parseReviewChunk(c, fetchedAt) {
  const split = splitOwnerResponse(c.text);
  const dateText = findRelativeDate(split.main);
  const place = c.shareAria ? parsePlaceFromShare(c.shareAria) : null;
  const { text, truncated } = parseReviewBody(split.main, dateText, place);
  let owner = null;
  if (split.owner && (split.owner.text || split.owner.date)) {
    owner = {
      date: split.owner.date,
      dateAbsolute: split.owner.date ? toAbsoluteDate(split.owner.date, fetchedAt) : null,
      text: split.owner.text,
    };
  }
  return {
    place,
    rating: parseRating(c.ratingAria),
    date: dateText,
    dateAbsolute: dateText ? toAbsoluteDate(dateText, fetchedAt) : null,
    text,
    truncated,
    photos: parseReviewPhotoCount(c.photoArias),
    likes: null, // Like buttons expose no counts without login
    owner,
  };
}

async function collectReviews(page, maxReviews, timeoutMs, fetchedAt) {
  await openReviewsTab(page, timeoutMs);
  const chunks = await collectPaginated(page, {
    tabName: 'Reviews',
    max: maxReviews,
    timeoutMs,
    read: readReviewChunks,
    key: reviewKey,
  });
  // Expand truncated previews, then re-read so text keys match final content.
  await expandAllMore(page);
  const fresh = await readReviewChunks(page);
  const byCard = new Map();
  for (const c of fresh) byCard.set(`${c.shareAria || ''}|${c.ratingAria || ''}`, c);
  const merged = chunks.map((c) => byCard.get(`${c.shareAria || ''}|${c.ratingAria || ''}`) || c);
  return merged.slice(0, maxReviews).map((c) => parseReviewChunk(c, fetchedAt));
}

async function collectPhotos(page, maxPhotos, timeoutMs) {
  await openPhotosTab(page, timeoutMs);
  const items = await collectPaginated(page, {
    tabName: 'Photos',
    max: maxPhotos,
    timeoutMs,
    read: readPhotoItems,
    key: (p) => p.url,
  });
  // alt text is either the bare place name or "Photo of <place>"
  return items.map((p) => ({
    url: p.url,
    place: p.place ? p.place.replace(/^Photo of\s+/i, '') || null : null,
  }));
}

async function scrapeContributor({ id, hl, maxReviews, maxPhotos, timeoutMs, headed, channel, proxy, fetchedAt, hooks }) {
  const browser = await launchBrowser({ channel, headed, timeoutMs, proxy });
  try {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1366, height: 900 } });
    if (hooks && hooks.onPage) hooks.onPage(page);
    const profile = await withRetries(
      async () => {
        await page.goto(`https://www.google.com/maps/contrib/${id}?hl=${encodeURIComponent(hl)}`, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
        await page.waitForTimeout(3000);
        await dismissConsentIfNeeded(page, timeoutMs);
        return extractHeader(page);
      },
      2,
      3000
    );
    const stamp = fetchedAt || new Date().toISOString();
    let contributions = {};
    try {
      contributions = parseContributions(await readContributionsDialog(page, profile.name, timeoutMs));
    } catch {
      // totals unavailable — profile and lists still work
    }
    profile.contributions = contributions;
    let reviews = [];
    if (maxReviews > 0) {
      reviews = await collectReviews(page, maxReviews, timeoutMs, stamp);
    }
    let photos = [];
    if (maxPhotos > 0) {
      photos = await collectPhotos(page, maxPhotos, timeoutMs);
    }
    return { profile, reviews, photos };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeContributor };
