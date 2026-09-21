'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
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
  toAbsoluteDate,
  splitOwnerResponse,
  parseProxy,
  parseContributions,
} = require('../lib/contrib');
const { parseArgs } = require('../bin/cli');

test('parseContribInput accepts links and bare ids', () => {
  assert.equal(
    parseContribInput('https://www.google.ro/maps/contrib/101748490797307835131/contribute/@51.303414,-0.1497114,10z/data=!4m3!8m2!3m1!1e1?entry=ttu'),
    '101748490797307835131'
  );
  assert.equal(parseContribInput('https://www.google.com/maps/contrib/123456789012345678901?hl=en'), '123456789012345678901');
  assert.equal(parseContribInput('  101748490797307835131  '), '101748490797307835131');
  assert.throws(() => parseContribInput('https://www.google.com/maps/place/Paris'), /contributor id/);
  assert.throws(() => parseContribInput('abc'), /contributor id/);
  assert.throws(() => parseContribInput(''), /contributor id/);
});

test('contribUrl builds a canonical link', () => {
  assert.equal(contribUrl('123', 'en'), 'https://www.google.com/maps/contrib/123?hl=en');
  assert.equal(contribUrl('123'), 'https://www.google.com/maps/contrib/123?hl=en');
});

test('normalizeCount handles locale separators', () => {
  assert.equal(normalizeCount('1,179'), 1179);
  assert.equal(normalizeCount('11.041'), 11041);
  assert.equal(normalizeCount('31,210,495'), 31210495);
  assert.equal(normalizeCount('7'), 7);
  assert.throws(() => normalizeCount('n/a'), /no digits/);
});

test('parseLevel / parsePoints', () => {
  assert.equal(parseLevel('Local Guide Level 7'), 7);
  assert.equal(parseLevel('Local Guide Level 10'), 10);
  assert.equal(parseLevel('nothing here'), null);
  assert.deepEqual(parsePoints('11.041 / 15.000 points'), { points: 11041, pointsForNextLevel: 15000 });
  assert.deepEqual(parsePoints('no points yet'), { points: null, pointsForNextLevel: null });
});

test('parseRating', () => {
  assert.equal(parseRating('5 stars'), 5);
  assert.equal(parseRating('1 star'), 1);
  assert.equal(parseRating('4 stars'), 4);
  assert.equal(parseRating('bogus'), null);
});

test('parsePlaceFromShare strips wrapper', () => {
  assert.equal(parsePlaceFromShare('Share Therme Bucharest\'s review.'), 'Therme Bucharest');
  assert.equal(parsePlaceFromShare('Share "Drumul Taberei" Park\'s review.'), '"Drumul Taberei" Park');
  assert.equal(parsePlaceFromShare('Share TED\'S COFFEE CO. Romana\'s review.'), 'TED\'S COFFEE CO. Romana');
});

test('findRelativeDate', () => {
  assert.equal(findRelativeDate('foo a month ago bar'), 'a month ago');
  assert.equal(findRelativeDate('visited 2 years ago, loved it'), '2 years ago');
  assert.equal(findRelativeDate('3 days ago'), '3 days ago');
  assert.equal(findRelativeDate('Edited 7 months ago'), 'Edited 7 months ago');
  assert.equal(findRelativeDate('no date here'), null);
});

const LONG_CARD = [
  '', '5 stars', 'a month ago',
  'Therme Bucharest is one of the most relaxing places I\'ve been to.',
  'There are plenty of pools and areas to suit all tastes.',
  '… More', 'Translated by Google', '・', 'See original (Romanian)', '+5', 'Like', 'Share', '',
].join('\n');

const SHORT_CARD = ['5 stars', '2 weeks ago', 'Great coffee, friendly staff.', 'Like', 'Share'].join('\n');

test('parseReviewBody drops chrome, keeps prose', () => {
  const long = parseReviewBody(LONG_CARD, 'a month ago');
  assert.ok(long.text.startsWith('Therme Bucharest is one of'));
  assert.ok(long.text.includes('plenty of pools'));
  assert.ok(!long.text.includes('Translated by Google'));
  assert.ok(!long.text.includes('See original'));
  assert.ok(!long.text.includes('Like'));
  assert.ok(!/5 stars/.test(long.text));
  assert.ok(!long.text.endsWith('More'));
  assert.ok(long.text.endsWith('…'));
  assert.equal(long.truncated, true);

  const short = parseReviewBody(SHORT_CARD, '2 weeks ago');
  assert.equal(short.text, 'Great coffee, friendly staff.');
  assert.equal(short.truncated, false);
});

test('parseReviewBody drops stars, date and place heading', () => {
  const card = ['5 stars', 'Therme Bucharest', 'a month ago', 'Loved it.', 'Like', 'Share'].join('\n');
  const r = parseReviewBody(card, 'a month ago', 'Therme Bucharest');
  assert.equal(r.text, 'Loved it.');
  assert.equal(r.truncated, false);
});

