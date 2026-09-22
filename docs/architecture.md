# Architecture

One Node 20 process. No build step, no framework, four runtime dependencies (`ruvector`, `better-sqlite3`, `@huggingface/transformers`, `@anthropic-ai/sdk`). Everything the system knows is in one folder.

## The data flow

```
CSV / UI / API
      │
      │  validate at the boundary  (schema.js, values.js, query.js)
      ▼
   Store  ──────────►  ledger.jsonl        the source of truth
      │                 append-only, SHA-256 hash-chained
      │
      ├──────────────►  in-memory maps     entities, fragments, apps
      ├──────────────►  vectors.db         384-d fragment + entity vectors (ruvector)
      └──────────────►  librea.sqlite      relational projection (SqlProjection)
                             │
                             ▼
                        scoped TEMP views  (sql/query.js)
                             │
      ┌──────────────────────┴──────────────────────┐
      ▼                                             ▼
   REST API (src/api)                        broker (src/vibe/query.js)
      │                                             │
      ▼                                             ▼
   public/  the UI                       sandboxed vibe apps (opaque origin)
```

Nothing reaches a projection except through a ledger event. Every projection is disposable: delete `librea.sqlite` and `snapshot.json`, restart, and they are rebuilt from `ledger.jsonl`.

### Write path

1. A request arrives at `src/api/router.js`; `attachUser` in `src/api/context.js` resolves the session into `ctx.user` and `ctx.scope` before any handler runs.
2. The handler calls a `Store` method — `upsertEntity`, `addFragment(s)`, `addSnapshot`, `upsertFacts`, `upsertApp`.
3. `Store` validates (`validateEntity` / `validateFragment` / the row check in `upsertFacts`), computes derived fields for students (dims, signal vector, coverage, flags, risk, outcome, arc), and appends one event to the `Ledger`.
4. `_apply` hands the event to every attached projection (`SqlProjection`), then updates the in-memory maps.
5. For fragments, the text is embedded first and written to `vectors.db`, and the person's mean entity vector is recomputed.

### Read path

- Structured reads go through the SQLite projection, always via `runScoped` — which drops and recreates TEMP views shadowing every table, filtered to the rows and columns the caller's scope allows, runs one read-only SELECT with a 2000-row cap, and drops the views again.
- Semantic reads go through `store.semanticSearch`, which embeds the query, over-fetches from ruvector, then filters by visibility, entity type, school and allowed entity ids server-side before grouping by person.
- Every entity returned by an API route passes through `projectEntity`, which strips `PII_FIELDS` when the scope does not allow names.

### Boot

`SqlProjection.open()` → `Store.open()` loads `snapshot.json` if present, replays the ledger from the snapshot's `seq` forward into memory, and feeds every projection the events it has not yet seen (each projection tracks its own `seq` in a `meta` table). A snapshot is written every 60 seconds and on close. A `SCHEMA_VERSION` bump in `src/sql/schema.js` causes the SQLite file to be deleted and rebuilt on the next open.

## The two vectors

Every student carries two independent vectors, and they answer different questions.

**The signal vector** — 15 dimensions, defined in `src/core/schema.js` and computed in `src/core/signal.js`. Raw metrics (`gpa`, `attendancePct`, `disciplineIncidents`, `ellLevel`, …) are normalized to 0..1 where **1 is always the favourable end**, so the vector is directly comparable across students and reads intuitively on a radar chart. Missing dimensions are `null` and fill with 0.5 (neutral) when the vector is built; `coverage` reports how much of the record is actually present. Similarity in this space (`space: 'signal'`) answers *"who else is in a situation like this one?"*

**The semantic vector** — 384 dimensions from `all-MiniLM-L6-v2`, one per fragment, with each person's entity vector being the L2-normalized mean of their fragments. This is the vector over what people *wrote*: the student's own words, the family's note, the teacher's observation, the sentence the importer generated from the record. Similarity here (`space: 'semantic'`) answers *"who else sounds like this?"* and search over it is meaning-based, not keyword.

Alongside both, `timeline` holds up to 36 point-in-time dimension snapshots per student, from which `detectArc` reads a `turnaround`, `climb`, `slide` or `flat` shape on the academic composite, and `arcs().movers` names the three dimensions that moved most.

The flags in `signal.js` (`chronicAbsent`, `highDiscipline`, `decliningGrades`, `resilient`, `hiddenRisk`) and the `riskScore` formula are heuristics carried over from the student-vectors generator. They are surfaced as questions for a human, never as verdicts. They are also the most arguable thing in the codebase and the right first thing for a school to change.

## Relational facts and derivation

`src/sql/schema.js` defines 14 fact tables: OneRoster 1.1 (`academic_sessions`, `courses`, `classes`, `enrollments`, `line_items`, `results`) plus what a school actually needs (`attendance`, `discipline_incidents`, `services`, `contacts`) plus the compliance tables (`immunizations`, `documents`, `staff_credentials`, `learning_plans`, `drills`, `enrollment_events`). Column names follow OneRoster camelCase so importers and models can match the standard's documentation.

