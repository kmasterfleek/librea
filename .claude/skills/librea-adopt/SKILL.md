---
name: librea-adopt
description: First-run adoption of Librea for a specific school, district, microschool or alternative program. Use when someone has just cloned Librea and wants to make it theirs — choosing an edition, seeding or clearing demo data, creating the real admin account, and deciding what to rename. Also use when they ask "where do I start" or "how do I set this up for my school".
---

# Adopting Librea

Goal: take a fresh clone from demo state to a running installation that belongs to this school, with the adopter understanding what they now own. Interview first, edit second. Do not seed, wipe or rename anything before the answers are in.

## 1. Confirm the system runs

```bash
npm install
npm run build     # every module imports, every file under 500 lines
npm test          # 110 tests, no network
```

If `npm install` pulls nothing and `node -v` is below 20, stop and say so.

## 2. Interview

Ask these and wait for answers. Keep it to one message.

1. **What is this school?** Name, rough size, and whether it is a public district, a microschool or pod, or an alternative/independent program. This picks the edition.
2. **Is there data to bring in?** A CSV export from PowerSchool, Aeries, Infinite Campus or a OneRoster bundle — or are you starting from a blank page and typing people in?
3. **What do you call things?** District or community or network? Students or learners or scholars? Teachers or guides or advisors?
4. **Who is the first admin?** A username and a password they will actually use, not `admin`.
5. **Do you want a model provider now?** Offline templates work with no setup; Ollama and Anthropic are a later decision. Default to "not yet".

## 3. Choose the edition

- Public district → `district` (the default; nothing to do).
- Microschool, pod, co-op, forest school → `LIBREA_EDITION=micro`.
- Alternative, independent, continuation, therapeutic program → `LIBREA_EDITION=alt`.
- Anything else, or a district that wants its own words → make a new edition with the `librea-brand` skill.

Write the choice into `.env` (copy `docs/docker/env.example.txt` first). Read `docs/editions.md` before editing an edition file.

## 4. Clear the demo and start real

The demo district is synthetic, but it must not sit under a real school's data. Two paths:

**Fresh, empty installation**

```bash
rm -rf data/ledger.jsonl data/vectors.db data/snapshot.json data/users.json data/invites.json \
       data/librea.sqlite data/librea.sqlite-wal data/librea.sqlite-shm data/apps data/media
npm start
```

Then open `http://127.0.0.1:4321` and bootstrap the first admin through the sign-in page (`POST /api/auth/bootstrap` only works while no admin exists). Add people through the UI, or `POST /api/people` per `docs/api.md`.

**Keep the demo for a while, in its own folder**

```bash
LIBREA_DATA=./data-demo npm run seed
LIBREA_DATA=./data-demo npm start
```

Never run `npm run seed` against a directory holding real records — it deletes the ledger, vectors, snapshot, SQLite file and accounts before writing.

## 5. Bring people in

- With a vendor export: use the `librea-import` skill.
- From scratch: create the school (`type: 'school'`), then students, families and staff, then invite codes for each person (`POST /api/invites`, redeemed at the sign-in page). Invites are how a school with no IT department onboards families.

## 6. Tell them what they now own

Before finishing, say plainly — in their words, not the README's:

- Everything is in `data/`. Back up that folder and you have backed up the school.
- `GET /api/ledger/verify` (Home → sovereignty panel) proves the record has not been altered.
- Nothing leaves the machine in the default configuration.
- The gaps in `README.md`'s honest-status section that actually apply to them: no HTTPS if they will run it beyond one laptop, plaintext files on disk, teachers seeing every student, and no read audit.

## Files this skill touches

| File | Why |
|---|---|
| `.env` (from `docs/docker/env.example.txt`) | Edition, port, data dir. |
| `editions/<id>/edition.json` | Only if they want new words — hand off to `librea-brand`. |
| `data/` | Cleared, or seeded into a separate directory. Never edited by hand. |

Do not edit `src/` during adoption. If the interview turns up something the code cannot do, name it as a change and read `AGENTS.md` before making it.
