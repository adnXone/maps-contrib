# maps-contrib

[![CI](https://github.com/adnxone/maps-contrib/actions/workflows/ci.yml/badge.svg)](https://github.com/adnxone/maps-contrib/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/maps-contrib.svg)](https://www.npmjs.com/package/maps-contrib)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](./package.json)

Fetch structured Google Maps contributor data from a profile link or a bare
contributor ID. Outputs JSON: profile header (name, level, points, stats) plus
the contributor's reviews with ratings, dates, text, and photo counts.

## Install

```bash
npm install
npx playwright install chromium   # one-time browser download (~115 MB)
```

Or reuse a system browser instead: `--browser-channel msedge` (or `chrome`).

Requires Node.js ≥ 18.

## Usage

```bash
# profile + first 20 reviews (default)
node bin/cli.js https://www.google.com/maps/contrib/101748490797307835131

# bare id, 50 reviews, saved to file
node bin/cli.js 101748490797307835131 --reviews 50 --out contrib.json

# profile only, Romanian interface
node bin/cli.js <id> --reviews 0 --hl ro

# show the browser (debugging), keep raw artifacts
node bin/cli.js <id> --headed --dump-raw ./raw
```

After `npm install`, the `maps-contrib` binary is also available via
`npx maps-contrib` inside this folder.

### Options

| Flag | Default | Description |
|---|---|---|
| `--reviews <n>` | `20` | Max reviews to collect (`0` = profile only) |
| `--hl <locale>` | `en` | Maps interface language |
| `--timeout <ms>` | `45000` | Navigation/wait timeout |
| `--headed` | off | Show the browser window |
| `--browser-channel <c>` | — | Use a system browser (`msedge`, `chrome`) |
| `--out <file>` | stdout | Write JSON to a file |
| `--dump-raw <dir>` | — | Save screenshot + raw HTML (also on failure) |
| `-h, --help` | — | Show help |

### Example output (trimmed)

```json
{
  "contributor": {
    "id": "101748490797307835131",
    "url": "https://www.google.com/maps/contrib/101748490797307835131?hl=en"
  },
  "profile": {
    "name": "Adrian Marian Paunescu",
    "level": 7,
    "bio": "I love taking photos at night...",
    "points": 11041,
    "pointsForNextLevel": 15000,
    "avatar": "https://lh3.googleusercontent.com/a-/...",
    "stats": { "photos": 1179, "views": 31210495 }
  },
  "reviews": [
    {
      "place": "Therme Bucharest",
      "rating": 5,
      "date": "a month ago",
      "text": "Therme Bucharest is one of the most relaxing places...",
      "truncated": true,
      "photos": 8
    }
  ],
  "meta": { "fetchedAt": "2026-09-21T05:54:22.281Z", "reviewsRequested": 5, "reviewsReturned": 5 }
}
```

## How it works

Google serves contributor pages as an empty boot shell — all data loads
client-side. So this tool drives headless Chromium (Playwright): dismisses the
cookie-consent wall ("Reject all"), reads the profile header, opens the Reviews
tab, and auto-scrolls until it has `--reviews` items or the list is exhausted.

## Limitations (v0.1)

- Reviews only — the Photos tab is not collected yet.
- Dates are Google's relative strings ("a month ago"), not timestamps.
- Owner responses are included inline in the review text.
- Long reviews come back truncated with `truncated: true` (Maps only renders
  the preview until "More" is clicked).
- Review collection scrolls until Google stops serving more items; very long
  histories may be cut short by throttling — `meta.reviewsReturned` tells you
  what you actually got.
- Needs a profile with public reviews; login-walled content is out of scope.
- Google changes its DOM without notice — if extraction breaks, re-run with
  `--dump-raw` and open an issue with the artifacts.

## Fair use

Scraping violates Google's Terms of Service. This is a personal/research tool:
query sparingly, keep `--reviews` modest, cache results, and do not build bulk
harvesting on top of it. The tool rejects tracking cookies by default.

## Dev

```bash
npm test   # unit tests for parsing (no browser needed)
```

## Project Structure

```
├── bin/cli.js          # CLI: args, orchestration, output
├── lib/scrape.js       # Playwright flow (dumb DOM reads)
├── lib/contrib.js      # Pure parsing helpers (unit-tested)
├── test/contrib.test.js
├── .github/            # CI workflow + Dependabot config
├── package.json
├── .nvmrc              # Pinned Node version for contributors
├── CHANGELOG.md        # Release history
├── LICENSE             # MIT
├── README.md           # This file
└── .gitignore
```

## License

MIT — see [LICENSE](./LICENSE).

## Author

**Adrian Marian Paunescu** — [adrian@adnxone.eu](mailto:adrian@adnxone.eu)

- GitHub: [github.com/adnxone](https://github.com/adnxone)
- Sites: [adnxone.eu](https://adnxone.eu) | [adhdadultiromania.eu](https://adhdadultiromania.eu) | [meetaxel.eu](https://meetaxel.eu)
