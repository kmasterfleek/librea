// Compliance HTTP surface. School-side views for admin and staff; one
// family-side to-do list so the people who hold the missing paperwork can see
// exactly what is missing without seeing anyone else's.
import { HttpError } from '../api/router.js';
import { requireUser, requireRole } from '../api/context.js';
import { runAll, summarize, getCheck, runCheck, checkContext, describe, checksFor, ALL_CHECKS } from './checks.js';
import { listReports, getReport } from './reports.js';
import { today, currentDocuments, nameOf } from './util.js';

/** Paperwork a family can actually go and find, by pack. */
const FAMILY_ITEMS = {
  core: [
    { key: 'emergency-contact', label: 'Emergency contact', kind: 'contact', why: 'Someone we can reach in the first minute.' },
    { key: 'immunization', label: 'Immunization record or exemption', kind: 'immunization', why: 'Required before a child attends.' },
    { key: 'enrollment', label: 'Enrollment form', kind: 'document', match: /enroll/i, why: 'The signed agreement that you chose this school.' },
    { key: 'emergency-card', label: 'Emergency card', kind: 'document', match: /emergency/i, why: 'Allergies, medical notes, and who may collect your child.' },
  ],
  micro: [
    { key: 'consent', label: 'Consent and custody form', kind: 'document', match: /consent|custody|guardian|authoriz/i, why: 'Who may collect your child and what care you agree to.' },
    { key: 'residency', label: 'Proof of residency', kind: 'document', match: /residen|address|utility|lease/i, why: 'Shows which community we serve.' },
  ],
  alt: [],
};

export function register(router, { store, sql, edition }) {
  const db = () => { if (!sql?.db) throw new HttpError(503, 'projection not open'); return sql.db; };
  const packs = () => (edition?.compliance?.packs?.length ? edition.compliance.packs : ['core']);

  /** The whole picture, without failing lists: what a head of school opens. */
  router.get('/api/compliance/status', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const on = /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.query.on || '')) ? ctx.query.on : today();
    const ran = new Date().toISOString();
    const results = runAll(db(), { packs: packs(), edition, today: on });
    const summary = summarize(results);
    logRun(store, ctx, { packs: packs(), summary, checks: results.length });
    return {
      packs: packs(), ran, asOf: on, edition: edition?.id || 'district',
      summary,
      checks: results.map(({ failing, ...rest }) => rest),
    };
  });

  /** One check, with the list of what is actually missing. */
  router.get('/api/compliance/checks/:id', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const check = getCheck(ctx.params.id);
    if (!check) throw new HttpError(404, `no such check; see GET /api/compliance/status`);
    const on = /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.query.on || '')) ? ctx.query.on : today();
    return { asOf: on, ...runCheck(check, db(), checkContext(edition, { today: on })) };
  });

  /** What checks exist at all, whether or not this edition runs them. */
  router.get('/api/compliance/catalog', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    const active = new Set(checksFor(packs()).map((c) => c.id));
    return { packs: packs(), checks: ALL_CHECKS.map((c) => ({ ...describe(c), active: active.has(c.id) })) };
  });

  router.get('/api/compliance/reports', (ctx) => {
    requireRole(ctx, 'admin', 'staff');
    return { reports: listReports() };
  });

  router.get('/api/compliance/reports/:id.csv', (ctx) => {
    requireRole(ctx, 'admin');
    const report = getReport(ctx.params.id);
    if (!report) throw new HttpError(404, 'no such report; see GET /api/compliance/reports');
    const { filename, csv } = report.generate(db(), ctx.query);
    ctx.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="librea-${filename}"`, 'cache-control': 'no-store' });
    ctx.res.end(csv);
  });

  /**
   * A family's or student's own to-do list. Scoped to the viewer's entityIds,
   * so it can say "Missing: emergency card" without revealing that anyone
   * else's is missing too.
   */
  router.get('/api/compliance/mine', (ctx) => {
    requireUser(ctx);
    const ids = ctx.scope.entityIds;
    if (ids === null) throw new HttpError(400, 'this account is not linked to a student; use GET /api/compliance/status');
    const students = ids.map((id) => todoFor(db(), id, packs())).filter(Boolean);
    // A flat list too, so a home-page card can render it without knowing how
    // many children the account covers.
    const items = students.flatMap((s) => s.items.map((i) => ({ ...i, studentId: s.studentId, label: students.length > 1 ? `${i.label} — ${s.student}` : i.label })));
    return {
      asOf: today(), students, items,
      missingCount: items.filter((i) => i.status !== 'pass').length,
      headline: students.length === 1 ? students[0].headline : `${items.filter((i) => i.status !== 'pass').length} things to sort out.`,
    };
  });
}

/** One student's outstanding paperwork. */
function todoFor(db, id, packs) {
  const s = db.prepare('SELECT sourcedId AS id, givenName, familyName, grade FROM students WHERE sourcedId = ?').get(id);
  if (!s) return null;
  const on = today();
  const docs = db.prepare("SELECT * FROM documents WHERE subjectType = 'student' AND subjectSourcedId = ?").all(id);
  const current = currentDocuments(db, 'student', /./, on).filter((d) => d.subjectSourcedId === id);
  const items = [];
  for (const pack of packs) for (const item of FAMILY_ITEMS[String(pack).toLowerCase()] || []) {
    let done = false, detail = '';
    if (item.kind === 'contact') {
      done = db.prepare('SELECT count(*) c FROM contacts WHERE studentSourcedId = ?').get(id).c > 0;
    } else if (item.kind === 'immunization') {
      done = db.prepare('SELECT count(*) c FROM immunizations WHERE studentSourcedId = ?').get(id).c > 0;
    } else {
      const ok = current.find((d) => item.match.test(String(d.type || '')));
      const stale = docs.find((d) => item.match.test(String(d.type || '')));
      done = !!ok;
      if (ok?.expiresDate) detail = `On file until ${ok.expiresDate}.`;
      else if (!ok && stale) detail = stale.expiresDate && stale.expiresDate < on ? `Expired ${stale.expiresDate} — it needs renewing.` : `Marked ${stale.status || 'missing'}.`;
    }
    if (!done && !detail) detail = 'Not on file yet. Bring it to the office or write to them and they will enter it here.';
    if (done && !detail) detail = 'On file.';
    items.push({ key: item.key, label: item.label, why: item.why, status: done ? 'pass' : 'fail', onFile: done, detail });
  }
  const missing = items.filter((i) => i.status !== 'pass');
  return {
    studentId: s.id, student: nameOf(s), grade: s.grade,
    complete: missing.length === 0, missingCount: missing.length,
    headline: missing.length ? `Missing: ${missing.map((i) => i.label.toLowerCase()).join(', ')}` : 'Everything we need is on file. Thank you.',
    items,
  };
}

/**
 * Record that the school checked, and what it found. No names, no ids, no
 * counts per child — just the fact and the shape of the answer, so a school
 * can prove it looked without the proof itself becoming a student record.
 */
function logRun(store, ctx, data) {
  try {
    const ev = store.ledger.append('compliance.run', data, ctx.user?.username || 'system');
    store._apply(ev);
  } catch { /* a compliance view must never fail because the log did */ }
}
