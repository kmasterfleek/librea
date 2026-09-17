// Offline app templates. No model, no key, no network: the whole vibe-coding
// flow works on a laptop in a school basement. Each template is a complete
// document that exercises the same window.librea runtime a generated app uses.

const CSS = `
:root{--bg:#faf7f2;--card:#fff;--ink:#23201c;--mut:#6d6559;--line:#e7e0d5;--accent:#3d6b8e;--warm:#c97b4a;--ok:#6d8f6a;--radius:14px}
@media (prefers-color-scheme:dark){:root{--bg:#1a1815;--card:#232019;--ink:#f0ebe3;--mut:#a79c8d;--line:#3a352c;--accent:#7fa8c9;--warm:#e0a077}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 40px}
h1{font-size:clamp(22px,4vw,30px);margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:17px;margin:0 0 12px;letter-spacing:-.005em}
.sub{color:var(--mut);margin:0 0 24px;max-width:62ch}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.stat{font-size:30px;font-weight:650;letter-spacing:-.02em;margin:2px 0 0}
.lab{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
canvas{width:100%;height:260px;display:block}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em}
tbody tr:hover{background:rgba(0,0,0,.025)}
.tools{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px;align-items:end}
label{display:block;font-size:12.5px;color:var(--mut);margin-bottom:4px}
input,select,textarea,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
textarea{width:100%;min-height:110px;resize:vertical}
button{background:var(--accent);color:#fff;border-color:transparent;cursor:pointer;font-weight:600}
button:hover{filter:brightness(1.08)}
:focus-visible{outline:2px solid var(--warm);outline-offset:2px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;background:rgba(61,107,142,.12);color:var(--accent)}
.empty{color:var(--mut);padding:22px;text-align:center;border:1px dashed var(--line);border-radius:var(--radius)}
.err{color:#b4585f;padding:12px;border:1px solid #b4585f33;border-radius:10px;background:#b4585f0d}
.frag{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin:0 0 14px}
.frag .who{font-size:12.5px;color:var(--mut)}
.scroll{overflow-x:auto}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.trim();

const HELPERS = `
var $ = function (s, r) { return (r || document).querySelector(s); };
function fail(e) { var b = $('#err'); b.hidden = false; b.textContent = e && e.message ? e.message : String(e); }
function note(msg) { var n = document.createElement('p'); n.className = 'empty'; n.textContent = msg; return n; }
function esc(s) { return String(s == null ? '' : s); }
function nameOf(p) { var n = [p.firstName, p.lastName].filter(Boolean).join(' '); return n || p.preferredName || p.id; }
function gradeOf(p) { return p.grade == null ? '\\u2014' : p.grade === 0 ? 'K' : p.grade === -1 ? 'PK' : String(p.grade); }
`.trim();

function page(title, bodyHtml, script) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
${bodyHtml}
<div id="err" class="err" role="alert" hidden></div>
</main>
<script>
${HELPERS}
(async function () {
  try {
    await librea.ready();
${script}
  } catch (e) { fail(e); }
  librea.footer(document.querySelector('.wrap'));
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- templates

function dashboard(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<section class="grid" id="tiles" aria-live="polite"></section>
<section class="card" style="margin-top:16px">
  <h2>Absence rate by school</h2>
  <p class="sub" style="margin:0 0 10px" id="src">Share of attendance records marked absent or excused.</p>
  <canvas id="bySchool" aria-label="Absence rate by school"></canvas>
  <div class="scroll" style="margin-top:14px"><table><thead><tr><th>School</th><th>Absence rate</th><th>Students</th></tr></thead><tbody id="rows"></tbody></table></div>
</section>
<section class="card" style="margin-top:16px">
  <h2>Where students stand</h2>
  <canvas id="outcomes" aria-label="Students by outcome"></canvas>
  <p id="supp" class="lab"></p>
</section>`, `
    // Core first: the tiles never depend on anything below them.
    var s = await librea.stats();
    [['Students', s.students], ['Schools', (s.schools || []).length], ['Voices on record', s.fragments], ['Staff', s.staff]].forEach(function (row) {
      $('#tiles').appendChild(librea.el('div', { class: 'card' }, [
        librea.el('div', { class: 'lab', text: row[0] }),
        librea.el('div', { class: 'stat', text: String(row[1] == null ? '\\u2014' : row[1]) })
      ]));
    });

    // Preferred path: one SQL query over the attendance rows.
    var labels = [], values = [], counts = [], usedSql = false;
    try {
      var r = await librea.sql(
        "SELECT o.name AS school, " +
        "ROUND(100.0 * SUM(CASE WHEN a.code IN ('absent','excused') THEN 1 ELSE 0 END) / COUNT(*), 1) AS absenceRate, " +
        "COUNT(DISTINCT a.studentSourcedId) AS students " +
        "FROM attendance a JOIN students s ON s.sourcedId = a.studentSourcedId " +
        "JOIN orgs o ON o.sourcedId = s.schoolSourcedId GROUP BY o.sourcedId ORDER BY absenceRate DESC");
      if (r.rowCount) {
        usedSql = true;
        r.rows.forEach(function (row) { labels.push(row.school); values.push(row.absenceRate); counts.push(row.students); });
      }
    } catch (e) { $('#src').textContent = 'Attendance rows are unavailable (' + e.message + '); showing the signal average instead.'; }

    // Fallback: no attendance table yet, so use the normalized attendance dimension.
    if (!usedSql) {
      try {
        var agg = await librea.aggregate({ groupBy: 'schoolId', metric: 'attendance' });
        agg.groups.forEach(function (g) { labels.push(g.label); values.push(g.value == null ? 0 : Math.round((1 - g.value) * 1000) / 10); counts.push(g.n); });
        if (!usedSql && agg.groups.length) $('#src').textContent = 'From the normalized attendance signal, because no attendance records have been imported yet.';
        if (agg.suppressed) $('#supp').textContent = agg.suppressed + ' student(s) fell in groups too small to report (k=' + agg.kAnonymity + ').';
      } catch (e2) { fail(e2); }
    }

    if (!labels.length) $('#bySchool').replaceWith(note('No attendance data to chart yet.'));
    else librea.chart.bar($('#bySchool'), labels, values, { format: function (v) { return v.toFixed(1) + '%'; } });
    labels.forEach(function (l, i) {
      $('#rows').appendChild(librea.el('tr', null, [
        librea.el('td', { text: l }),
        librea.el('td', { text: (values[i] == null ? '\\u2014' : values[i].toFixed(1) + '%') }),
        librea.el('td', { text: String(counts[i] == null ? '\\u2014' : counts[i]) })
      ]));
    });

    // Decorative: its own try/catch, so a failure here cannot blank the page.
    try {
      var out = await librea.sql('SELECT outcome, COUNT(*) AS n FROM students WHERE outcome IS NOT NULL GROUP BY outcome ORDER BY n DESC');
      if (!out.rowCount) $('#outcomes').replaceWith(note('No outcomes to show yet.'));
      else librea.chart.bar($('#outcomes'), out.rows.map(function (x) { return x.outcome; }), out.rows.map(function (x) { return x.n; }), { format: function (v) { return Math.round(v); } });
    } catch (e3) { $('#outcomes').replaceWith(note('Outcome breakdown unavailable: ' + e3.message)); }`);
}

