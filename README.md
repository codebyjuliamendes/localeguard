# LocaleGuard

Localization QA for product teams. LocaleGuard compares every translated catalog against your source catalog and catches the
problems that usually reach production: missing or empty translations, broken placeholders, incomplete plural forms, text that
will not fit the UI, and right-to-left (RTL) pitfalls.

It ships as three entry points over one typed domain:

- **Web dashboard** — browse locales, read findings with the offending text in context, edit a catalog and rescan.
- **HTTP API** — JSON API used by the dashboard and by your own tooling.
- **CLI** — `localeguard` for CI pipelines, with text or JSON output and meaningful exit codes.

## Checks

Every scan runs the same pure, deterministic checks (`src/domain`). Lengths are measured in **grapheme clusters**
(`Intl.Segmenter`), so `👩🏽‍💻` or `é` (e + combining accent) count as one character; plural rules come from CLDR via `Intl.PluralRules`.

| Check                           | Severity | Example that triggers it                                                                      |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| Missing translation             | blocker  | `cancel` exists in `en-US` but not in `de-DE`                                                 |
| Empty translation               | blocker  | `"cancel": "  "` (whitespace only) while the source is not empty                              |
| Placeholder mismatch            | blocker  | `Hello {name}` → `Hallo {user}`; `%s has %d` → `%d hat %s`; `{{user}}` → `{{name}}`           |
| Malformed message               | blocker  | `Hallo {name` (unclosed), `a } b` (stray brace)                                               |
| Missing `other` plural / select | blocker  | `{n, plural, one {#}}`                                                                        |
| Duplicate / invalid key         | blocker  | `{"a.b": "x", "a": {"b": "y"}}`, a number or array as a value                                 |
| Direction mismatch              | blocker  | an `ar-SA` catalog declared as `ltr`                                                          |
| Incomplete plural forms         | warning  | `ar-SA` translation with only `one`/`other` (Arabic needs `zero, one, two, few, many, other`) |
| Text exceeds UI budget          | warning  | `Arbeitsbereich löschen` (22) for a 20-character budget                                       |
| Text expansion                  | warning  | translation longer than 155% of a source of 11+ characters                                    |
| Unknown key                     | warning  | key present in the translation but not in the source                                          |
| Missing RTL script              | warning  | `"cancel": "Cancel"` left untranslated in `he-IL`                                             |
| Unbalanced bidi controls        | warning  | U+202B (RLE) without a closing U+202C (PDF)                                                   |
| Empty source string             | warning  | `"title": ""` in the source catalog                                                           |
| Bidi isolation recommended      | info     | `مرحبًا {name}` — wrap `{name}` in U+2068…U+2069 or render it in `<bdi>`                      |
| Unused plural form              | info     | `few` in a German plural (German never selects it)                                            |

**Placeholder dialects.** ICU MessageFormat (`{name}`, `{n, number, ::currency/EUR}`, `{count, plural, …}`, `select`,
`selectordinal`, `#`, apostrophe escaping), mustache / i18next (`{{name}}`, `{{- name}}`) and printf (`%s`, `%d`, `%.2f`,
positional `%1$s`, literal `%%`). Named and positional placeholders are compared as sets (translators may reorder them);
non-positional printf conversions are compared in order. Placeholders inside plural/select branches are included, and
plural messages are measured by their **longest branch** for budgets.

**Catalog shape.** Flat dotted keys, nested objects, or a mix (`{"nav": {"settings": "…"}}` ≡ `{"nav.settings": "…"}`).
**RTL locales**: `ar`, `he`, `fa`, `ur` (plus `ps`, `yi`, `dv`, `ckb`, `sd`, `ug` and any tag with an Arabic/Hebrew script subtag).

## CLI and CI

```bash
# one catalog (flags compatible with the original scripts/check-catalog.js)
npm run locale:check -- --base locales/en-US.json --locale de-DE --file locales/de-DE.json

# every *.json next to the base, failing on warnings too, with length budgets
npm run locale:check -- --base locales/en-US.json --dir locales --budgets budgets.json --fail-on warning

# machine-readable report
npm run --silent locale:check -- --base locales/en-US.json --dir locales --format json > report.json

# compiled binary (after npm run build, or inside the Docker image)
node dist/cli/index.js --help
```

