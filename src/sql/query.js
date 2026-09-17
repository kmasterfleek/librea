// Scoped, read-only SQL. The caller's scope is enforced by the database, not
// by the model or the app: for each request we create TEMP views that shadow
// the real tables (SQLite resolves unqualified names in temp first), filtered
// to the rows and columns the scope allows, run one read-only statement with
// a row cap, then drop the views.
import { STUDENT_SCOPED, PII_COLS, PII_ONLY_TABLES, FACT_TABLE_NAMES, describeSchema } from './schema.js';

const MAX_ROWS = 2000;
const FORBIDDEN = /\b(main|temp|sqlite_master|sqlite_temp_master|sqlite_schema|attach|detach|pragma|load_extension|vacuum|writefile|readfile|fts5|zipfile)\b/i;

export class SqlError extends Error { constructor(msg) { super(msg); this.status = 400; } }

function stripComments(sql) { return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim(); }

/** Validate that `sql` is a single read-only SELECT. Returns the cleaned statement. */
export function checkSql(sql) {
  if (typeof sql !== 'string') throw new SqlError('sql must be a string');
  let s = stripComments(sql).replace(/;\s*$/, '').trim();
  if (!s) throw new SqlError('empty query');
  if (s.length > 20000) throw new SqlError('query too long');
  if (s.includes(';')) throw new SqlError('one statement only');
  if (!/^(select|with)\b/i.test(s)) throw new SqlError('only SELECT (or WITH ... SELECT) is allowed');
  if (FORBIDDEN.test(s)) throw new SqlError('query references a forbidden object');
  return s;
}

function quoteList(ids) { return ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(', '); }

/** Build the TEMP view definitions for a scope. */
export function scopeViews(db, scope) {
  const views = [];
  const cols = (table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name);
  const own = scope.entityIds === null ? null : scope.entityIds || [];
  const pii = !!scope.pii;
  for (const table of ['students', 'staff', 'fragments', 'snapshots', ...FACT_TABLE_NAMES]) {
    const all = cols(table);
    const hidden = new Set(pii ? [] : (PII_COLS[table] || []));
    const select = all.filter((c) => !hidden.has(c)).map((c) => `"${c}"`).join(', ');
    const where = [];
    if (!pii && PII_ONLY_TABLES.includes(table)) where.push('0');
    if (own && STUDENT_SCOPED[table]) where.push(own.length ? `"${STUDENT_SCOPED[table]}" IN (${quoteList(own)})` : '0');
    if (table === 'fragments') where.push(scope.visibility?.length ? `"visibility" IN (${quoteList(scope.visibility)})` : '0');
    views.push(`CREATE TEMP VIEW "${table}" AS SELECT ${select} FROM main."${table}"${where.length ? ' WHERE ' + where.join(' AND ') : ''}`);
  }
  const ownWhere = own ? (own.length ? ` WHERE sourcedId IN (${quoteList(own)})` : ' WHERE 0') : '';
  views.push(`CREATE TEMP VIEW "users" AS SELECT sourcedId, 'student' AS role, ${pii ? 'givenName, familyName, email' : 'NULL AS givenName, NULL AS familyName, NULL AS email'}, grade, schoolSourcedId AS orgSourcedId FROM main."students"${ownWhere} UNION ALL SELECT sourcedId, 'teacher', givenName, familyName, ${pii ? 'email' : 'NULL'}, NULL, schoolSourcedId FROM main."staff"`);
  return views;
}

/**
 * Run one scoped read-only query. Returns { columns, rows, rowCount, truncated, ms }.
 * `db` is a better-sqlite3 Database; requests are serialized by Node, so the
 * temp views never leak between callers.
 */
export function runScoped(db, sql, scope, { limit = MAX_ROWS } = {}) {
  const clean = checkSql(sql);
  const cap = Math.max(1, Math.min(MAX_ROWS, Number(limit) || MAX_ROWS));
  const t0 = Date.now();
  const drop = () => { for (const v of ['students', 'staff', 'fragments', 'snapshots', 'users', ...FACT_TABLE_NAMES]) db.exec(`DROP VIEW IF EXISTS temp."${v}"`); };
  drop();
  for (const v of scopeViews(db, scope)) db.exec(v);
  try {
    let stmt;
    try { stmt = db.prepare(`SELECT * FROM (${clean}) LIMIT ${cap + 1}`); }
    catch (e) { throw new SqlError('SQL error: ' + e.message); }
    if (!stmt.readonly) throw new SqlError('query must be read-only');
    let rows;
    try { rows = stmt.all(); } catch (e) { throw new SqlError('SQL error: ' + e.message); }
    const truncated = rows.length > cap;
    if (truncated) rows.length = cap;
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows, rowCount: rows.length, truncated, ms: Date.now() - t0 };
  } finally { drop(); }
}

/** Schema description plus the scope's effective restrictions, for prompts and the UI. */
export function schemaFor(scope) {
  const tables = describeSchema().map((t) => ({ ...t, columns: scope.pii ? t.columns : t.columns.filter((c) => !(PII_COLS[t.name] || []).includes(c)) }))
    .filter((t) => scope.pii || !PII_ONLY_TABLES.includes(t.name));
  const notes = [];
  if (!scope.pii) notes.push('Student names, emails, birthdates, and guardian contacts are hidden in this scope (the users view returns NULL for student names). Staff names stay visible.');
  if (scope.entityIds !== null) notes.push(scope.entityIds?.length ? `Student-level tables only contain ${scope.entityIds.length} record(s) this viewer owns.` : 'Student-level tables are empty in this scope.');
  notes.push(`Fragments visible: ${(scope.visibility || []).join(', ') || 'none'}.`);
  notes.push(`Read-only; one SELECT per query; at most ${MAX_ROWS} rows returned.`);
  return { dialect: 'sqlite', tables, notes };
}