function roster(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<div class="tools">
  <div><label for="q">Search</label><input id="q" type="search" placeholder="name or id" autocomplete="off"></div>
  <div><label for="grade">Grade</label><input id="grade" type="number" min="-1" max="13" style="width:100px"></div>
  <div><label for="school">School</label><select id="school"><option value="">All schools</option></select></div>
  <button id="go" type="button">Filter</button>
</div>
<div class="card scroll"><table><thead><tr><th>Name</th><th>Grade</th><th>School</th><th>Standing</th></tr></thead><tbody id="rows"></tbody></table></div>
<p id="count" class="lab" style="margin-top:12px" aria-live="polite"></p>`, `
    var s = await librea.stats();
    var schools = {};
    (s.schools || []).forEach(function (sc) {
      schools[sc.id] = sc.name;
      $('#school').appendChild(librea.el('option', { value: sc.id, text: sc.name + ' (' + sc.students + ')' }));
    });
    async function load() {
      var args = { type: 'student', limit: 200 };
      if ($('#q').value.trim()) args.q = $('#q').value.trim();
      if ($('#grade').value !== '') args.grade = Number($('#grade').value);
      if ($('#school').value) args.schoolId = $('#school').value;
      var r = await librea.people(args);
      var body = $('#rows');
      body.textContent = '';
      if (!r.people.length) { $('#count').textContent = 'No students match that filter.'; return; }
      r.people.forEach(function (p) {
        body.appendChild(librea.el('tr', null, [
          librea.el('td', { text: nameOf(p) }),
          librea.el('td', { text: gradeOf(p) }),
          librea.el('td', { text: schools[p.schoolId] || p.schoolId || '\\u2014' }),
          librea.el('td', null, librea.el('span', { class: 'pill', text: p.outcome || 'unknown' }))
        ]));
      });
      $('#count').textContent = 'Showing ' + r.people.length + ' of ' + r.total + '.';
    }
    $('#go').addEventListener('click', function () { load().catch(fail); });
    $('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') load().catch(fail); });
    await load();`);
}

function profile(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<section class="grid">
  <div class="card"><h2 id="who">Your record</h2><div id="meta" class="lab"></div><div id="frags" style="margin-top:16px"></div></div>
  <div class="card"><h2>Your fifteen signals</h2><canvas id="radar" style="height:320px" aria-label="Signal radar"></canvas><p class="lab">Each spoke runs 0 to 1. Further out is the more favorable end. These are prompts for a conversation, not a judgement.</p></div>
</section>`, `
    var me = await librea.me();
    var id = me.entityId || (me.scope.entityIds || [])[0];
    if (!id) { $('#frags').appendChild(note('This app is not linked to a record, so there is nothing personal to show.')); return; }
    var r = await librea.person(id);
    $('#who').textContent = nameOf(r.person);
    $('#meta').textContent = 'Grade ' + gradeOf(r.person) + ' \\u00b7 ' + (r.person.schoolId || 'school unknown') + ' \\u00b7 standing: ' + (r.person.outcome || 'unknown');
    var schema = await librea.schema();
    var dims = r.person.dims || {};
    librea.chart.radar($('#radar'), schema.dimensions.map(function (d) { return d.label; }), schema.dimensions.map(function (d) { return dims[d.key] == null ? 0 : dims[d.key]; }), { max: 1 });
    var box = $('#frags');
    if (!r.fragments.length) { box.appendChild(note('Nothing has been written here yet.')); return; }
    r.fragments.slice(0, 20).forEach(function (f) {
      box.appendChild(librea.el('div', { class: 'frag' }, [
        librea.el('div', { text: f.text }),
        librea.el('div', { class: 'who', text: (f.author && f.author.name || f.kind) + ' \\u00b7 ' + f.kind + ' \\u00b7 ' + String(f.createdAt).slice(0, 10) })
      ]));
    });`);
}

