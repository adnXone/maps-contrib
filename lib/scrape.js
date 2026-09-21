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
} = require('./contrib');

async function launchBrowser({ channel, headed, timeoutMs }) {
  try {
    return await chromium.launch({
      headless: !headed,
      ...(channel ? { channel } : {}),
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

async function openReviewsTab(page, timeoutMs) {
  const tab = page.getByRole('tab', { name: 'Reviews' });
  if (await tab.count()) {
    await tab.first().click();
  } else {
    await page.locator('[role="main"] button', { hasText: 'Reviews' }).first().click();
  }
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

function chunkKey(c) {
  return `${c.shareAria || ''}|${c.ratingAria || ''}|${(c.text || '').slice(0, 120)}`;
}

async function scrollReviews(page) {
  await page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return;
    const star = main.querySelector('span[aria-label]');
    let sc = star || main;
    while (sc && sc !== document.body && sc.scrollHeight <= sc.clientHeight + 10) {
      sc = sc.parentElement;
    }
    (sc || window).scrollTo?.(0, 0);
    if (sc && sc !== window) sc.scrollTop = sc.scrollHeight;
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1500);
}

async function collectReviews(page, maxReviews, timeoutMs) {
  await openReviewsTab(page, timeoutMs);
  const seen = new Map();
  let stagnant = 0;
  for (let round = 0; round < 60; round++) {
    const chunks = await readReviewChunks(page);
    let added = 0;
    for (const c of chunks) {
      const k = chunkKey(c);
      if (!seen.has(k)) {
        seen.set(k, c);
        added++;
      }
      if (seen.size >= maxReviews) break;
    }
    if (seen.size >= maxReviews) break;
    if (added === 0) stagnant++;
    else stagnant = 0;
    if (stagnant >= 3) break;
    await scrollReviews(page);
  }

  return [...seen.values()].slice(0, maxReviews).map((c) => {
    const dateText = findRelativeDate(c.text);
    const place = c.shareAria ? parsePlaceFromShare(c.shareAria) : null;
    const { text, truncated } = parseReviewBody(c.text, dateText, place);
    return {
      place,
      rating: parseRating(c.ratingAria),
      date: dateText,
      text,
      truncated,
      photos: parseReviewPhotoCount(c.photoArias),
    };
  });
}

async function scrapeContributor({ id, hl, maxReviews, timeoutMs, headed, channel, hooks }) {
  const browser = await launchBrowser({ channel, headed, timeoutMs });
  try {
    const page = await browser.newPage({ locale: 'en-US' });
    if (hooks && hooks.onPage) hooks.onPage(page);
    await page.goto(`https://www.google.com/maps/contrib/${id}?hl=${encodeURIComponent(hl)}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForTimeout(3000);
    await dismissConsentIfNeeded(page, timeoutMs);
    const profile = await extractHeader(page);
    let reviews = [];
    if (maxReviews > 0) {
      reviews = await collectReviews(page, maxReviews, timeoutMs);
    }
    return { profile, reviews };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeContributor };
