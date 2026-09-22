# Security

Librea is demo-grade. It is honest, auditable and local, and it is not yet hardened. This document says exactly where the line is, so nobody discovers it with a real child's record already in the ledger.

## Threat model

**What Librea defends against**

- *A vendor holding the data hostage.* Everything is in one folder in open formats. Export is a route, not a negotiation.
- *Silent alteration of the record.* Every write is an event in a hash-chained ledger with an actor. `GET /api/ledger/verify` walks the chain and names the first broken line. A record cannot be quietly changed after the fact.
- *A student's file leaking into a model provider.* The app-builder prompt is assembled from schema constants and one fabricated student. Nothing in `buildSystemPrompt` reads the store.
- *A generated app exfiltrating data.* Apps run in an opaque-origin iframe under a CSP that blocks all network access; `window.librea` speaks postMessage to a same-origin shell, and the server narrows the scope on every call.
- *An app or a model widening its own permissions.* `narrowScope` only intersects. SQL runs against TEMP views that shadow the real tables, so scope is enforced by the database, not by the query.
- *A family or student reading another child's file.* `scopeFor` limits them to their linked records at every layer.

**What Librea does not defend against**

- Anyone with read access to the machine or the backup. The files are plaintext.
- Anyone on the network path, if the server is exposed without a TLS-terminating proxy.
- A compromised or malicious staff account. `staff` sees every student in the installation.
- Password guessing. There is no rate limiting anywhere.
- An insider reading records they should not. Reads are not logged.

## The gap list, with a next step for each

### Data on disk is plaintext

`ledger.jsonl`, `librea.sqlite`, `snapshot.json`, `users.json`, media and exports are readable by anyone who can read the folder. Password *hashes* are scrypt with a per-user salt; everything else is in the clear.

*Next step:* full-disk encryption on the server, the data directory mode `0700` owned by the service user, and encrypted off-site backups (`age` or `gpg`) with the key stored separately. Longer term, encrypting the ledger at rest is possible but changes the "readable without Librea" property, which is itself a sovereignty guarantee — decide deliberately.

### No HTTPS

`src/api/router.js` speaks plain HTTP and `src/server.js` binds `127.0.0.1:4321` by default. The session cookie is `HttpOnly; SameSite=Strict` but not `Secure`, because there is no TLS to require.

*Next step:* Caddy or nginx terminating TLS in front, with Librea kept on the loopback interface. Once TLS is in place, add `Secure` to the cookie in `src/api/routes-core.js`. Do not set `HOST=0.0.0.0` without a proxy.

### No SSO

Local accounts only (`src/core/auth.js`): scrypt hashes in `data/users.json`, created by an admin or by redeeming an invite code. No Google/Microsoft/Clever login, no MFA, no self-service password reset — an admin resets via `PUT /api/users/:username`, which also kills that user's sessions.

*Next step:* if the school already has Google Workspace or Entra, an OIDC login path mapping to the existing role model is the highest-value addition; it also removes the local password store from the threat model.

### No rate limiting

Nothing throttles `/api/auth/login`, the broker, or the SQL endpoint. An attacker on the local network can guess passwords as fast as scrypt allows.

*Next step:* per-IP and per-username backoff on the login route, and a per-session cap on `/api/query` and `/api/sql/query`. A reverse proxy can do the first today.

### Sessions in memory

`Auth.sessions` is a `Map` with a 12-hour TTL. A restart signs everyone out (occasionally useful, mostly annoying), and the process cannot be run as more than one instance.

*Next step:* persist sessions into the data directory with the same TTL, or accept the constraint and document the single-process requirement. Do not move sessions to an external store — that adds a dependency the sovereignty promise does not want.

### Roles are coarse

`staff` means every student in the installation. There is no notion of "my roster" or "my school" in the scope model, even though `enrollments` and `schoolSourcedId` are both in the projection. Families and students *are* properly limited.

*Next step:* add a school and/or section restriction to `scopeFor` for `staff`, populated from `enrollments`, and push it into `scopeViews` in `src/sql/query.js` as an additional WHERE clause. All three enforcement layers must be changed together, and `tests/sql.test.js` is where to prove it.

### No per-record read audit

Writes are fully audited: every event carries `actor` and `ts`. Reads are not. "Who looked at this child's file?" is a question Librea cannot answer today. Broker *errors* are logged as `app.error` events; successful reads are not.

*Next step:* a `record.read` event on `GET /api/people/:id`, the person view, and broker `person`/`fragments` ops, carrying actor, entity id and route — but not the values read. Volume is the design problem: a daily roll-up per actor-and-subject is probably right, and it must not turn the ledger into a log file.

## FERPA-relevant notes

This is not legal advice, and Librea has not been audited against FERPA. What the code does that is relevant:

- **Education records stay under the school's control.** Nothing is transmitted to a third party in the default configuration. If a hosted model provider is configured, only the prompt and the schema go out — no education record, no personally identifiable information. A school can verify this at runtime with `GET /api/vibe/provider`.
- **Directory-information style redaction exists.** `PII_FIELDS` in `src/core/schema.js` and `PII_COLS`/`PII_ONLY_TABLES` in `src/sql/schema.js` define what is stripped for scopes without names, and it is applied at every layer including SQL.
- **Parent access to their child's record** is a first-class role. A `family` account linked to a student can read the shared record, the family-visible fragments, and add to it. Staff-only notes are not visible to them, which is a design decision the school should confirm matches its policy.
- **A right to inspect implies a right to a copy.** `/api/export/bundle.json`, `/api/export/students.csv`, `/api/export/fragments.csv` and `/api/export/ledger.jsonl` produce it. All four are admin-only; per-family export is not implemented.
- **The disclosure log FERPA contemplates is the read audit Librea does not have yet.** See above. A school with a record-of-disclosure obligation should treat this as a prerequisite, not a nice-to-have.
- **Retention and deletion.** `deleteEntity` and `removeFragment` append delete events; the *prior* events remain in the ledger, because an append-only chain is what makes tampering detectable. Physical erasure of a record therefore means rewriting the ledger and accepting a new chain — a deliberate operation, not an API call. Decide the school's position on this before collecting data.

## Backup and export

- **Back up `$LIBREA_DATA`.** That folder is the whole system, including `vectors.db`, which is the one projection not automatically rebuilt.
- **Stop the process first**, or copy the SQLite WAL files with the database. A half-written trailing ledger line fails `verify()`.
- **Record the ledger head hash** (`GET /api/ledger/verify`) with each archive. A restored copy whose head matches is byte-identical history.
- **Encrypt off-site copies.** They contain student records in plaintext.
- **Restore is copying the folder back.** If only the projections are damaged, delete `librea.sqlite*` and `snapshot.json` and restart — the store replays the ledger. `POST /api/sql/rebuild` does the SQLite half without a restart.
- **If `verify()` reports `brokenAt`, do not patch the file.** Restore the last archive whose head you trust and find out who edited it.

Full procedures are in the `librea-deploy` skill.

## Reporting a problem

There is no security contact and no disclosure process yet, because there is not yet a project to disclose to. If you are adopting Librea and find something, tell the person who gave you the repository, and fix it in your fork.
