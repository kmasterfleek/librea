# Librea

**A student information system your school owns.** Free, open source, and running on a computer you control. Nobody sells the data, nobody rents it back to you, and nobody can turn it off.

Librea is for two kinds of people who are tired of the same thing from different directions.

## If you run a school or a district

You already know the deal you are in. Your student information system belongs to a vendor. Your data lives on their servers. You pay every year for the right to see it, the export button gives you a spreadsheet that isn't really your records, and the procurement process that got you here took longer than the software will last. When they get breached, and they do, the letter to families comes from you.

Librea keeps everything about your students, staff, and families on a machine in your building or a server you rent under your own name. It imports the exports you already have from PowerSchool, Aeries, Infinite Campus, or OneRoster, so nothing has to be re-typed. It records attendance, grades, discipline, services, plans, and enrollment history the way the state expects to see them, and it keeps a tamper-evident log of every change so you can prove what happened and when.

Two things it does that your current system does not:

- **It sees the whole child.** Every student is more than a grade point average. Librea keeps the structured record and also the voice: what teachers observed, what the student says about themselves, what families add. You can ask it questions in plain language, like "which fourth graders light up around building things," and get answers from what people actually wrote.
- **Your staff build their own tools.** A teacher describes the dashboard, page, or assignment they need in a sentence and gets a working web page with its own address. It reads your data, only the parts that person is allowed to see, and never sends a record anywhere.

The honest caveat: today Librea is at the stage where a district's technical team pilots it with synthetic data and decides what it needs before real records go in. The gaps are listed plainly further down. There is no sales call to sit through and no contract; you download it.

## If you are starting a microschool, a pod, or a community school

You have twenty kids, four adults, fifteen families, and a growing pile of paper you are supposed to keep in order: attendance, immunization records, emergency cards, consent forms, background checks, drill logs, learning plans, and, depending on your state, an affidavit. The software built for districts costs more than your rent and assumes an IT department. So it lives in a spreadsheet and a drawer.

**Librea Micro** is the same system with your words in it: learners, guides, pods, families. You start from scratch, typing your community in by hand, and invite families and guides with a code. It keeps the records a regulator, an insurer, or a skeptical parent will ask for, and it tells you, every day, exactly what is missing: "Paloma has no immunization record on file. Silas's background check is still pending. No lockdown drill in 90 days." Families can see their own child's file and help close the gaps. Everything stays on your computer and leaves with you if you ever stop using it.

**Librea Alt** does the same for alternative schools: charters, continuation and credit-recovery programs, independent study, therapeutic schools. Advisors instead of homeroom teachers, credits toward graduation as the number that matters, plan review dates that don't slip, and a list every week of the students who need a call.

Requirements vary by state and Librea is a tool, not legal advice. But it makes "more than legit" a checklist you can actually finish.

## What it takes

- A computer that stays on: a laptop in the office, a small server, or a rented machine. No cloud account required.
- One person who is comfortable following instructions in a terminal, or a coding assistant. Librea is built to be opened in a tool like Claude Code and adapted by conversation: the repository carries its own instructions for the assistant, and the common changes (your vocabulary, your CSV format, your colors, your server) are each a guided task.
- About an hour to see it running with sample data. Longer to make it yours.

A hosted demo with synthetic data is planned so you can click around before installing anything. Until then, the quick start below takes ten minutes with a technical friend.

## What Librea is not, yet

It is demo-grade. It has been built and tested with synthetic students, not run in a school. Before a real child's record goes in, a school needs the things listed under "Honest status" below: encrypted disks, HTTPS, single sign-on, and a read audit. None of those are exotic; they are the work of a pilot, and they are why the technical section exists.

---

# For the technical reader

Librea is a single Node process with four runtime dependencies, no build step, and no cloud account. Every change is written to a hash-chained ledger on disk; the searchable vectors, the SQLite database, and the app catalogue are projections rebuilt from that ledger. On top sits a vibe-coding layer: describe a tool in a sentence and Librea writes it as a sandboxed page that reads data through a scoped, server-enforced broker.

Editions flavor one codebase per audience: the default `district`, `LIBREA_EDITION=micro`, and `LIBREA_EDITION=alt`. Each has its own vocabulary, onboarding, compliance pack, seed, and starter apps.

## The sovereignty promise, stated precisely

This is the part to hand your IT person, your board, or your lawyer.

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

Each edition carries its own seed, starter apps and README under `editions/<id>/`. With `LIBREA_EDITION` set, `npm run seed` runs that edition's seed. See `docs/editions.md`.

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
npm test     # node --test tests/ — 112 tests
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
docs/          architecture, security, editions, API
```

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE). You may run, study, change and redistribute Librea, including for a fee, provided changes you distribute stay under the same license. A school running it for itself has no obligations beyond that. Copyright remains with the contributors.

## Credits

Seed data, the 15-dimension signal model and the risk formula come from [kmasterfleek/student-vectors](https://github.com/kmasterfleek/student-vectors). Vector storage is [ruvector](https://www.npmjs.com/package/ruvector); embeddings are `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`; the relational projection is `better-sqlite3`.
