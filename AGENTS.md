# AGENTS.md — working on Librea with a coding agent

You are editing a student information system. The data it holds is about children, and the people adopting it have no vendor to call. Read this file before changing anything; `docs/architecture.md` has the longer version.

Ground rules that apply to every change: read a file before editing it, keep every file under 500 lines (`npm run build` fails otherwise), validate input at system boundaries, and never write a test or a scratch file into the repository root.

---

## The codebase, one line per module

### `src/core/` — the sovereign layer

| File | What it is |
|---|---|
| `ledger.js` | Append-only, SHA-256 hash-chained JSONL log. `append()`, `replay()`, `verify()`. The source of truth. |
| `store.js` | The in-memory projection plus entity/fragment/fact writes, semantic search, similarity, aggregate stats. Every write goes through here. |
| `schema.js` | The canonical shapes: 15 dimensions, entity types, fragment kinds, visibility levels, role→visibility map, PII field list, validators. |
| `signal.js` | Raw metrics → 15 normalized 0..1 dims, plus cosine/euclidean, pattern flags, the risk score, and arc detection over a timeline. |
| `embed.js` | The local embedder (`all-MiniLM-L6-v2`, 384d). Transformers backend, ruvector WASM fallback. The only model that sees student text. |
| `auth.js` | Local accounts (scrypt), in-memory sessions, invite codes, and `scopeFor()` / `narrowScope()` — the single role→data-ceiling map. |
| `edition.js` | Loads `editions/<id>/edition.json` over `BASE_EDITION`; `t()` substitutes vocabulary in a sentence. |

### `src/api/` — HTTP

| File | What it is |
|---|---|
| `router.js` | ~100-line router on `node:http`. `HttpError`, JSON/HTML senders, safe static file serving, body reader (64 MB cap). |
| `context.js` | Resolves the session into `ctx.user` and `ctx.scope`, narrows by the `x-librea-app` header, and holds `requireUser`, `requireRole`, `canSeeEntity`, `projectEntity`. |
| `routes-core.js` | Auth, users, schema, stats, ledger verify, people, fragments, photos, media, semantic search. |
| `routes-onboard.js` | Create entities from scratch, link families, editions, invites. |
| `routes-sql.js` | Schema browser, scoped SELECT, fact writes/deletes, projection status/rebuild, metric derivation. |
| `routes-export.js` | Bundle JSON, students CSV, fragments CSV, the raw ledger. Admin only. |
| `routes-curriculum.js` | Read-only markdown curriculum documents. |

### `src/sql/` — the relational projection

| File | What it is |
|---|---|
| `schema.js` | DDL, the 14 fact tables (OneRoster 1.1 plus attendance, discipline, services, contacts and the compliance tables), `STUDENT_SCOPED`, `PII_COLS`, `PII_ONLY_TABLES`, `SCHEMA_VERSION`. |
| `projection.js` | Mirrors ledger events into `data/librea.sqlite`. Idempotent, rebuildable, never authoritative. |
| `query.js` | `checkSql()` (one read-only SELECT) and `runScoped()`, which shadows every table with a TEMP view filtered to the caller's scope. |
| `derive.js` | Recomputes a student's raw metrics from attendance/results/incidents/services rows. |

### `src/import/` — vendor CSV in

| File | What it is |
|---|---|
| `csv.js` | Delimiter detection, BOM stripping, quoted-field parsing, duplicate-header renaming. |
| `presets.js` | Canonical fields per file kind, alias dictionaries for PowerSchool / Aeries / Infinite Campus / OneRoster / generic, preset and kind detection. |
| `mapper.js` | `previewImport()` and `applyImport()`: resolve a plan, map rows, upsert entities, never erase a field a CSV does not carry. |
| `values.js` | Every coercion: percentages, GPAs, letter grades, ELL levels, special-ed levels, FRL, dates, attendance codes, safe ids. |
| `facts.js` | Which fact tables a mapping feeds, and row builders for attendance, discipline, gradebook, contacts, services, passthrough kinds. |
| `apply-facts.js` | The per-kind handlers that batch fact rows out of parsed rows. |
| `describe.js` | Turns a student record into the one English sentence that becomes their `record` fragment. |
| `jobs.js` | In-process queue that embeds those record fragments after the HTTP response has gone out. |
| `routes.js` | Admin-only HTTP surface: presets, preview, apply, jobs, sample CSVs. |

### `src/vibe/` — the app layer

