// Append-only, hash-chained event ledger. Every state change in Librea is an
// event here first; the in-memory store is a projection of it. Tampering with
// any line breaks the chain, which `verify()` reports.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const GENESIS = 'librea-genesis';

function hashOf(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

export class Ledger {
  constructor(file) {
    this.file = file;
    this.seq = 0;
    this.prev = GENESIS;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  }

  /** Read every event in order. Sets seq/prev to the tail. */
  *replay() {
    const raw = fs.readFileSync(this.file, 'utf8');
    if (!raw) return;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      this.seq = ev.seq;
      this.prev = ev.hash;
      yield ev;
    }
  }

  /** Append one event. Returns the stored event (with seq, ts, prev, hash). */
  append(type, data, actor = 'system') {
    const ev = { seq: this.seq + 1, id: randomUUID(), ts: new Date().toISOString(), type, actor, data, prev: this.prev };
    ev.hash = hashOf({ seq: ev.seq, id: ev.id, ts: ev.ts, type, actor, data, prev: ev.prev });
    fs.appendFileSync(this.file, JSON.stringify(ev) + '\n');
    this.seq = ev.seq;
    this.prev = ev.hash;
    return ev;
  }

  /** Verify the whole chain. Returns { ok, events, brokenAt }. */
  verify() {
    let prev = GENESIS;
    let n = 0;
    const raw = fs.readFileSync(this.file, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      const expect = hashOf({ seq: ev.seq, id: ev.id, ts: ev.ts, type: ev.type, actor: ev.actor, data: ev.data, prev: ev.prev });
      if (ev.prev !== prev || ev.hash !== expect || ev.seq !== n + 1) return { ok: false, events: n, brokenAt: ev.seq };
      prev = ev.hash;
      n = ev.seq;
    }
    return { ok: true, events: n, head: prev };
  }
}
