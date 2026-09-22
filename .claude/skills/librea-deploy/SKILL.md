---
name: librea-deploy
description: Run Librea on a school's own server — Docker or bare Node, environment configuration, TLS via a reverse proxy, backups of data/, and restore. Use when someone asks how to host Librea for a whole school, how to back it up, what to do if the SQLite file is corrupt, or how to move an installation to another machine.
---

# Deploying Librea on a school server

Librea is one Node 20 process, one folder of data, and no external services. Deployment is mostly about who can reach the port and who can read the folder.

Before deploying beyond one laptop, read the honest-status list in `README.md` with the school: no HTTPS of its own, no SSO, no rate limiting, in-memory sessions, plaintext data on disk, teachers seeing every student, and no per-record read audit. Deployment does not fix any of those; a reverse proxy fixes exactly one.

## Docker

```bash
cp docs/docker/env.example.txt .env         # edit it
docker compose up -d
docker compose logs -f
```

`docker-compose.yml` runs one service, mounts `./data` as a volume and reads `.env`. The image does **not** bake data in: `docs/docker/entrypoint.sh` seeds only when `$LIBREA_DATA` has no `ledger.jsonl`, then starts the server. A school's real installation therefore starts empty and stays that way through every rebuild.

To start empty rather than with the demo district, set `LIBREA_SEED_ON_EMPTY=0` in `.env` and bootstrap the first admin through the sign-in page.

Build the image alone:

```bash
docker build -t librea .
docker run -p 4321:4321 -v "$PWD/data:/data" --env-file .env librea
```

## Bare Node

```bash
npm ci --omit=dev
LIBREA_DATA=/var/lib/librea HOST=127.0.0.1 PORT=4321 node src/server.js
```

Run it under systemd with `Restart=always`, as a user that owns only `/var/lib/librea`, with that directory mode `0700`. `better-sqlite3` and `onnxruntime-node` are native; they must be installed on the machine that runs them, not copied from another architecture.

## TLS and exposure

The server speaks plain HTTP and binds `127.0.0.1` by default. **Keep it that way** and put Caddy or nginx in front:

```
librea.school.example {
    reverse_proxy 127.0.0.1:4321
}
```

Setting `HOST=0.0.0.0` without a proxy puts sessions, passwords and student records on the network in clear text. If someone needs that for a quick demo, say what it costs.

## Backups

The whole system is `$LIBREA_DATA`. Back up the folder; nothing else in the repository holds school data.

```bash
systemctl stop librea          # or: docker compose stop
tar czf librea-$(date +%F).tar.gz -C /var/lib librea
systemctl start librea
```

Stop the process first, or at minimum copy the SQLite WAL files (`librea.sqlite-wal`, `librea.sqlite-shm`) along with the database. The ledger is append-only, so a copy taken mid-write loses at most the trailing line — but a half-written line will fail `verify()`, so prefer a clean stop.

Verify the backup is the record it claims to be:

```bash
curl -s -b cookies.txt http://127.0.0.1:4321/api/ledger/verify   # { ok: true, events: N, head: "..." }
```

Store the `head` hash alongside the archive. A restored copy whose head matches is byte-identical history.

Off-site copies contain student records in plaintext. Encrypt them (`age`, `gpg`, or an encrypted destination) and keep the key somewhere other than the backup.

## Restore

Restore is copying the folder back:

```bash
systemctl stop librea
rm -rf /var/lib/librea
tar xzf librea-2026-09-01.tar.gz -C /var/lib
systemctl start librea
```

If only the projections are damaged — a corrupt SQLite file, a stale snapshot — the ledger alone is enough:

```bash
rm -f $LIBREA_DATA/librea.sqlite $LIBREA_DATA/librea.sqlite-wal $LIBREA_DATA/librea.sqlite-shm
rm -f $LIBREA_DATA/snapshot.json
# restart; the store replays ledger.jsonl and the projection rebuilds
```

`POST /api/sql/rebuild` (admin) does the same for SQLite without a restart. `data/vectors.db` is the one projection that is *not* rebuilt automatically — it is written as fragments are added — so keep it in the backup.

If `verify()` reports `brokenAt`, the ledger has been edited. Do not patch it: restore the last backup whose head hash you trust, and find out who edited the file.

## Moving to another machine

Copy `$LIBREA_DATA` and `.env`, install dependencies on the new machine (native modules must be rebuilt, not copied), start, and verify the ledger head matches. There is no license server, no activation and no phone-home; an installation moves because it is a folder.

## Files this skill touches

| File | Why |
|---|---|
| `.env` | Port, host, data dir, edition, provider. Never committed. |
| `docker-compose.yml`, `Dockerfile`, `docs/docker/entrypoint.sh` | The container. |
| Reverse proxy config | Outside this repository. |

Never bake `data/` into an image, never commit a backup, and never run `npm run seed` against a directory holding real records.