function searchApp(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask} This searches by meaning, not by keyword, across what students, families, and staff have written.</p>
<div class="tools">
  <div style="flex:1;min-width:220px"><label for="q">Describe who you are looking for</label><input id="q" type="search" style="width:100%" placeholder="students who love building things"></div>
  <button id="go" type="button">Search</button>
</div>
<div id="out" aria-live="polite"></div>`, `
    async function run() {
      var q = $('#q').value.trim();
      var out = $('#out');
      out.textContent = '';
      if (!q) { out.appendChild(note('Type something to search for.')); return; }
      out.appendChild(note('Searching\\u2026'));
      var r = await librea.search(q, { k: 12, type: 'student' });
      out.textContent = '';
      if (!r.results.length) { out.appendChild(note(r.note || 'Nothing matched. Try describing it a different way.')); return; }
      r.results.forEach(function (row) {
        var card = librea.el('div', { class: 'card', style: { marginBottom: '12px' } }, [
          librea.el('h2', { text: nameOf(row.person) + ' \\u00b7 grade ' + gradeOf(row.person) }),
          librea.el('div', { class: 'lab', text: 'match ' + Math.round(row.score * 100) + '%' })
        ]);
        row.fragments.slice(0, 2).forEach(function (f) {
          card.appendChild(librea.el('div', { class: 'frag' }, [
            librea.el('div', { text: f.text }),
            librea.el('div', { class: 'who', text: f.kind + ' \\u00b7 ' + f.visibility })
          ]));
        });
        out.appendChild(card);
      });
    }
    $('#go').addEventListener('click', function () { run().catch(fail); });
    $('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run().catch(fail); });`);
}

