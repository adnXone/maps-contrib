#!/usr/bin/env node
'use strict';

// maps-contrib: fetch structured Google Maps contributor data.
// Usage: maps-contrib <profile-link-or-id> [options]

const fs = require('fs');
const path = require('path');
const { parseContribInput, contribUrl, parseProxy } = require('../lib/contrib');
const { scrapeContributor } = require('../lib/scrape');

function printHelp() {
  console.log(`Usage: maps-contrib <profile-link-or-id> [options]

Arguments:
  profile-link-or-id   Full /maps/contrib/<id> link (viewport params ignored)
                       or a bare numeric contributor id.

Options:
  --reviews <n>        Max reviews to collect (default: 20, 0 = profile only)
  --photos <n>         Max photos to collect (default: 20, 0 = skip)
  --proxy <url>        Route browser traffic through a proxy
                       (http://host:port, http://user:pass@host:port, socks5://host:port)
  --hl <locale>        Interface language for Google Maps (default: en)
  --timeout <ms>       Navigation/wait timeout (default: 45000)
  --headed             Show the browser window (debug aid)
  --browser-channel <c> Use a system browser (msedge, chrome) instead of the
                       bundled Playwright Chromium
  --out <file>         Write JSON to a file instead of stdout
  --dump-raw <dir>     Save screenshot + raw HTML (debugging / re-parsing)
  -h, --help           Show this help

Examples:
  maps-contrib https://www.google.com/maps/contrib/101748490797307835131
  maps-contrib 101748490797307835131 --reviews 50 --out contrib.json
  maps-contrib <id> --reviews 0 --dump-raw ./raw
  maps-contrib <id> --photos 30 --proxy http://127.0.0.1:8080`);
}

function parseArgs(argv) {
  const opts = {
    input: null,
    reviews: 20,
    photos: 20,
    hl: 'en',
    timeoutMs: 45000,
    headed: false,
    channel: undefined,
    proxy: undefined,
    out: null,
    dumpRaw: null,
  };
  const takeValue = (arg, i) => {
    if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reviews' || arg.startsWith('--reviews=')) {
      const v = arg.includes('=') ? arg.slice('--reviews='.length) : takeValue(arg, i++);
      opts.reviews = parseInt(v, 10);
      if (!Number.isInteger(opts.reviews) || opts.reviews < 0) throw new Error(`invalid --reviews: ${v}`);
    } else if (arg === '--photos' || arg.startsWith('--photos=')) {
      const v = arg.includes('=') ? arg.slice('--photos='.length) : takeValue(arg, i++);
      opts.photos = parseInt(v, 10);
      if (!Number.isInteger(opts.photos) || opts.photos < 0) throw new Error(`invalid --photos: ${v}`);
    } else if (arg === '--proxy' || arg.startsWith('--proxy=')) {
      const v = arg.includes('=') ? arg.slice('--proxy='.length) : takeValue(arg, i++);
      opts.proxy = parseProxy(v); // throws on bad URL/scheme
    } else if (arg === '--hl' || arg.startsWith('--hl=')) {
      opts.hl = arg.includes('=') ? arg.slice('--hl='.length) : takeValue(arg, i++);
    } else if (arg === '--timeout' || arg.startsWith('--timeout=')) {
      const v = arg.includes('=') ? arg.slice('--timeout='.length) : takeValue(arg, i++);
      opts.timeoutMs = parseInt(v, 10);
      if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error(`invalid --timeout: ${v}`);
    } else if (arg === '--headed') {
      opts.headed = true;
    } else if (arg === '--browser-channel' || arg.startsWith('--browser-channel=')) {
      opts.channel = arg.includes('=') ? arg.slice('--browser-channel='.length) : takeValue(arg, i++);
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      opts.out = arg.includes('=') ? arg.slice('--out='.length) : takeValue(arg, i++);
    } else if (arg === '--dump-raw' || arg.startsWith('--dump-raw=')) {
      opts.dumpRaw = arg.includes('=') ? arg.slice('--dump-raw='.length) : takeValue(arg, i++);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!opts.input) {
      opts.input = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return opts;
}

async function dumpRawArtifacts(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({ path: path.join(dir, `page-${stamp}.png`) });
  fs.writeFileSync(path.join(dir, `page-${stamp}.html`), await page.content(), 'utf8');
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}\n`);
    printHelp();
    process.exit(1);
  }
  if (!opts.input) {
    console.error('error: missing <profile-link-or-id>\n');
    printHelp();
    process.exit(1);
  }

  let id;
  try {
    id = parseContribInput(opts.input);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }

  let pageRef = null;
  try {
    const fetchedAt = new Date().toISOString();
    const { profile, reviews, photos } = await scrapeContributor({
      id,
      hl: opts.hl,
      maxReviews: opts.reviews,
      maxPhotos: opts.photos,
      timeoutMs: opts.timeoutMs,
      headed: opts.headed,
      channel: opts.channel,
      proxy: opts.proxy,
      fetchedAt,
      hooks: { onPage: (p) => { pageRef = p; } },
    });
    const output = {
      contributor: { id, url: contribUrl(id, opts.hl) },
      profile,
      reviews,
      photos,
      meta: {
        fetchedAt,
        reviewsRequested: opts.reviews,
        reviewsReturned: reviews.length,
        photosRequested: opts.photos,
        photosReturned: photos.length,
      },
    };
    const json = JSON.stringify(output, null, 2);
    if (opts.dumpRaw && pageRef) await dumpRawArtifacts(pageRef, opts.dumpRaw);
    if (opts.out) {
      fs.writeFileSync(opts.out, json + '\n', 'utf8');
      console.error(`wrote ${opts.out} (${reviews.length} reviews, ${photos.length} photos)`);
    } else {
      console.log(json);
    }
  } catch (e) {
    if (opts.dumpRaw && pageRef) {
      try {
        await dumpRawArtifacts(pageRef, opts.dumpRaw);
        console.error(`saved debug artifacts to ${opts.dumpRaw}`);
      } catch {
        // best effort only
      }
    }
    console.error(`error: ${(e && e.message) || e}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
module.exports = { parseArgs };
