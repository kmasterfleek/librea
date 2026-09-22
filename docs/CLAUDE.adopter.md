# Proposed replacement for CLAUDE.md

The `CLAUDE.md` currently in the repository root is ruflo boilerplate: swarm topologies, MCP tool tables and CLI commands that describe the tooling this project was built with, not the project itself. An adopter who clones Librea and opens it in a coding agent gets three hundred lines about agent coordination and nothing about the ledger.

This file is the proposed replacement. It is not installed — copy it over `CLAUDE.md` when the ruflo integration is no longer needed in this repository.

---

```markdown
# Librea — instructions for coding agents

Librea is a sovereign, vector-native student information system with a vibe-coding
layer. It runs on a school's own machine. The data it holds is about children, and
the people using it have no vendor to call.

Read `AGENTS.md` before changing anything. `docs/architecture.md` has the longer
version.

## Rules

- Do what has been asked; nothing more, nothing less.
- ALWAYS read a file before editing it.
- NEVER create files unless necessary — prefer editing an existing one.
- NEVER create documentation files unless asked.
- NEVER save working files or tests to the repository root.
- Keep every file under 500 lines. `npm run build` fails otherwise.
- Validate input at system boundaries.
- NEVER commit `data/`, `.env`, secrets or an API key.
- NEVER run `scripts/seed.js` without `LIBREA_DATA` pointed at a disposable
  directory — it wipes the ledger, vectors, snapshot, SQLite file and accounts.
- NEVER commit a real school's CSV export, not even a few rows. Samples are
  synthetic.

## Invariants

Each of these is enforced by a specific file. Breaking one is not a style
question.

1. **The ledger is the source of truth and every write goes through `Store`.**
   `src/core/ledger.js`, `src/core/store.js`. Never write to
   `data/librea.sqlite` directly, never mutate `store.entities` from outside,
   never hand-edit `ledger.jsonl`.
2. **Scope is enforced on the server, never in the browser and never by the
   model.** `src/api/context.js`, `src/core/store.js`, `src/sql/query.js`. A new
   SQL-reachable table must be registered in `STUDENT_SCOPED` or
   `PII_ONLY_TABLES` in `src/sql/schema.js`, or it leaks.
3. **Apps run sandboxed and reach data only through the broker.**
   `src/vibe/routes.js` (opaque-origin iframe, CSP), `src/vibe/runtime.js`
   (postMessage only), `src/vibe/query.js` (every op validated, K_ANON = 5).
4. **Model providers receive a prompt and a schema, never a record.**
   `src/vibe/prompt.js` builds the prompt from schema constants and one
   fabricated student. If a value came from the store, it does not go in.
   `whatLeaves()` in `src/vibe/providers.js` must stay true.
5. **Flags are questions for a human, never verdicts about a child.**
   `src/core/signal.js`, `public/app.js`.

## Layout

    src/core/    ledger, store, schema, signal vector, embeddings, auth, editions
    src/api/     router, context/scope, core + export + curriculum + sql + onboard routes
    src/sql/     SQLite projection, scoped read-only queries, metric derivation
    src/import/  CSV parsing, vendor presets, mapping, fact writing, jobs
    src/vibe/    providers, prompt, app storage, sandbox shell + runtime, broker
    public/      the UI: vanilla ES modules, no bundler, no CDN
    editions/    micro, alt
    tests/       node --test, no network

## Build and test

    npm run build   # every module imports, every file under 500 lines
    npm test        # node --test tests/

Run both before committing. Add tests for what you changed; `tests/` is where an
invariant is proved, not just described.

## Skills

`.claude/skills/librea-*` cover the common adoption tasks: `librea-adopt`
(first run), `librea-import` (a district's own CSV), `librea-brand` (vocabulary
and theme via an edition), `librea-model` (connecting a provider and keeping the
sovereignty statement true), `librea-deploy` (server, backups, restore).
```