Fact rows live only in the ledger and the SQLite projection — not in the in-memory entity map. `src/sql/derive.js` reads them back and recomputes a student's raw metrics: attendance percentage from the daily rows, GPA and assignment completion from scored line items, incident counts, ELL/special-ed/FRL levels from active service rows, extracurricular count from enrollments in `classType: 'extracurricular'` classes. The signal vector becomes a live function of the evidence rather than a vendor's summary column. `deriveStudent` deliberately returns only metrics it has evidence for, so an absent row never overwrites a value another import set.

## The vibe layer

Someone describes an app. `buildSystemPrompt` (`src/vibe/prompt.js`) assembles the runtime API contract, the SQL schema for *this viewer's scope*, the object schema with one fabricated student, the scope block and twelve hard rules — all from schema constants, never from the store. The chosen provider streams back one HTML document over SSE.

The document is saved as `data/apps/<slug>/vN.html`; the manifest (title, prompt, provider, scope, author, version history, warnings) goes into the ledger via `store.upsertApp`, so every scope change on every app is auditable.

Serving it is three nested boundaries:

1. `GET /a/:slug` serves the **shell** — a same-origin page that frames the app and is the only thing the app can talk to.
2. The shell embeds `GET /a/:slug/app.html` in a sandboxed iframe with an opaque origin, under a CSP of `default-src 'none'; connect-src 'none'`. No fetch, no WebSocket, no external script, style, font or image.
3. `runtime.js` is injected as the app's first script, before anything the model wrote can run. It exposes `window.librea` and speaks `postMessage` to the shell, which calls `POST /api/query` with the app's slug in an `x-librea-app` header.

`attachUser` then narrows the viewer's scope by the app's declared scope — apps can only ever narrow, never widen (`narrowScope` in `src/core/auth.js`). The broker (`src/vibe/query.js`) validates every op and argument, and for aggregates-only apps drops any group smaller than `K_ANON = 5` and reports the suppressed count rather than hiding it.

`auditHtml` reports what a generated document got wrong (external script, direct network call, missing `librea.ready()`, missing footer) as warnings on the app. It never rewrites the document — the page is served exactly as generated, and the sandbox is what actually stops it.

Broker errors land in the ledger as `app.error` events carrying the slug, op, role, status, argument *names* and a scrubbed message: anything in quotes is replaced before it is written, because an error can echo a literal from a WHERE clause and a teacher can type a child's name into a prompt.

## Scope, in one place

`scopeFor(user)` in `src/core/auth.js` is the single map from role to data ceiling:

| Role | Fragment visibility | Records | Names | Aggregates |
|---|---|---|---|---|
| `admin` | `school`, `staff` | all | yes | yes |
| `staff` | `school`, `staff` | all | yes | yes |
| `family` | `family`, `school` | linked students only | no | yes |
| `student` | `private`, `family`, `school` | own record only | no | yes |
| anon | none | none | no | no |

Enforced in three layers that must agree: `projectEntity` and `canSeeEntity` for the REST surface, the visibility filter inside `store.getFragments`/`semanticSearch`, and the TEMP views in `sql/query.js` for anything SQL-reachable. A new table reachable from SQL must be registered in `STUDENT_SCOPED` or `PII_ONLY_TABLES` or it is not scoped at all.

## Editions

`src/core/edition.js` loads `editions/<id>/edition.json` over `BASE_EDITION`, deep-merging `vocabulary`, `features`, `compliance`, `onboarding`, `theme` and `copy`. `t()` substitutes vocabulary words in any sentence with case preserved. Selected by `LIBREA_EDITION`; `district` is the built-in default. See `docs/editions.md`.

## Compliance

`src/compliance/` answers the ordinary questions on the ordinary day: who is enrolled, whose paperwork is current, whose immunizations or exemptions are on file, which adults' background checks and training have not expired, which learning plans are overdue for review, when the last drill was.

- `util.js` — date helpers, weekday tests, July-1 school-year boundaries, current-document resolution, and `MAX_FAILING`, which caps a failing list so a report names records without dumping the roster.
- `checks-core.js`, `checks-micro.js`, `checks-alt.js` — the checks themselves, each a pure function over the SQLite projection returning a status and a capped failing list.
- `checks.js` — the `PACKS` registry (`core`, `micro`, `alt`), `checksFor(packs)`, `runCheck`, `runAll`, `summarize`.
- `reports.js` — CSV reports with declared parameters.
- `routes.js` — the HTTP surface, including `GET /api/compliance/mine`, a family's own to-do list scoped to their linked children.

Which packs run is the edition's decision (`compliance.packs`), so Micro asks a pod's questions and Alt asks a credit-recovery program's. Every read is against the projection, so a compliance answer is a query over the same rows an importer wrote — not a separate store that can drift.

## Exit

`src/api/routes-export.js` is the third sovereignty check — what survives leaving. Admin can pull the full bundle (`/api/export/bundle.json`), students as CSV with metrics and dims, fragments as CSV with author and visibility, and the raw ledger verbatim. Everything comes out as plain files readable without Librea.