| Option              | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `--base <file>`     | Source catalog; its file name is the base locale unless `--base-locale` |
| `--file <file>`     | Target catalog, repeatable; locale inferred from the file name          |
| `--locale <tag>`    | Locale of a single `--file`                                             |
| `--dir <folder>`    | Check every `*.json` in a folder except the base                        |
| `--budgets <file>`  | JSON object `{ "key": maxCharacters }`                                  |
| `--fail-on <level>` | `blocker` (default), `warning`, `info` or `none`                        |
| `--format <format>` | `text` (default) or `json`                                              |
| `-q, --quiet`       | Summary line only                                                       |

Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage or input error (missing file, invalid JSON).

Text output (`stderr` when failing):

```
ERROR  de-DE:cancel  Missing translation: No de-DE string exists for this key.
ERROR  de-DE:welcome  Placeholder mismatch: Expected {name}; found {user}.
Found 2 blocker(s), 0 warning(s), 0 notice(s) in 1 catalog(s); 66.6% key coverage.
```

`.github/workflows/locale-check.yml` runs the CLI on every pull request with `--fail-on warning` and uploads the JSON report as
an artifact. To reuse it elsewhere, copy the workflow and point `--base`/`--dir` at your catalogs.

## API

All responses are JSON. Errors share one shape: `{ "error": string, "requestId": string, "details"?: string[] }`.
Every response carries an `x-request-id` header (a well-formed incoming `x-request-id` is reused).

| Method | Path                                 | Description                                                | Success |
| ------ | ------------------------------------ | ---------------------------------------------------------- | ------- |
| GET    | `/api/health`                        | Liveness + database check (`503` when degraded)            | 200     |
| GET    | `/api/workspace`                     | Projects, locale count, latest scan                        | 200     |
| GET    | `/api/projects/:id`                  | Project, budgets, catalogs, live issues and coverage       | 200     |
| GET    | `/api/projects/:id/scans/:scanId`    | A stored scan with its issues                              | 200     |
| POST   | `/api/projects/:id/scan`             | Run and store a scan                                       | 201     |
| PUT    | `/api/projects/:id/catalogs/:locale` | Create/replace a catalog `{ strings, direction? }`, rescan | 200     |
| PUT    | `/api/projects/:id/budgets`          | Replace length budgets `{ budgets }`                       | 200     |
| POST   | `/api/projects`                      | Create `{ name, baseLocale, catalogs, budgets? }`          | 201     |

Write routes (`POST`/`PUT`) are rate limited per client (`429` with `retry-after`). Limits: 20 catalogs per project, 5 000 keys
per catalog, 2 000 characters per string, 8 nesting levels, 800 KB per request body.

```bash
curl -s -X PUT localhost:3007/api/projects/1/catalogs/pt-BR \
  -H 'content-type: application/json' \
  -d '{"strings": {"nav": {"settings": "Configurações"}}}'
```

Issues look like `{ locale, key, severity: "blocker" | "warning" | "info", code, kind, detail }`; `code` is stable and
machine-readable (e.g. `placeholder_mismatch`), `kind`/`detail` are for humans.

## Running

Requirements: Node.js 22 (see `.nvmrc`; Node 20.19+ is supported).

```bash
npm ci
npm run dev          # esbuild watch (client) + tsx watch (server) on http://localhost:3007
npm run build        # dist/ (server, CLI) + dist/web (client bundle, fonts)
npm start            # production server from dist/
```

The demo project ("Orbit Workspace") is seeded into an empty database; its catalogs intentionally contain issues.

### Docker

```bash
docker compose up --build           # http://localhost:3007, data in the localeguard-data volume
docker build -t localeguard . && docker run -p 3007:3007 -v lg-data:/data localeguard
```

The image is multi-stage (TypeScript build → `node:22-bookworm-slim` runtime with production dependencies only), runs as the
unprivileged `node` user, stores SQLite in the `/data` volume and has a `HEALTHCHECK` on `/api/health`. `NODE_IMAGE` can be
overridden at build time (registry mirror, pinned digest).

### Configuration

All variables are validated with Zod at boot; an invalid value stops the process with a clear message. See `.env.example`.

| Variable              | Default                     | Description                                        |
| --------------------- | --------------------------- | -------------------------------------------------- |
| `PORT`                | `3007`                      | HTTP port                                          |
| `HOST`                | `0.0.0.0`                   | Bind address                                       |
| `DATABASE_PATH`       | `./data/localeguard.sqlite` | SQLite file (`/data/localeguard.sqlite` in Docker) |
| `LOG_LEVEL`           | `info`                      | `fatal` … `trace`, or `silent`                     |
| `SEED_DEMO`           | `true`                      | Seed the demo project into an empty database       |
| `TRUST_PROXY`         | `false`                     | Trust `X-Forwarded-*` (set behind a reverse proxy) |
| `BODY_LIMIT_BYTES`    | `819200`                    | Maximum request body                               |
| `RATE_LIMIT_MAX`      | `60`                        | Write requests per client per window               |
| `RATE_LIMIT_WINDOW`   | `1 minute`                  | Rate-limit window                                  |
| `SHUTDOWN_TIMEOUT_MS` | `10000`                     | Grace period before a forced exit on SIGTERM       |

