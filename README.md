# Librea

Librea is a student information system that runs on a computer your school owns. Every change is written to a hash-chained ledger on disk, and everything else — the searchable vectors, the SQLite database, the app catalogue — is a projection rebuilt from that ledger. On top of it sits a vibe-coding layer: describe the tool you need in a sentence and Librea writes it as a sandboxed page that reads your data through a scoped, server-enforced broker.

It is a single Node process, four runtime dependencies, no build step, no cloud account, and no vendor who can raise your price or hold your export hostage.

## Who it is for

- **School districts.** The default `district` edition speaks the usual vocabulary and imports from PowerSchool, Aeries, Infinite Campus, or OneRoster CSV.
- **Microschools, pods and co-ops — Librea Micro.** `LIBREA_EDITION=micro` renames districts to communities, students to learners, staff to guides, and swaps import-first onboarding for typing your community in by hand.
- **Alternative and independent schools — Librea Alt.** `LIBREA_EDITION=alt` keeps the state's vocabulary (with teacher→advisor, principal→director) and changes what the school watches: credits, plans and their review dates, and students who enrolled mid-year.

## The sovereignty promise, stated precisely

**What lives on disk.** Everything, under `data/` (or `$LIBREA_DATA`):

| File | What it is |
|---|---|
| `data/ledger.jsonl` | The source of truth. One JSON event per line, SHA-256 hash-chained to the line before it. |
| `data/vectors.db` | ruvector store: one 384-dimension vector per fragment, plus a mean vector per person. |
| `data/librea.sqlite` | The relational projection. Deletable; `POST /api/sql/rebuild` rebuilds it. |
| `data/snapshot.json` | A boot cache of the in-memory projection. Deletable. |
| `data/users.json`, `data/invites.json` | Accounts (scrypt hashes) and invite codes. |
| `data/media/<id>/` | Photos, as files. |
| `data/apps/<slug>/vN.html` | Every version of every app anyone built, as plain HTML. |
| `data/models/` | The embedding model's weights, downloaded once. |

**What the ledger is.** An append-only log where every entity upsert, fragment, snapshot, fact row, app change and broker error is an event carrying `seq`, `ts`, `actor`, `data`, `prev` and `hash`. `GET /api/ledger/verify` walks the whole chain and reports the first broken line. Restoring a backup means copying the folder back; rebuilding means replaying the ledger.

**What leaves the building.** Only what the app-builder sends to whichever model provider you configure, and only ever the *shape* of your data:

- `template` (default) — nothing. No model, no network; Librea assembles apps from built-in templates.
- `ollama` with a local tag — nothing leaves the machine; the model runs at `LIBREA_OLLAMA_HOST`.
- `ollama` with a `:cloud` / `-cloud` tag — your prompt and the schema go to Ollama's servers through the local daemon. Librea says so in the UI instead of pretending otherwise.
- `anthropic` — your prompt and the schema go to Anthropic's API.

**Student records never go to a model provider.** The system prompt is assembled in `src/vibe/prompt.js` from schema constants plus one fabricated student (`Avery Example`, `STU-EXAMPLE-0001`). No real name, id, metric, or anything a child, family or teacher wrote is ever in it. Real data reaches the generated app only at runtime, through the broker, after the page is already written. Ask the running server yourself: `GET /api/vibe/provider` returns the provider and a plain-language `whatLeaves` statement.

**The one model that does touch student records** is the local embedder — `all-MiniLM-L6-v2`, 384 dimensions, running in-process. Its weights are downloaded once (that download is the only network call in a default install) into `data/models/`, after which it runs with the network unplugged.

## Quick start

```bash
git clone <your fork of this repo> librea
cd librea
npm install
npm run seed      # 850 synthetic students, 4 schools, ~2000 fragments, 30 days of attendance
npm start         # http://127.0.0.1:4321
```

Demo logins created by the seed:

| Username | Password | Role |
|---|---|---|
| `admin` | `librea-admin` | admin |
| `teacher.0` | `librea-staff` | staff |
| `stu-0001` | `librea-student` | student |
| `family.stu-0001` | `librea-family` | family |

