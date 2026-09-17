// Derive a student's raw metrics from relational facts, so the signal vector
// becomes a live function of attendance rows, scores, incidents, and services
// rather than a vendor's summary column.
const PRESENT = new Set(['present', 'tardy', 'remote']);
const ABSENT = new Set(['absent', 'excused', 'unexcused']);

function gpaPoints(pct) { return pct >= 90 ? 4 : pct >= 80 ? 3 : pct >= 70 ? 2 : pct >= 60 ? 1 : 0; }

/** Compute derived metrics for one student from the projection. Returns only metrics with evidence. */
export function deriveStudent(db, id) {
  const m = {};
  const att = db.prepare('SELECT code, count(*) n FROM attendance WHERE studentSourcedId = ? GROUP BY code').all(id);
  if (att.length) {
    let p = 0, a = 0;
    for (const r of att) { const c = String(r.code || '').toLowerCase(); if (PRESENT.has(c)) p += r.n; else if (ABSENT.has(c)) a += r.n; }
    if (p + a) m.attendancePct = +((p / (p + a)) * 100).toFixed(1);
  }
  const res = db.prepare(`SELECT r.score, r.scoreStatus, li.resultValueMax mx, li.resultValueMin mn FROM results r LEFT JOIN line_items li ON li.sourcedId = r.lineItemSourcedId WHERE r.studentSourcedId = ?`).all(id);
  if (res.length) {
    const graded = res.filter((r) => r.score != null && !/exempt/i.test(r.scoreStatus || ''));
    const submitted = res.filter((r) => !/not submitted|missing/i.test(r.scoreStatus || '') && r.score != null);
    const exempt = res.filter((r) => /exempt/i.test(r.scoreStatus || '')).length;
    if (res.length - exempt > 0) m.assignCompletionPct = +((submitted.length / (res.length - exempt)) * 100).toFixed(1);
    const pts = graded.map((r) => { const mx = r.mx || 100, mn = r.mn || 0; return gpaPoints(((r.score - mn) / (mx - mn || 1)) * 100); });
    if (pts.length) m.gpa = +(pts.reduce((x, y) => x + y, 0) / pts.length).toFixed(2);
  }
  const inc = db.prepare('SELECT count(*) n FROM discipline_incidents WHERE studentSourcedId = ?').get(id).n;
  if (inc || att.length || res.length) m.disciplineIncidents = inc;
  const today = new Date().toISOString().slice(0, 10);
  const svc = db.prepare('SELECT type, level FROM services WHERE studentSourcedId = ? AND (endDate IS NULL OR endDate >= ?)').all(id, today);
  if (svc.length) {
    const has = (t) => svc.find((s) => String(s.type || '').toUpperCase() === t);
    const ell = has('ELL');
    if (ell) m.ellLevel = ['None', 'Advanced', 'Intermediate', 'Beginner', 'Newcomer'].find((l) => l.toLowerCase() === String(ell.level || '').toLowerCase()) || 'Intermediate';
    // Only assert a special-education level when a row says so; the absence of
    // a row is not evidence, and must not overwrite a value another import set.
    const iep = has('IEP'), p504 = has('504');
    if (iep) m.specialEd = /full/i.test(iep.level || '') ? 'IEP-full' : 'IEP-partial';
    else if (p504) m.specialEd = '504';
    const frl = has('FRL'); if (frl) m.ses = /free/i.test(frl.level || '') ? 0.15 : 0.35;
  }
  const extra = db.prepare(`SELECT count(*) n FROM enrollments e JOIN classes c ON c.sourcedId = e.classSourcedId WHERE e.userSourcedId = ? AND e.role = 'student' AND c.classType = 'extracurricular'`).get(id).n;
  if (extra) m.extracurricularCount = extra;
  return m;
}

/** Recompute and upsert metrics for many students. Returns { updated, skipped }. */
export function deriveAll(db, store, ids = null, actor = 'derive') {
  const targets = ids || store.listEntities({ type: 'student' }).map((s) => s.id);
  let updated = 0, skipped = 0;
  for (const id of targets) {
    const e = store.getEntity(id);
    if (!e || e.type !== 'student') { skipped++; continue; }
    const m = deriveStudent(db, id);
    if (!Object.keys(m).length) { skipped++; continue; }
    store.upsertEntity({ id, type: 'student', metrics: m, metricsSource: 'derived' }, actor);
    updated++;
  }
  return { updated, skipped };
}
