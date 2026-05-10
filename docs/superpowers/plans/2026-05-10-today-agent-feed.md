# Today Agent Feed Rebuild Log

Date: 2026-05-10

## Summary

Rebuilt Today from a dashboard/briefing view into an agent-curated feed workspace. RSS sources remain the raw database, while Today now shows a prioritized feed, a compact Summary, tag filtering, and a wider article reading panel.

## Key Changes

- Added a server-side background worker through Next instrumentation to refresh feeds while the server is running.
- Removed browser-side RSS refresh scheduling to avoid duplicate or page-dependent ingestion.
- Added AI/deterministic Priority Feed ranking with stronger preference for AI, technology, semiconductors, cloud, cybersecurity, markets, startups, and tech business.
- Reduced generic politics, military, and international news unless directly relevant to tech/business.
- Added immediate deterministic Today payloads while AI curation revalidates in the background.
- Anchored fresh relevant items so new Priority Feed entries do not appear briefly and then disappear after AI curation.
- Added one-paragraph Today Summary generated from Priority Feed content on a 12-hour cadence, with deterministic fallback.
- Added automatic full-article download for selected Priority Feed items and reprocesses enrichment after richer content is stored.
- Updated Today UI with Summary left, tag card below Summary, Priority Feed center, wider article panel right, keyboard navigation, first-item selection, and adjustable panel widths.

## Verification

- `npx tsc --noEmit`
- targeted `eslint`
- `npm run test`
- live `/api/today` and `/api/today/summary` checks against `data/intellideck.db`

## Known Source Issues

- `https://www.reutersagency.com/feed/` currently returns 404.
- `https://www.zaobao.com.sg/rss/realtime/china` currently returns 404.
- `https://36kr.com/feed` currently returns malformed XML.

## Dev Database Recovery

After running the app from the SynologyDrive project folder, the local SQLite database showed `database disk image is malformed`. Synology conflict files existed for the SQLite WAL/SHM files, so the live dev database was recovered with `sqlite3 .recover`, cleaned with `PRAGMA integrity_check`, and moved to `~/Library/Application Support/IntelliDeckDev/data/intellideck.db`.

`npm run dev` now sets `RSSDECK_DATA_DIR` to that non-synced development data directory. Malformed RSS responses now return a clean `422` JSON error instead of surfacing as a server exception.