The seed data is synthetic, generated from [kmasterfleek/student-vectors](https://github.com/kmasterfleek/student-vectors). No real child is in this repository.

Other editions:

```bash
LIBREA_EDITION=micro node editions/micro/seed.js && LIBREA_EDITION=micro npm start
LIBREA_EDITION=alt   node editions/alt/seed.js   && LIBREA_EDITION=alt   npm start
```

Each edition carries its own seed, app templates and README under `editions/<id>/`. `npm run seed` always seeds the district demo. See `docs/editions.md`.

> `npm run seed` wipes the ledger, vectors, snapshot, SQLite file and accounts in `$LIBREA_DATA` before writing (pass `--keep` to append). Point `LIBREA_DATA` somewhere disposable if you are only experimenting.

## Make it yours with your coding agent

Librea is meant to be forked and rewritten, not configured. Open the folder in Claude Code (or any coding agent) and point it at [`AGENTS.md`](AGENTS.md) — a map of every module, the invariants that must not break and the file that enforces each one, and recipes for the common changes.

Five skills under `.claude/skills/` make this concrete:

| Skill | What it does |
|---|---|
| `librea-adopt` | First-run interview: who you are, which edition, what to rename, what to seed. |
| `librea-import` | Map your own SIS export onto a preset and check the mapping before applying. |
| `librea-brand` | Your name, colours and vocabulary, as an edition. |
| `librea-model` | Connect Ollama or Anthropic, and update the sovereignty statement honestly. |
| `librea-deploy` | Run it on a school server: Docker, env, backups, restore. |

The four adaptations almost everyone makes:

1. **Your vocabulary and branding** — an edition under `editions/<id>/edition.json` (`docs/editions.md`).
2. **Your SIS export** — a preset in `src/import/presets.js`, or a corrected mapping in the import UI.
3. **Your definition of "doing well"** — the 15 dimensions in `src/core/schema.js`, the normalization in `src/core/signal.js`, the flags and risk formula in the same file. These are the most opinionated thing in the codebase and the thing you should argue with first.
4. **Your own screens** — either a page under `public/js/` wired into `ROUTES` in `public/app.js`, or a vibe app you describe in a sentence and never write by hand.

## Running it on a school server

```bash
cp docs/docker/env.example.txt .env    # edit it
docker compose up -d
```

One service, `./data` mounted as a volume, `.env` for configuration. Data is never baked into the image: `docs/docker/entrypoint.sh` seeds the synthetic district only when the data directory has no ledger, and `LIBREA_SEED_ON_EMPTY=0` starts empty. Put a TLS-terminating reverse proxy in front before anyone outside the machine reaches it. Backups, restore and the rest are in the `librea-deploy` skill.

## Model providers

Set with environment variables; nothing else changes.

```bash
LIBREA_MODEL_PROVIDER=template              # default when no API key is set — offline, deterministic
LIBREA_MODEL_PROVIDER=ollama
LIBREA_OLLAMA_HOST=http://localhost:11434   # default
LIBREA_OLLAMA_MODEL=qwen2.5-coder:7b        # default; a :cloud tag runs on Ollama's servers
LIBREA_MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...                # selects anthropic automatically if no provider is set
LIBREA_MODEL=claude-opus-5                  # default Anthropic model
```

Librea does not hide the cloud tag case. A model whose tag ends in `:cloud` or `-cloud` is reported as `offline: false` with an explicit statement that your prompt reaches Ollama's servers, and that swapping the tag for a local model makes it stop. See `src/vibe/providers.js`.

## Honest status: demo-grade, not yet pilot-grade

Everything below is true of the code as it stands. None of it is hidden in a footnote because a school deserves to know before it puts a child's record in.

- **Data on disk is plaintext.** The ledger, the SQLite file and the exports are readable by anyone with the file or the backup. Use full-disk encryption and file permissions.
- **No HTTPS.** The server speaks plain HTTP and binds `127.0.0.1` by default. Anything beyond one laptop needs a reverse proxy terminating TLS.
- **No SSO**, no password reset flow, no MFA. Local accounts with scrypt hashes, created by an admin or an invite code.
- **No rate limiting** anywhere, including login. A local network is assumed to be trusted, which is a real assumption and not always a safe one.
- **Sessions live in memory** with a 12-hour TTL, so a restart signs everyone out, and the session cookie is `HttpOnly; SameSite=Strict` but not `Secure` (there is no TLS to be secure about yet).
- **Roles are coarse.** `staff` sees every student in the installation, not only their own roster. Families and students are limited to their linked records; teachers are not limited at all.
- **No per-record read audit.** Writes are all in the ledger with an actor. Reads are not logged, so "who looked at this child's file" is a question Librea cannot currently answer.

`docs/security.md` lists each gap with a concrete next step.

## Tests and layout

```bash
npm test     # node --test tests/ — 110 tests
npm run build  # imports every module, fails any file over 500 lines
```

```
src/core/      ledger, store, schema, signal vector, embeddings, auth, editions
src/api/       router, request context/scope, core + export + curriculum + sql + onboard routes
src/sql/       SQLite projection, scoped read-only query layer, metric derivation
src/import/    CSV parsing, vendor presets, mapping, fact writing, background jobs
src/vibe/      providers, prompt, generated-app storage, sandbox shell + runtime, the broker
src/compliance/ checks by pack (core/micro/alt), CSV reports, the family to-do list
public/        the UI: vanilla ES modules, no bundler, no CDN
editions/      micro, alt
data/seed/     synthetic district, curriculum by grade, sample vendor CSVs
docs/          architecture, security, editions, API, adopter CLAUDE.md
```

## License

**Undecided.** No license file ships with this repository yet, which means default copyright applies and you do not yet have permission to redistribute. If you are waiting on this before adopting Librea, say so — it moves the decision up the list.

## Credits

Seed data, the 15-dimension signal model and the risk formula come from [kmasterfleek/student-vectors](https://github.com/kmasterfleek/student-vectors). Vector storage is [ruvector](https://www.npmjs.com/package/ruvector); embeddings are `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`; the relational projection is `better-sqlite3`.