function submit(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<section class="card">
  <h2>Write your reflection</h2>
  <label for="text">What did you do, and what would you change next time?</label>
  <textarea id="text" maxlength="4000"></textarea>
  <div class="tools" style="margin-top:12px">
    <div><label for="vis">Who can read this</label><select id="vis"><option value="school">My school record</option><option value="family">My family and me</option><option value="private">Only me</option></select></div>
    <button id="save" type="button">Submit</button>
  </div>
  <p id="msg" class="lab" aria-live="polite"></p>
</section>
<section style="margin-top:20px"><h2>What you have written</h2><div id="list"></div></section>`, `
    var me = await librea.me();
    var id = me.entityId || (me.scope.entityIds || [])[0];
    if (!id) { $('#save').disabled = true; $('#msg').textContent = 'This app is not linked to a record, so it cannot save a reflection.'; }
    async function refresh() {
      if (!id) return;
      var r = await librea.fragments(id, { limit: 30 });
      var list = $('#list');
      list.textContent = '';
      var mine = r.fragments.filter(function (f) { return f.kind === 'self' || f.kind === 'artifact'; });
      if (!mine.length) { list.appendChild(note('Nothing submitted yet. Your first reflection will appear here.')); return; }
      mine.forEach(function (f) {
        list.appendChild(librea.el('div', { class: 'frag' }, [
          librea.el('div', { text: f.text }),
          librea.el('div', { class: 'who', text: String(f.createdAt).slice(0, 10) + ' \\u00b7 visible to ' + f.visibility })
        ]));
      });
    }
    $('#save').addEventListener('click', function () {
      var text = $('#text').value.trim();
      if (!text) { $('#msg').textContent = 'Write something first.'; return; }
      $('#save').disabled = true;
      librea.addFragment(id, { kind: 'self', text: text, visibility: $('#vis').value })
        .then(function () { $('#text').value = ''; $('#msg').textContent = 'Saved to your record.'; return refresh(); })
        .catch(function (e) { $('#msg').textContent = e.message; })
        .then(function () { $('#save').disabled = false; });
    });
    await refresh();`);
}

function website(title, ask) {
  return page(title, `
<header style="text-align:center;padding:36px 0 10px">
  <h1>${title}</h1>
  <p class="sub" style="margin:0 auto">${ask}</p>
</header>
<section class="grid" id="tiles"></section>
<section class="card" style="margin-top:20px">
  <h2>Our people</h2>
  <div class="scroll"><table><thead><tr><th>Name</th><th>Grade</th></tr></thead><tbody id="rows"></tbody></table></div>
  <p id="count" class="lab"></p>
</section>`, `
    var s = await librea.stats();
    [['Students', s.students], ['Schools', (s.schools || []).length], ['Voices on record', s.fragments]].forEach(function (row) {
      $('#tiles').appendChild(librea.el('div', { class: 'card' }, [
        librea.el('div', { class: 'lab', text: row[0] }),
        librea.el('div', { class: 'stat', text: String(row[1] == null ? '\\u2014' : row[1]) })
      ]));
    });
    var r = await librea.people({ type: 'student', limit: 40 });
    if (!r.people.length) { $('#rows').closest('.scroll').replaceWith(note('This app reads aggregates only, so no individual roster is shown.')); return; }
    r.people.forEach(function (p) {
      $('#rows').appendChild(librea.el('tr', null, [librea.el('td', { text: nameOf(p) }), librea.el('td', { text: gradeOf(p) })]));
    });
    $('#count').textContent = 'Showing ' + r.people.length + ' of ' + r.total + '.';`);
}

function enrollments(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<div class="tools">
  <div><label for="cls">Class</label><select id="cls"><option value="">Choose a class</option></select></div>
  <span id="teacher" class="pill" hidden></span>
</div>
<div class="card scroll"><table><thead><tr><th>Student</th><th>Grade</th><th>Standing</th><th>Attendance</th></tr></thead><tbody id="rows"></tbody></table></div>
<p id="count" class="lab" style="margin-top:12px" aria-live="polite"></p>`, `
    var classes = await librea.sql(
      "SELECT c.sourcedId AS id, c.title AS title, c.classCode AS code, o.name AS school, COUNT(e.sourcedId) AS n " +
      "FROM classes c LEFT JOIN enrollments e ON e.classSourcedId = c.sourcedId AND e.role = 'student' " +
      "LEFT JOIN orgs o ON o.sourcedId = c.schoolSourcedId GROUP BY c.sourcedId ORDER BY c.title");
    if (!classes.rowCount) { $('#count').textContent = 'No classes have been imported yet, so there is no roster to show.'; return; }
    classes.rows.forEach(function (c) {
      $('#cls').appendChild(librea.el('option', { value: c.id, text: c.title + (c.school ? ' \\u00b7 ' + c.school : '') + ' (' + c.n + ')' }));
    });

    async function load(id) {
      var body = $('#rows');
      body.textContent = '';
      $('#count').textContent = 'Loading\\u2026';
      var q = "SELECT s.sourcedId AS id, s.givenName AS given, s.familyName AS family, s.grade AS grade, " +
        "s.outcome AS outcome, s.attendancePct AS attendance FROM enrollments e " +
        "JOIN students s ON s.sourcedId = e.userSourcedId WHERE e.role = 'student' AND e.classSourcedId = '" +
        String(id).replace(/'/g, "''") + "' ORDER BY s.familyName, s.givenName";
      var r = await librea.sql(q);
      if (!r.rowCount) { $('#count').textContent = 'Nobody is enrolled in that class, or those students are outside this app\\u2019s scope.'; return; }
      r.rows.forEach(function (p) {
        body.appendChild(librea.el('tr', null, [
          librea.el('td', { text: [p.given, p.family].filter(Boolean).join(' ') || p.id }),
          librea.el('td', { text: gradeOf(p) }),
          librea.el('td', null, librea.el('span', { class: 'pill', text: p.outcome || 'unknown' })),
          librea.el('td', { text: p.attendance == null ? '\\u2014' : Number(p.attendance).toFixed(0) + '%' })
        ]));
      });
      $('#count').textContent = r.rowCount + ' enrolled' + (r.truncated ? ' (list truncated)' : '') + '.';
    }
    $('#cls').addEventListener('change', function () { if (this.value) load(this.value).catch(fail); });`);
}

