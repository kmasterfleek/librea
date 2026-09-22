// Shared helpers for compliance checks and reports. Everything here reads the
// SQLite projection (read-only) and works in plain ISO date strings, so a
// result can be read off a screen and compared with a paper file.

export const MAX_FAILING = 200;

export const today = () => new Date().toISOString().slice(0, 10);

/** ISO date `n` days from `iso` (negative goes back). */
export function shiftDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isWeekday = (iso) => {
  const w = new Date(iso + 'T00:00:00Z').getUTCDay();
  return w >= 1 && w <= 5;
};

/** July 1 boundary: the school year containing `iso` starts on July 1. */
export function schoolYearStart(iso = today()) {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 7 ? y : y - 1}-07-01`;
}

export const schoolYearLabel = (iso = today()) => {
  const y = Number(schoolYearStart(iso).slice(0, 4));
  return `${y}-${y + 1}`;
};

/**
 * School days, newest first: weekdays on which the school recorded any
 * attendance at all. A school that has never taken attendance has no school
 * days, and the checks that depend on them report 'n/a' rather than failing.
 */
export function schoolDays(db, { upTo = today(), max = 400 } = {}) {
  return db.prepare('SELECT DISTINCT date FROM attendance WHERE date IS NOT NULL AND date <= ? ORDER BY date DESC LIMIT ?')
    .all(upTo, max).map((r) => String(r.date).slice(0, 10)).filter(isWeekday);
}

export const lastSchoolDays = (db, n, opts) => schoolDays(db, opts).slice(0, n);

/** Placeholder list for an IN (...) clause. */
export const ph = (arr) => arr.map(() => '?').join(',');

const GONE = new Set(['withdrawn', 'inactive', 'graduated', 'transferred', 'deleted', 'exited', 'false', '0']);
const GONE_EVENTS = "('withdrawn','transferred','graduated')";

/** Students the school is currently responsible for. */
export function enrolledStudents(db) {
  const rows = db.prepare(`SELECT sourcedId AS id, givenName, familyName, grade, schoolSourcedId, dob, enrollStatus FROM students
    WHERE sourcedId NOT IN (
      SELECT e1.studentSourcedId FROM enrollment_events e1
      WHERE lower(e1.event) IN ${GONE_EVENTS}
        AND e1.date = (SELECT max(e2.date) FROM enrollment_events e2 WHERE e2.studentSourcedId = e1.studentSourcedId))
    ORDER BY grade, familyName, givenName`).all();
  return rows.filter((r) => !GONE.has(String(r.enrollStatus || '').trim().toLowerCase()));
}

export function allStaff(db) {
  return db.prepare('SELECT sourcedId AS id, givenName, familyName, role, schoolSourcedId FROM staff ORDER BY familyName, givenName').all();
}

/** A name an admin can act on, never an empty cell. */
export const nameOf = (r) => [r.givenName, r.familyName].filter(Boolean).join(' ').trim() || r.id || r.sourcedId || '(unnamed)';

/** Age in whole years on `on`, or null when no date of birth is recorded. */
export function ageOn(dob, on = today()) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const [by, bm, bd] = dob.slice(0, 10).split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const CURRENT_DOC = new Set(['on-file', 'waived']);

/** Documents that count as satisfied: on file (or waived) and not past expiry. */
export function currentDocuments(db, subjectType, re, on = today()) {
  return db.prepare('SELECT * FROM documents WHERE subjectType = ?').all(subjectType).filter((d) =>
    re.test(String(d.type || '')) && CURRENT_DOC.has(String(d.status || '').trim().toLowerCase()) && (!d.expiresDate || d.expiresDate >= on));
}

/** Staff credentials that count as satisfied: valid and not past expiry. */
export function validCredentials(db, re, on = today()) {
  return db.prepare('SELECT * FROM staff_credentials').all().filter((c) =>
    re.test(String(c.type || '')) && String(c.status || '').trim().toLowerCase() === 'valid' && (!c.expiresDate || c.expiresDate >= on));
}

export const idSet = (rows, key) => new Set(rows.map((r) => r[key]).filter(Boolean));

/**
 * Shape a check result. `warn` turns a non-empty failing list into a warning
 * rather than a failure; an empty subject list is 'n/a', never a false pass.
 */
export function outcome({ total, failing, fix, warn = false, status }) {
  const failingCount = failing.length;
  return {
    status: status || (total === 0 ? 'n/a' : failingCount === 0 ? 'pass' : warn ? 'warn' : 'fail'),
    total, failingCount, truncated: failingCount > MAX_FAILING,
    failing: failing.slice(0, MAX_FAILING), fix,
  };
}

// ---- CSV (same quoting as src/api/routes-export.js) ----
export const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