### Quality gates

```bash
npm run check   # lint + typecheck + format:check + tests with coverage thresholds + build
```

Individual scripts: `lint` (ESLint 9, type-checked `typescript-eslint`), `typecheck` (`tsc --noEmit` for server and client),
`format` / `format:check` (Prettier), `test` / `coverage` (Vitest).

## Project structure

```
src/
  domain/     pure, typed checks: catalog flattening, message parser, locale/plural/RTL rules, inspectCatalogs()
  store/      better-sqlite3 database, versioned migrations, repository, demo seed
  services/   ProjectService — orchestrates repository + domain (transactions, limits)
  http/       Fastify app, routes, Zod schemas, error mapping, shared HTTP contract types
  cli/        localeguard CLI (node:util parseArgs) over the same domain
  web/        browser client (TypeScript → esbuild), theme bootstrap, styles
  config.ts   environment schema; server.ts entry point with graceful shutdown
public/       index.html and the logo
scripts/      build-web.ts, dev.ts
test/         unit (domain, store, config, web helpers), HTTP integration (fastify.inject), CLI
locales/      sample catalogs checked in CI
```

## Architecture and decisions

- **TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM).** The checks are string-processing
  code full of edge cases; strict types make every "this key may be missing" path explicit. The HTTP contract
  (`src/http/contract.ts`) is shared, type-only, by the server and the browser client, so a contract change fails `tsc`
  on both sides.
- **One domain, three adapters.** `inspectCatalogs()` is pure and synchronous; the API, the CLI and the tests call the same
  function, so CI and the dashboard cannot disagree.
- **Fastify 5** instead of Express: first-class async error handling, built-in pino logging with request ids, `inject()` for
  fast integration tests, and maintained plugins for static files, Helmet and rate limiting.
- **Zod** validates the environment and request bodies (recursive catalog schema, locale tags via `Intl.getCanonicalLocales`).
- **better-sqlite3** rather than `node:sqlite`: `node:sqlite` is still experimental on Node 22 (and absent from the Node 20 we
  support), while better-sqlite3 is mature, synchronous (simple transactions) and ships prebuilt binaries. WAL mode,
  `busy_timeout`, foreign keys. Migrations are append-only and tracked with `PRAGMA user_version`; migration 1 is the original
  schema (`IF NOT EXISTS`), so databases created by the previous Express server upgrade in place.
- **Client in TypeScript, bundled by esbuild** (no framework): it reuses the contract types and esbuild is already part of the
  toolchain. All rendering goes through a tiny DOM builder that only uses text nodes and `setAttribute` — translations are
  third-party content and never become markup.
- **Security headers:** strict CSP (`script-src 'self'; style-src 'self'`, no `unsafe-inline`), self-hosted fonts (no
  third-party requests), `frame-ancestors 'none'`, JSON prototype-poisoning protection, bounded bodies and catalogs.
- **Logs:** JSON (pino) with request ids; `authorization`, `cookie` and `set-cookie` are redacted; health probes log at `warn`.

## Production notes

- Run behind a TLS-terminating reverse proxy; set `TRUST_PROXY=true` so rate limits see client IPs. HSTS belongs on the proxy.
- `SIGTERM` stops accepting connections, drains in-flight requests and closes the database; after `SHUTDOWN_TIMEOUT_MS`
  the process exits forcibly.
- Back up `/data` (SQLite + WAL). One instance per database file — SQLite is not shared across replicas.
- Set `SEED_DEMO=false` for real workspaces.

## Limitations

- There is **no authentication**: deploy on a trusted network or behind an authenticating proxy.
- Rate limiting is in-memory (per instance).
- Length budgets count characters, not rendered pixels; placeholders count as their source text (`{name}` = 6) because
  runtime values are unknown.
- The plural check accepts `=0`/`=1`/`=2` in place of `zero`/`one`/`two`, which is exact for most but not all locales.
- Bidi isolation hints are heuristics; numeric placeholders (`{n, number}`, `%d`) are not flagged.
- Only JSON catalogs are read (no XLIFF, `.po`, `.strings` or ARB yet).