test('parseReviewPhotoCount', () => {
  assert.equal(
    parseReviewPhotoCount(['Photo 1 on X\'s review', 'Photo 2 on X\'s review', '+ 5 more photos on X\'s review']),
    7
  );
  assert.equal(parseReviewPhotoCount(['Photo 1 on X\'s review']), 1);
  assert.equal(parseReviewPhotoCount([]), 0);
  assert.equal(parseReviewPhotoCount(['Like']), 0);
});

test('parseStatArias', () => {
  assert.deepEqual(
    parseStatArias(['1,179 photos', '31,210,495 views', '512 reviews', 'Profile photo', 'Learn more about legal disclosure']),
    { photos: 1179, views: 31210495, reviews: 512 }
  );
});

test('toAbsoluteDate approximates relative dates', () => {
  const base = '2026-09-21T06:00:00.000Z';
  assert.equal(toAbsoluteDate('a month ago', base), '2026-08-22T06:00:00.000Z');
  assert.equal(toAbsoluteDate('2 weeks ago', base), '2026-09-07T06:00:00.000Z');
  assert.equal(toAbsoluteDate('Edited 7 months ago', base), '2026-02-23T06:00:00.000Z');
  assert.equal(toAbsoluteDate('an hour ago', base), '2026-09-21T05:00:00.000Z');
  assert.equal(toAbsoluteDate('bogus', base), null);
  assert.equal(toAbsoluteDate('a month ago', 'not-a-date'), null);
});

test('splitOwnerResponse separates owner replies', () => {
  const card = 'Great place.\nLike\nShare\nResponse from the owner\n4 months ago\nThank you very much!\nTranslated by Google\nLike\nShare';
  const { main, owner } = splitOwnerResponse(card);
  assert.ok(!main.includes('Response from the owner'));
  assert.equal(owner.date, '4 months ago');
  assert.equal(owner.text, 'Thank you very much!');
  const none = splitOwnerResponse('Just a review.\nLike\nShare');
  assert.equal(none.main, 'Just a review.\nLike\nShare');
  assert.equal(none.owner, null);
});

test('parseProxy accepts http and socks5 with optional auth', () => {
  assert.deepEqual(parseProxy('http://127.0.0.1:8080'), { server: 'http://127.0.0.1:8080' });
  assert.deepEqual(parseProxy('http://user:pass@host:3128'), { server: 'http://host:3128', username: 'user', password: 'pass' });
  assert.deepEqual(parseProxy('socks5://host:1080'), { server: 'socks5://host:1080' });
  assert.throws(() => parseProxy('ftp://host:21'), /unsupported.*scheme/);
  assert.throws(() => parseProxy('not a url'), /invalid --proxy/);
  assert.throws(() => parseProxy('http://'), /invalid --proxy/);
});

test('parseContributions reads the totals dialog', () => {
  const dlg = [
    'Contributions from Jane Doe', '11.041 / 15.000 points',
    'X', 'Reviews', '143',
    'Y', 'Ratings', '41',
    'Z', 'Photos', '1,108',
    'W', 'Videos', '109',
    'V', 'Q&A', '3',
    'U', 'Roads added', '0',
    'Learn more about points',
  ].join('\n');
  assert.deepEqual(parseContributions(dlg), {
    reviews: 143,
    ratings: 41,
    photos: 1108,
    videos: 109,
    qa: 3,
    roadsAdded: 0,
  });
  assert.deepEqual(parseContributions('nothing useful here'), {});
  assert.deepEqual(parseContributions(''), {});
});

test('parseArgs defaults and flags', () => {
  const d = parseArgs(['123456789012345678901']);
  assert.equal(d.input, '123456789012345678901');
  assert.equal(d.reviews, 20);
  assert.equal(d.photos, 20);
  assert.equal(d.proxy, undefined);
  assert.equal(d.hl, 'en');
  assert.equal(d.timeoutMs, 45000);
  assert.equal(d.headed, false);

  const f = parseArgs(['123', '--reviews', '50', '--hl=ro', '--timeout=10000', '--headed', '--browser-channel', 'msedge', '--out=x.json', '--dump-raw', './raw']);
  assert.equal(f.reviews, 50);
  assert.equal(f.hl, 'ro');
  assert.equal(f.timeoutMs, 10000);
  assert.equal(f.headed, true);
  assert.equal(f.channel, 'msedge');
  assert.equal(f.out, 'x.json');
  assert.equal(f.dumpRaw, './raw');

  assert.equal(parseArgs(['123', '--reviews=0']).reviews, 0);
  assert.equal(parseArgs(['123', '--photos', '0']).photos, 0);
  assert.deepEqual(parseArgs(['123', '--proxy', 'socks5://h:1080']).proxy, { server: 'socks5://h:1080' });
  assert.throws(() => parseArgs(['123', '--proxy', 'bogus']), /invalid --proxy/);
  assert.throws(() => parseArgs(['123', '--photos', '-1']), /invalid --photos/);
  assert.throws(() => parseArgs(['123', '--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['123', '--reviews']), /requires a value/);
  assert.throws(() => parseArgs(['123', '--reviews', '-3']), /invalid --reviews/);
  assert.throws(() => parseArgs(['123', 'extra']), /unexpected argument/);
});
