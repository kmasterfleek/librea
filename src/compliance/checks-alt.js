// Alt pack: charters, continuation and community day schools, therapeutic
// programs, independent study. Students arrive mid-year, behind on credits,
// with plans that other schools wrote. These checks are about not losing them.
import { today, shiftDays, lastSchoolDays, ph, enrolledStudents, nameOf, ageOn, idSet, outcome } from './util.js';

const PACK = 'alt';
const check = (c) => ({ pack: PACK, severity: 'required', ...c });

const ACTIVE_PLAN = "(status IS NULL OR lower(status) != 'closed')";

/** Students receiving a service, ignoring services that have already ended. */
function servedBy(db, types, on) {
  const list = types.map((t) => t.toLowerCase());
  return db.prepare('SELECT DISTINCT studentSourcedId AS id, type, endDate FROM services').all()
    .filter((s) => list.includes(String(s.type || '').toLowerCase()) && (!s.endDate || s.endDate >= on));
}

export const ALT_CHECKS = [
  check({
    id: 'alt.iep-504-plan', subject: 'student', title: 'Every IEP or 504 student has a plan reviewed in the last 12 months',
    why: 'A student with a service and no current written plan is a civil-rights complaint waiting to be filed.',
    run(db, ctx) {
      const cutoff = shiftDays(ctx.today, -365);
      const served = servedBy(db, ['IEP', '504'], ctx.today);
      const names = new Map(enrolledStudents(db).map((s) => [s.id, nameOf(s)]));
      const plans = db.prepare(`SELECT studentSourcedId AS id, type, reviewDate FROM learning_plans WHERE ${ACTIVE_PLAN}`).all();
      const ok = new Set(plans.filter((p) => ['iep', '504'].includes(String(p.type || '').toLowerCase()) && p.reviewDate && p.reviewDate >= cutoff).map((p) => p.id));
      const failing = served.filter((s) => !ok.has(s.id))
        .map((s) => ({ id: s.id, label: names.get(s.id) || s.id, detail: `${s.type} service with no plan reviewed since ${cutoff}` }));
      return outcome({ total: served.length, failing, fix: { action: 'write-plan', table: 'learning_plans', hint: "Add or update a learning_plans row with type 'IEP' or '504', status 'active', and the date of the last review." } });
    },
  }),
  check({
    id: 'alt.behavior-plan', subject: 'student', title: 'Behavior support plan after three incidents in 60 days',
    why: 'Repeated incidents without a written support plan means the school is punishing a pattern instead of changing it.',
    run(db, ctx) {
      const since = shiftDays(ctx.today, -60);
      const counts = db.prepare('SELECT studentSourcedId AS id, count(*) n FROM discipline_incidents WHERE date >= ? AND date <= ? GROUP BY studentSourcedId HAVING n >= 3').all(since, ctx.today);
      const names = new Map(enrolledStudents(db).map((s) => [s.id, nameOf(s)]));
      const have = idSet(db.prepare(`SELECT DISTINCT studentSourcedId AS id FROM learning_plans WHERE lower(COALESCE(type,'')) = 'bsp' AND ${ACTIVE_PLAN}`).all(), 'id');
      const failing = counts.filter((c) => !have.has(c.id))
        .map((c) => ({ id: c.id, label: names.get(c.id) || c.id, detail: `${c.n} incidents since ${since}, no active behavior support plan` }));
      return outcome({ total: counts.length, failing, fix: { action: 'write-plan', table: 'learning_plans', hint: "Add a learning_plans row: type 'BSP', status 'active', goals, owner, reviewDate." } });
    },
  }),
  check({
    id: 'alt.credit-progress', subject: 'student', title: 'Juniors and seniors on track for credits',
    why: 'A student can attend every day and still not graduate; credits are the only number that says whether the diploma is reachable.',
    run(db, ctx) {
      const target = Number(ctx.config.creditTarget) || 22;
      const students = enrolledStudents(db).filter((s) => Number(s.grade) === 11 || Number(s.grade) === 12);
      if (!students.length) return outcome({ total: 0, failing: [], fix: FIX_CREDIT });
      const creditItems = db.prepare("SELECT count(*) c FROM line_items WHERE lower(COALESCE(category,'')) = 'credit'").get().c;
      const ids = students.map((s) => s.id);
      const earned = new Map((creditItems
        ? db.prepare(`SELECT r.studentSourcedId id, sum(COALESCE(r.score,0)) v FROM results r JOIN line_items li ON li.sourcedId = r.lineItemSourcedId
             WHERE lower(COALESCE(li.category,'')) = 'credit' AND r.studentSourcedId IN (${ph(ids)}) GROUP BY 1`)
        : db.prepare(`SELECT userSourcedId id, count(DISTINCT classSourcedId) v FROM enrollments
             WHERE lower(COALESCE(role,'')) = 'student' AND userSourcedId IN (${ph(ids)}) GROUP BY 1`)).all(...ids).map((r) => [r.id, r.v]));
      const failing = students.map((s) => ({ s, want: Math.round((target * (Number(s.grade) - 9)) / 4 * 10) / 10, got: earned.get(s.id) || 0 }))
        .filter((x) => x.got < x.want)
        .map(({ s, want, got }) => ({ id: s.id, label: nameOf(s), detail: `${got} of ${want} credits expected entering grade ${s.grade} (${target} to graduate)` }));
      return outcome({ total: students.length, failing, fix: FIX_CREDIT });
    },
  }),
  check({
    id: 'alt.transition-plan', subject: 'student', title: 'Transition plan for seniors and students 16 and older',
    why: 'The law and the family both expect a written answer to "what happens after this school".',
    run(db, ctx) {
      const students = enrolledStudents(db).filter((s) => Number(s.grade) === 12 || (ageOn(s.dob, ctx.today) ?? 0) >= 16);
      const have = idSet(db.prepare(`SELECT DISTINCT studentSourcedId AS id FROM learning_plans WHERE lower(COALESCE(type,'')) = 'transition' AND ${ACTIVE_PLAN}`).all(), 'id');
      const failing = students.filter((s) => !have.has(s.id))
        .map((s) => ({ id: s.id, label: nameOf(s), detail: `grade ${s.grade ?? '?'}${ageOn(s.dob, ctx.today) != null ? `, age ${ageOn(s.dob, ctx.today)}` : ''}, no transition plan` }));
      return outcome({ total: students.length, failing, fix: { action: 'write-plan', table: 'learning_plans', hint: "Add a learning_plans row: type 'transition', status 'active', goals naming the next placement, job, or program." } });
    },
  }),
  check({
    id: 'alt.re-engagement', severity: 'recommended', subject: 'student', title: 'Students to call back this week',
    why: 'In an alternative school the students who drift out do it quietly, and three missed days is when a phone call still works.',
    run(db, ctx) {
      const days = lastSchoolDays(db, 10, { upTo: ctx.today });
      if (!days.length) return outcome({ total: 0, failing: [], warn: true, fix: FIX_REENGAGE });
      const students = enrolledStudents(db);
      const absent = new Map(db.prepare(`SELECT studentSourcedId id, count(DISTINCT date) n FROM attendance
        WHERE date IN (${ph(days)}) AND lower(COALESCE(code,'')) IN ('absent','unexcused') GROUP BY 1`).all(...days).map((r) => [r.id, r.n]));
      const seen = idSet(db.prepare(`SELECT DISTINCT studentSourcedId FROM attendance WHERE date IN (${ph(days)})`).all(...days), 'studentSourcedId');
      const failing = students.map((s) => ({ s, n: absent.get(s.id) ?? (seen.has(s.id) ? 0 : days.length) }))
        .filter((x) => x.n >= 3).sort((a, b) => b.n - a.n)
        .map(({ s, n }) => ({ id: s.id, label: nameOf(s), detail: `absent ${n} of the last ${days.length} school days` }));
      return outcome({ total: students.length, failing, warn: true, fix: FIX_REENGAGE });
    },
  }),
  check({
    id: 'alt.ada-completeness', subject: 'organization', title: 'Apportionment attendance complete and coded',
    why: 'Average daily attendance is what the school is paid on, and a blank or unrecognized code is money an auditor will claw back.',
    run(db, ctx) {
      const days = lastSchoolDays(db, 20, { upTo: ctx.today });
      if (!days.length) return outcome({ total: 0, failing: [], fix: FIX_ADA });
      const students = enrolledStudents(db);
      const expected = students.length * days.length;
      const rows = db.prepare(`SELECT studentSourcedId id, date, code FROM attendance WHERE date IN (${ph(days)})`).all(...days);
      const valid = new Set(['present', 'absent', 'tardy', 'excused', 'remote', 'unexcused']);
      const bad = rows.filter((r) => !valid.has(String(r.code || '').toLowerCase()));
      const recorded = new Set(rows.map((r) => r.id + '|' + r.date));
      const missing = new Map();
      for (const s of students) { const n = days.filter((d) => !recorded.has(s.id + '|' + d)).length; if (n) missing.set(s.id, n); }
      const names = new Map(students.map((s) => [s.id, nameOf(s)]));
      const failing = [
        ...[...missing].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: names.get(id) || id, detail: `${n} of ${days.length} apportionment days unrecorded` })),
        ...bad.slice(0, 50).map((r) => ({ id: r.id + '|' + r.date, label: names.get(r.id) || r.id, detail: `${r.date}: code ${r.code == null || r.code === '' ? '(blank)' : r.code} is not an apportionment code` })),
      ];
      return outcome({ total: expected, failing, fix: FIX_ADA });
    },
  }),
];

const FIX_CREDIT = { action: 'record-credits', table: 'results', hint: "Record earned credits as results against line_items with category 'credit', then add a 'credit-recovery' learning plan for students behind." };
const FIX_REENGAGE = { action: 'contact-family', table: 'contacts', hint: 'Call the family, log what happened as a fragment, and record a withdrawal only if that is really what happened.' };
const FIX_ADA = { action: 'take-attendance', table: 'attendance', hint: 'Fill the missing days and replace unrecognized codes with present, absent, tardy, excused, or remote.' };
