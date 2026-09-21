# maps-contrib

[![CI](https://github.com/adnxone/maps-contrib/actions/workflows/ci.yml/badge.svg)](https://github.com/adnxone/maps-contrib/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/maps-contrib.svg)](https://www.npmjs.com/package/maps-contrib)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](./package.json)

Fetch structured Google Maps contributor data from a profile link or a bare
contributor ID. Outputs JSON: profile header (name, level, points, stats,
per-category contribution totals) plus the contributor's reviews and photos.

## Install

### From npm (recommended)

```bash
npm install -g maps-contrib
npx playwright install chromium   # one-time browser download (~115 MB)
maps-contrib <profile-link-or-id> --reviews 20
```

No install at all — run straight from the registry:

```bash
npx -y maps-contrib@latest <profile-link-or-id> --reviews 20
```

The browser download is separate from the package and only needed once per
machine (it lands in Playwright's own cache, not in the package folder).
Alternatively, skip it and reuse a system browser:
`--browser-channel msedge` (or `chrome`).

Requires Node.js ≥ 18.

### From source

```bash
git clone https://github.com/adnxone/maps-contrib.git
cd maps-contrib
npm install
npx playwright install chromium
node bin/cli.js <profile-link-or-id>
```

## Usage

```bash
# profile + first 20 reviews (default)
node bin/cli.js https://www.google.com/maps/contrib/101748490797307835131

# bare id, 50 reviews, saved to file
node bin/cli.js 101748490797307835131 --reviews 50 --out contrib.json

# profile + photos, routed through a proxy
node bin/cli.js <id> --reviews 0 --photos 30 --proxy http://127.0.0.1:8080

# profile only, Romanian interface
node bin/cli.js <id> --reviews 0 --hl ro

# show the browser (debugging), keep raw artifacts
node bin/cli.js <id> --headed --dump-raw ./raw
```

With a global install, replace `node bin/cli.js` with `maps-contrib` in all
examples above.

### Options

| Flag | Default | Description |
|---|---|---|
| `--reviews <n>` | `20` | Max reviews to collect (`0` = profile only) |
| `--photos <n>` | `20` | Max photos to collect (`0` = skip) |
| `--proxy <url>` | — | `http(s)://[user:pass@]host:port` or `socks5://…` |
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
    "stats": { "photos": 1179, "views": 31210495 },
    "contributions": {
      "reviews": 143, "ratings": 41, "photos": 1108, "videos": 109,
      "answers": 1479, "edits": 97, "placesAdded": 20, "qa": 3,
      "incidentReports": 1
    }
  },
  "reviews": [
    {
      "place": "Therme Bucharest",
      "rating": 5,
      "date": "a month ago",
      "dateAbsolute": "2026-08-22T07:00:58.697Z",
      "text": "Therme Bucharest is one of the most relaxing places... (full text)",
      "truncated": false,
      "photos": 8,
      "likes": null,
      "owner": {
        "date": "4 months ago",
        "dateAbsolute": "2026-05-24T07:00:58.697Z",
        "text": "Thank you very much!..."
      }
    }
  ],
  "photos": [
    { "url": "https://lh3.googleusercontent.com/gps-cs/...", "place": "Therme Bucharest" }
  ],
  "meta": { "fetchedAt": "2026-09-21T05:54:22.281Z", "reviewsRequested": 5, "reviewsReturned": 5 }
}
```

## How it works

Google serves contributor pages as an empty boot shell — all data loads
client-side. So this tool drives headless Chromium (Playwright): dismisses the
cookie-consent wall ("Reject all"), reads the profile header, opens the
per-category totals dialog (reviews, ratings, photos, videos, answers, edits…
— the only place Google publishes these totals), then opens the Reviews
tab, expands truncated reviews, and auto-scrolls until it has `--reviews` /
`--photos` items or the list is exhausted. Truncated "More" buttons are clicked
with raw mouse events — locator clicks hang on them (the matched nodes are
hidden accessibility copies, and window scrolling navigates the map away).

## Limitations

- Dates are Google's relative strings ("a month ago"); `dateAbsolute` is an
  approximation (month = 30 days, year = 365 days) computed from fetch time.
- Review like counts are not exposed without login (`likes: null`).
- Full-text expansion is best-effort — `truncated: true` means the preview is
  all Maps served.
- Collection scrolls until Google stops serving more items; very long
  histories may be cut short by throttling — `meta.reviewsReturned` /
  `meta.photosReturned` tell you what you actually got.
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
