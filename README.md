# LocaleGuard

Localization QA for product teams. Catch missing translations, inconsistent placeholders, unexpected keys, text overflow budgets, and right-to-left layout requirements before release.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3007`. Demo catalogs are seeded automatically. Edit the German catalog, save it, and see the quality scan update immediately.

## Stack

- Node.js + Express API
- SQLite persistence with `better-sqlite3`
- Responsive vanilla JavaScript dashboard

## MVP scope

This version analyzes JSON catalogs and configured character budgets. It does not render application screens or take browser screenshots; runtime screenshot-based visual QA is a natural next integration. The included catalogs intentionally contain issues so the first scan is useful immediately.

## API

- `GET /api/workspace` — workspace overview
- `GET /api/projects/:id` — catalogs and scan history
- `GET /api/projects/:id/scans/:scanId` — scan result
- `POST /api/projects/:id/scan` — analyze all catalogs
- `PUT /api/projects/:id/catalogs/:locale` — update a catalog and rescan
- `POST /api/projects` — create a project and its source/target catalogs

## Quality checks

Missing and blank keys, placeholder parity (`{name}`), unexpected keys, per-key length budgets, expansion ratios, and locale text direction are checked on every scan.
