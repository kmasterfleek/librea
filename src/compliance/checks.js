// The check registry. A check is a question with a defensible answer: what it
// looks at, why it matters in one sentence, and the exact table that fixes it.
// Packs are chosen by the edition (edition.compliance.packs).
import { today } from './util.js';
import { CORE_CHECKS } from './checks-core.js';
import { MICRO_CHECKS } from './checks-micro.js';
import { ALT_CHECKS } from './checks-alt.js';

export const PACKS = { core: CORE_CHECKS, micro: MICRO_CHECKS, alt: ALT_CHECKS };
export const PACK_NAMES = Object.keys(PACKS);

export const ALL_CHECKS = Object.values(PACKS).flat();

/** Checks for a set of packs, in pack order, unknown packs ignored. */
export function checksFor(packs = ['core']) {
  const want = [...new Set(packs.map((p) => String(p).toLowerCase()))].filter((p) => PACKS[p]);
  return (want.length ? want : ['core']).flatMap((p) => PACKS[p]);
}

export const getCheck = (id) => ALL_CHECKS.find((c) => c.id === id) || null;

/** Everything about a check except its result — safe to show anyone school-side. */
export const describe = (c) => ({ id: c.id, pack: c.pack, severity: c.severity, subject: c.subject, title: c.title, why: c.why });

/** Context passed to every run(): the clock and the edition's knobs. */
export function checkContext(edition, extra = {}) {
  const compliance = edition?.compliance || {};
  return { today: extra.today || today(), edition, vocabulary: edition?.vocabulary || {}, config: { ratio: 12, creditTarget: 22, ...compliance }, ...extra };
}

/** Run one check, turning a thrown error into an honest 'warn' rather than a 500. */
export function runCheck(check, db, ctx) {
  try {
    const r = check.run(db, ctx);
    return { ...describe(check), ...r, failing: r.failing || [] };
  } catch (err) {
    return { ...describe(check), status: 'warn', total: 0, failingCount: 1, truncated: false, failing: [{ id: check.id, label: 'check could not run', detail: err.message }], fix: { action: 'report-bug', table: null, hint: 'This check failed to run against your data; the gap it covers is unverified.' } };
  }
}

/** Run a whole set of packs. Returns results in registry order. */
export function runAll(db, { packs = ['core'], edition = null, today: on } = {}) {
  const ctx = checkContext(edition, on ? { today: on } : {});
  return checksFor(packs).map((c) => runCheck(c, db, ctx));
}

/** Counts by severity and status, the number a head of school reads first. */
export function summarize(results) {
  const empty = () => ({ pass: 0, fail: 0, warn: 0, 'n/a': 0 });
  const summary = { required: empty(), recommended: empty() };
  for (const r of results) (summary[r.severity] || (summary[r.severity] = empty()))[r.status]++;
  return summary;
}
