# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-21

### Added

- CLI (`maps-contrib <profile-link-or-id>`) returning profile + reviews as JSON
- Profile header: name, Local Guide level, bio, points, avatar, photo/view stats
- Reviews with place, rating, relative date, clean text, truncation flag, photo counts
- Auto-scroll collection with `--reviews` cap, `--hl`, `--timeout`, `--headed`,
  `--browser-channel`, `--out`, `--dump-raw` flags
- Cookie-consent auto-dismissal ("Reject all")
- Unit tests for all parsing (`npm test`, no browser needed)
- MIT license