| File | What it is |
|---|---|
| `providers.js` | `template` / `ollama` / `anthropic`, `providerInfo()` and `whatLeaves()` — the machine-readable sovereignty statement. |
| `prompt.js` | The system prompt: runtime API contract, SQL schema for this scope, object schema with a **synthetic** row, scope block, hard rules. |
| `apps.js` | Slugs, scope normalization and defaults, the scope badge, and `AppStore` (manifest in the ledger, HTML versions on disk). |
| `shell.js` | The same-origin page that frames an app and relays its calls. |
| `runtime.js` | `window.librea`, injected as the first script of every app. postMessage only; no network. |
| `query.js` | **The broker.** Every op an app can call, each validated and scoped. `K_ANON = 5`. |
| `routes.js` | Generate (SSE), app manifests, publish, the broker endpoint, the shell and the app document. |
| `templates.js` | The offline generator: seven matchers plus a generic fallback, all hand-written. |

### `src/compliance/` — can this school answer the ordinary questions?

| File | What it is |
|---|---|
| `util.js` | Date helpers, weekday tests, July-1 school-year boundaries, current-document resolution, `MAX_FAILING`. |
| `checks-core.js` / `checks-micro.js` / `checks-alt.js` | The checks themselves: pure functions over the SQLite projection returning a status and a capped failing list. |
| `checks.js` | The `PACKS` registry, `checksFor(packs)`, `runCheck`, `runAll`, `summarize`, `describe`. |
| `reports.js` | CSV reports with declared parameters. |
| `routes.js` | Status, one check, catalog, reports, and `/api/compliance/mine` — a family's own to-do list scoped to their children. |

Which packs run comes from the active edition's `compliance.packs`. `src/server.js` imports `./compliance/routes.js` optionally, so a fork that deletes the directory still boots.

### Elsewhere

`public/` is the UI: `app.js` (hash router, `h()` helper, `api()`, the `ROUTES` table) plus one module per page under `public/js/`. `scripts/seed.js` builds the demo district; `scripts/check.js` is `npm run build`. `editions/` holds `micro` and `alt`. `data/seed/` holds the synthetic district, per-grade curriculum and sample vendor CSVs.

---

## Invariants you must not break

1. **The ledger is the source of truth, and every write goes through `Store`.**
   Enforced by `src/core/ledger.js` and `src/core/store.js`. Never write to `data/librea.sqlite` directly, never mutate `store.entities` from outside, never edit `ledger.jsonl` by hand — `verify()` will report the break and it cannot be repaired. If you need a new kind of write, add a `Store` method that appends an event and applies it.

2. **Scope is enforced on the server, never in the browser and never by the model.**
   Enforced by `src/api/context.js` (`scopeFor`, `narrowScope`, `canSeeEntity`, `projectEntity`), `src/core/store.js` (visibility filtering inside `getFragments` and `semanticSearch`) and `src/sql/query.js` (TEMP views that shadow every table). A route that returns entities must pass them through `projectEntity`. A new SQL-reachable table must be added to `STUDENT_SCOPED` or `PII_ONLY_TABLES` in `src/sql/schema.js`, or it leaks.

3. **Apps run sandboxed and reach data only through the broker.**
   Enforced by `src/vibe/routes.js` (opaque-origin iframe, `CSP` constant blocking all network), `src/vibe/runtime.js` (postMessage is the only channel) and `src/vibe/query.js` (every op validated, `K_ANON = 5` suppression for aggregates-only apps). Never add a broker op that bypasses `ctx.scope`. Never let generated HTML be served without `injectRuntime` and the CSP headers.

4. **Model providers receive a prompt and a schema, never a record.**
   Enforced by `src/vibe/prompt.js`: the prompt is built from `src/core/schema.js` constants, `schemaFor(scope)`, and the fabricated `SYNTHETIC_STUDENT` / `SYNTHETIC_FRAGMENT`. If you add anything to the prompt, ask where the value came from; if the answer is `store`, it does not go in. `whatLeaves()` in `src/vibe/providers.js` must stay true of what the code actually sends.

5. **Files stay under 500 lines**, checked by `scripts/check.js` (`npm run build`). Split by responsibility, not by cutting a file in half.

6. **Validate at the boundary.** `validateEntity`/`validateFragment` in `src/core/schema.js`, `upsertFacts`' row check in `store.js`, the `str`/`int`/`oneOf` helpers in `src/vibe/query.js`, `checkSql` in `src/sql/query.js`, the coercions in `src/import/values.js`. A bad row is skipped with a reason; it never takes the batch down.

7. **Write about children with care.** Flags are questions for a human (`src/core/signal.js`, `public/app.js` `QUESTIONS`), never verdicts. Keep it that way in any copy you write.

---

## Recipes