function generic(title, ask) {
  return page(title, `
<h1>${title}</h1>
<p class="sub">${ask}</p>
<section class="grid" id="tiles"></section>
<section class="card" style="margin-top:16px">
  <h2>Students by school</h2>
  <canvas id="chart" aria-label="Students by school"></canvas>
</section>
<section class="card" style="margin-top:16px">
  <h2>Find someone</h2>
  <div class="tools"><div style="flex:1;min-width:200px"><label for="q">Search by meaning</label><input id="q" type="search" style="width:100%"></div><button id="go" type="button">Search</button></div>
  <div id="out" aria-live="polite"></div>
</section>
<section class="card" style="margin-top:16px">
  <h2>People</h2>
  <div class="scroll"><table><thead><tr><th>Name</th><th>Grade</th><th>Standing</th></tr></thead><tbody id="rows"></tbody></table></div>
</section>`, `
    var s = await librea.stats();
    [['Students', s.students], ['Schools', (s.schools || []).length], ['Voices on record', s.fragments], ['Staff', s.staff]].forEach(function (row) {
      $('#tiles').appendChild(librea.el('div', { class: 'card' }, [
        librea.el('div', { class: 'lab', text: row[0] }),
        librea.el('div', { class: 'stat', text: String(row[1] == null ? '\\u2014' : row[1]) })
      ]));
    });
    var agg = await librea.aggregate({ groupBy: 'schoolId', metric: 'count' });
    if (agg.groups.length) librea.chart.bar($('#chart'), agg.groups.map(function (g) { return g.label; }), agg.groups.map(function (g) { return g.value; }), { format: function (v) { return Math.round(v); } });
    else $('#chart').replaceWith(note('No group is large enough to report.'));
    var r = await librea.people({ type: 'student', limit: 50 });
    if (!r.people.length) $('#rows').closest('.scroll').replaceWith(note('No individual records are in this app\\u2019s scope.'));
    r.people.forEach(function (p) {
      $('#rows').appendChild(librea.el('tr', null, [
        librea.el('td', { text: nameOf(p) }), librea.el('td', { text: gradeOf(p) }),
        librea.el('td', null, librea.el('span', { class: 'pill', text: p.outcome || 'unknown' }))
      ]));
    });
    $('#go').addEventListener('click', function () {
      var q = $('#q').value.trim();
      var out = $('#out');
      out.textContent = '';
      if (!q) { out.appendChild(note('Type something to search for.')); return; }
      librea.search(q, { k: 8, type: 'student' }).then(function (res) {
        out.textContent = '';
        if (!res.results.length) { out.appendChild(note(res.note || 'Nothing matched.')); return; }
        res.results.forEach(function (row) {
          out.appendChild(librea.el('div', { class: 'frag' }, [
            librea.el('div', { text: nameOf(row.person) + ' \\u2014 ' + (row.fragments[0] ? row.fragments[0].text : '') }),
            librea.el('div', { class: 'who', text: 'match ' + Math.round(row.score * 100) + '%' })
          ]));
        });
      }).catch(fail);
    });`);
}

