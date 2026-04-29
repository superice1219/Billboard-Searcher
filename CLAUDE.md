# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 规则

- 用中文回答。
- 每次完成代码改动后，主动提交并推送到 GitHub（先检查改动内容，确认无误后 commit + push）。

## Build & Run

```bash
# Frontend TypeScript build
npm run build          # tsc: src/app.ts → static/app.js
npm run watch          # tsc --watch

# Backend
pip install flask requests beautifulsoup4
python app.py          # Flask dev server on port 5000, debug=True

# Data updates
python update_data.py          # CLI: fetch missing weeks from Billboard
python year_end_scraper.py     # Full re-scrape of year-end charts (1958–2025)
```

## Architecture

**Backend**: Python Flask single-file app (`app.py`). On startup, `build_indexes()` loads `billboard_data.json` and `billboard_year_end.json` into in-memory dicts and builds lookup indexes (`songs_by_date: date → [(rank, key)]`). All routes read from memory; data updates happen in a background thread with a lock.

**Data format** — `billboard_data.json`: `{ "Title - Artist": [{date, rank, weeks}, ...] }`. The `"Title - Artist"` string is the universal key across all lookups. `billboard_year_end.json`: `{ "2024": [{rank, title, artist}, ...] }`.

**Scraping** — `scraper.py` handles weekly Hot 100 via Billboard's `o-chart-results-list-row` HTML structure. `year_end_scraper.py` handles year-end pages (different DOM layout). Both use requests + BeautifulSoup with a desktop Chrome UA.

**Algorithms** (`algorithms.py`):
1. `span_ranking()` — Accumulates inverse-rank points (101-rank) weighted by position multiplier (#1=2x, top 3=1.5x, etc.) plus streak bonuses for consecutive #1/top-5/top-10 runs.
2. `predict_year_end()` — YTD actual points + projection model using 4-week rank drift with exponential damping, estimated longevity by position tier. Tracking period: Nov 15 to Nov 15.

**Frontend** — SPA in `templates/index.html` with multiple views toggled by CSS classes. `src/app.ts` compiled to `static/app.js`. Chart.js v4 loaded via CDN; TypeScript uses `import type` (erased at compile time) for Chart.js types. The `declare const Chart` bridges the CDN global.

## Routing overview

| Route | Returns |
|-------|---------|
| `/api/current` | Latest chart week |
| `/api/song/<key>` | Single song chart run + stats |
| `/api/search?q=` | Fuzzy title/artist search |
| `/api/artist/<name>` | All songs by artist with #1/top10 counts |
| `/api/chart/<date>` | Chart for a specific Saturday |
| `/api/rankings?start=&end=` | Custom span ranking |
| `/api/predict/<year>` | Year-end prediction |
| `/api/year-end/<year>` | Year-end chart with weekly stats linked |
| `/api/check-update` | Compare local vs online latest date |
| `/api/update` POST | Trigger background data refresh |