**Add an importer preset.** In `src/import/presets.js`: write the alias dictionary (canonical field → the vendor's column names), a signature array of columns that are distinctive to that vendor, and register it in `PRESETS` via `build()`. Add a sample export to `data/seed/samples/<vendor>-students.csv`. Add a detection test to `tests/import.test.js`. Nothing else changes — the UI reads `GET /api/import/presets`.

**Add a fact table.** In `src/sql/schema.js`: add the entry to `FACT_TABLES` (key, doc, columns), add indexes to `DDL`, add it to `STUDENT_SCOPED` if its rows belong to a student and to `PII_ONLY_TABLES` if it holds identifiers, and bump `SCHEMA_VERSION` (the projection drops and rebuilds itself on a version change). Writes then work through `POST /api/facts/:table` with no further code. If a metric should derive from it, extend `deriveStudent` in `src/sql/derive.js`.

**Add a compliance check.** Write it in `checks-core.js` (everyone), `checks-micro.js` or `checks-alt.js` following the shape of the checks already there: `id`, `pack`, `severity`, `subject`, `title`, `why`, and a function over the SQLite database and a context returning a status plus a failing list capped at `MAX_FAILING`. It is picked up automatically through `PACKS` in `checks.js`, and an edition selects it with `compliance.packs`. Never return more than the cap, and never return a value the viewer's scope would not allow. Add a case to `tests/compliance.test.js`.

**Add a vibe template.** In `src/vibe/templates.js`: write a `build(prompt, title)` returning a full HTML document that uses `CSS` and `HELPERS`, then add `{ name, re, build }` to `MATCHERS` above the generic fallback. Order matters — the first regex that matches wins. Add the name to the assertion in `tests/vibe.test.js`.

**Add an edition.** `editions/<id>/edition.json` with any subset of `BASE_EDITION`'s keys (`src/core/edition.js` deep-merges `vocabulary`, `features`, `compliance`, `onboarding`, `theme`, `copy`). Optionally `editions/<id>/seed.js` and `editions/<id>/apps/`. Select it with `LIBREA_EDITION=<id>`. See `docs/editions.md`.

**Add a UI page.** A module under `public/js/<name>.js` exporting `show({ args, query })`, plus a row in `ROUTES` in `public/app.js` with `path`, `load`, `nav` and `roles`. Use `h()`, `api()`, `render()` from `public/app.js` and `t()` from `public/js/edition.js` for any word an edition might rename. No bundler, no import from a CDN.

**Add an API route.** Register it in the right `routes-*.js` (or a new one wired into `src/server.js`). Every handler receives `ctx` with `user`, `scope`, `params`, `query`, `body`; start with `requireUser`/`requireRole`, return a plain object to send JSON, or write to `ctx.res` yourself for a file.

---

## Tests

`npm test` runs `node --test tests/` — 110 tests, ~2 seconds, no network.

| File | Covers |
|---|---|
| `tests/core.test.js` | Ledger append/verify/tamper detection, entity and fragment validation, grade parsing, redaction, dims and flags and outcome labels, auth and scope narrowing. |
| `tests/sql.test.js` | `checkSql` rejections, scoped TEMP views (row and column filtering per role), the projection, rebuild. |
| `tests/import.test.js` | The largest suite: CSV parsing, preset/kind detection, mapping, every value coercion, fact rows, apply paths, the job runner. |
| `tests/vibe.test.js` | Slugs, HTML extraction, offline templates, scope normalization and defaults, broker scope enforcement, app persistence, and generate end to end over HTTP. |
| `tests/api.test.js` | The real HTTP surface against a throwaway data dir: bootstrap, login, people, fragments, search, export. |
| `tests/onboard.test.js` | Edition loading and fallback, vocabulary substitution, from-scratch entity creation and invites. |
| `tests/compliance.test.js` | Pack selection, the checks against a fixture projection, report CSVs, and the scoping of the family to-do list. |

Tests write only into `os.tmpdir()`. When you need the store in a test, stub the embedder — a real pass costs ~350 ms per fragment.

## Before you commit

1. `npm run build` — every module imports, every file under 500 lines.
2. `npm test` — all tests pass; add tests for what you changed.
3. Re-read the four invariants above against your diff. In particular: did anything new reach `buildSystemPrompt`, and does any new table appear in `scopeViews`?
4. If you changed what leaves the machine, update `whatLeaves()` in `src/vibe/providers.js`, the sovereignty section of `README.md`, and `docs/security.md` in the same commit.
5. Never commit `data/`, `.env`, or an API key. `.gitignore` covers the sovereign data files; check `git status` anyway.
6. Never run `scripts/seed.js` without `LIBREA_DATA` pointed at a disposable directory — it wipes the ledger, vectors, snapshot, SQLite file and accounts first.
