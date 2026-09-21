'use strict';

// Pure helpers for Google Maps contributor data.
// No browser, no I/O here — everything is unit-testable.

function parseContribInput(input) {
  const s = String(input == null ? '' : input).trim();
  const m = s.match(/\/contrib\/(\d{8,30})/);
  if (m) return m[1];
  if (/^\d{8,30}$/.test(s)) return s;
  throw new Error(
    `cannot find a contributor id in ${JSON.stringify(s.slice(0, 80))} ` +
      '(expected a /maps/contrib/<id> link or a bare numeric id)'
  );
}

function contribUrl(id, hl) {
  return `https://www.google.com/maps/contrib/${id}?hl=${encodeURIComponent(hl || 'en')}`;
}

// Counts on Maps are integers rendered with locale separators
// ("1,179", "11.041", "31,210,495") — keep digits only.
function normalizeCount(str) {
  const digits = String(str == null ? '' : str).replace(/[^0-9]/g, '');
  if (!digits) throw new Error(`no digits in ${JSON.stringify(String(str).slice(0, 40))}`);
  return parseInt(digits, 10);
}

function parseLevel(text) {
  const m = String(text || '').match(/Local Guide Level (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// "11.041 / 15.000 points" -> { points, pointsForNextLevel }
function parsePoints(text) {
  const m = String(text || '').match(/([\d.,]+)\s*\/\s*([\d.,]+)\s*points/);
  if (!m) return { points: null, pointsForNextLevel: null };
  return { points: normalizeCount(m[1]), pointsForNextLevel: normalizeCount(m[2]) };
}

function parseRating(ariaLabel) {
  const m = String(ariaLabel || '').match(/^(\d)\s+stars?/);
  return m ? parseInt(m[1], 10) : null;
}

// Share button aria looks like: `Share "Drumul Taberei" Park's review.`
function parsePlaceFromShare(ariaLabel) {
  return String(ariaLabel || '')
    .replace(/^Share\s+/, '')
    .replace(/'s review\.\s*$/, '')
    .trim();
}

const REL_DATE_RE = /\b(Edited\s+)?(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i;

function findRelativeDate(cardText) {
  const m = String(cardText || '').match(REL_DATE_RE);
  return m ? m[0] : null;
}

function isChromeLine(line, dateText) {
  if (!line) return true;
  if (line === dateText) return true;
  if (/^[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]+$/.test(line)) return true; // icon/star glyphs
  if (/^(More|Like|Share|Photos|Reviews)$/.test(line)) return true;
  if (/^Translated by Google/.test(line)) return true;
  if (/^See original/.test(line)) return true;
  if (/^・/.test(line)) return true;
  if (/^\+\d+$/.test(line)) return true; // "+5" photo overflow
  return false;
}

// Card innerText, one UI string per line. Drops everything up to and including
// the date line (stars, headings), then chrome lines; keeps review prose.
// Returns { text, truncated } — truncated when Maps shows "… More".
function parseReviewBody(cardText, dateText, place) {
  const raw = String(cardText || '');
  const truncated = /…\s*(More)?\s*(Translated by Google|See original|$)/.test(raw);
  let lines = raw.split('\n').map((l) => l.trim());
  if (dateText) {
    let idx = lines.indexOf(dateText);
    if (idx === -1) idx = lines.findIndex((l) => l.includes(dateText));
    if (idx !== -1) lines = lines.slice(idx + 1);
  }
  if (place) {
    const p = String(place).trim();
    const unquoted = p.replace(/^"(.*)"$/, '$1');
    while (lines.length && (lines[0] === p || lines[0] === unquoted)) lines = lines.slice(1);
  }
  const kept = lines.filter((l) => !isChromeLine(l, dateText));
  const text = kept
    .join('\n')
    .trim()
    .replace(/…\s*More$/, '…'); // truncated reviews end in "… More"
  return { text, truncated };
}

// Number of photos attached to a review, from its photo-button aria labels
// ("Photo 1 on X's review", "+ 5 more photos on X's review").
function parseReviewPhotoCount(photoArias) {
  let singles = 0;
  let extra = 0;
  for (const a of photoArias || []) {
    let m = String(a).match(/^Photo (\d+) on /);
    if (m) {
      singles = Math.max(singles, parseInt(m[1], 10));
      continue;
    }
    m = String(a).match(/^\+\s*(\d+)\s+more photos? on /);
    if (m) extra += parseInt(m[1], 10);
  }
  return singles + extra;
}

// aria-labels like "1,179 photos" / "31,210,495 views" -> { photos, reviews, videos, views }
const STAT_PLURAL = { photo: 'photos', review: 'reviews', video: 'videos', view: 'views' };
function parseStatArias(arias) {
  const stats = {};
  for (const a of arias || []) {
    const m = String(a).match(/([\d.,]+)\s+(photos?|reviews?|videos?|views?)\s*$/i);
    if (!m) continue;
    const singular = m[2].toLowerCase();
    const key = STAT_PLURAL[singular] || singular;
    try {
      stats[key] = normalizeCount(m[1]);
    } catch {
      // ignore unparseable numbers, keep going
    }
  }
  return stats;
}

module.exports = {
  parseContribInput,
  contribUrl,
  normalizeCount,
  parseLevel,
  parsePoints,
  parseRating,
  parsePlaceFromShare,
  findRelativeDate,
  parseReviewBody,
  parseReviewPhotoCount,
  parseStatArias,
};