const MATCHERS = [
  { name: 'dashboard', re: /\b(dashboard|absente+ism|absent|attendance|chronic|district.?wide|overview|trends?|analytics|report)\b/i, build: dashboard },
  { name: 'submit', re: /\b(assignment|reflection|reflect|submit|submission|journal|response|turn in|hand in|write about)\b/i, build: submit },
  { name: 'profile', re: /\b(radar|profile|my record|my own|about me|myself|my signals|my data|my record)\b/i, build: profile },
  { name: 'search', re: /\b(search|find|look ?up|discover|who (is|are)|match)\b/i, build: searchApp },
  { name: 'enrollments', re: /\b(enroll(ed|ment)s?|class list|my class(es)?|section|homeroom|period|who is in)\b/i, build: enrollments },
  { name: 'website', re: /\b(website|web ?site|landing|home ?page|site|page for|public page)\b/i, build: website },
  { name: 'roster', re: /\b(roster|list|club|team|class list|directory|members?|group)\b/i, build: roster },
];

/** Pick a template for a prompt. Deterministic: the same words give the same app. */
export function chooseTemplate(prompt) {
  for (const m of MATCHERS) if (m.re.test(String(prompt || ''))) return m;
  return { name: 'generic', build: generic };
}

/** Render a full HTML document for this request, offline. */
export function renderTemplate(prompt, title) {
  const t = chooseTemplate(prompt);
  const ask = String(prompt || 'An app for this school.').trim().replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).slice(0, 400);
  const name = String(title || 'Librea app').replace(/[<>&]/g, '').slice(0, 100);
  return { html: t.build(name, ask), template: t.name };
}

export const TEMPLATE_NAMES = MATCHERS.map((m) => m.name).concat('generic');
