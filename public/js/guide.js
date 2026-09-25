// "Get started" panel for every view: the layout, what exists, how to navigate.
// Dismissed per page (remembered in this browser); a small link brings it back.
import { h, state } from '/app.js';
import { t, edition } from '/js/edition.js';

const KEY = 'librea-guides-hidden';
const hidden = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const setHidden = (page, v) => { try { const o = hidden(); o[page] = v; localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* fine */ } };

/**
 * Per-page guide text, by role. Each page has a default and may override any
 * of layout / exists / navigate for admin, staff, student, family. Strings run
 * through t(), so an edition's vocabulary applies.
 */
const GUIDES = {
  home: {
    layout: 'Headline numbers up top, then outcomes and the 15-signal radar for the whole district, the schools, and the sovereignty panel at the bottom.',
    exists: 'Everything is computed on this machine from the records in your own folder. Numbers are live; nothing is cached elsewhere.',
    navigate: 'Use the menu for People, Data, Build, Apps. Click a school card to see its students.',
    admin: { navigate: 'Use the menu for People, Compliance, Data, Import, Build, Apps, Accounts. Set up walks you through a district from scratch. The sovereignty panel verifies the ledger and exports everything.' },
    staff: { navigate: 'Use the menu for People, Compliance, Data, Build, Apps. Click a school card to see its students. Your account may be limited to your own caseload; if so, People shows only those students.' },
    student: { layout: 'Your card at the top, then district-wide totals with no names.', exists: 'Your own record, and totals for every school. Nobody else\'s record is visible to you here.', navigate: 'Open my record is your page. Data lets you query your own rows. Build and Apps let you make and use pages about your own work.' },
    family: { layout: 'Your children at the top, a card of records the school still needs from you, then district-wide totals with no names.', exists: 'Your own children and what is on file for them. The totals below are for every school and show no names.', navigate: 'Click a child to open their record. Your records shows anything missing (an emergency card, an immunization) and how to provide it.' },
  },
  people: {
    layout: 'A filter bar (school, grade, outcome, flag), a plain-language search box, and a table of students. A Families tab lists households.',
    exists: 'Every student record you are allowed to see, with its outcome label and flags. Search reads what people wrote about a student, not just the numbers: try "kids who love building things".',
    navigate: 'Click a row to open the student. Filters and search combine. Families tab, then a family, to see its linked students.',
    admin: { exists: 'Every student in the district, with outcome labels and flags. Search reads what people wrote, not just numbers. Families tab lists every household and who is linked.' },
    staff: { exists: 'The students you may see: everyone, or only your caseload if your account is scoped that way. Search reads what people wrote about a student.' },
  },
  mine: {
    layout: 'One card per child linked to your account.',
    exists: 'Only your own children appear here. Nothing about any other student is visible to you.',
    navigate: 'Click a child to open their record. Add a note or a photo from their page.',
  },
  person: {
    layout: 'Header with name and school, then flags phrased as questions, the radar of 15 signals, the metrics table, similar students, the timeline, and the record: fragments, attendance, incidents, plans, services, documents.',
    exists: 'The structured record from imports plus the voice: what staff observed, what the student wrote, what the family added. Each fragment shows who can see it.',
    navigate: 'Add a fragment at the bottom. Switch similar-students tabs between the signal space and what people wrote. Records tab shows the rows behind the numbers.',
    admin: { navigate: 'Add an observation or a staff-only note at the bottom. Add buttons in Records write immunizations, documents, plans and enrollment events. Edit the structured record from the metrics table.' },
    staff: { navigate: 'Add an observation (shared with the family) or a staff-only note. Records shows attendance, incidents, services and plans; Add buttons write new rows.' },
    family: { layout: 'Your child\'s page: their school record, the flags as questions for you and the teacher, the radar, and the fragments you and the school have written.', exists: 'Everything the school shares with families about your child, plus what you add. Staff-only notes are not shown here.', navigate: 'Add a family note or a photo at the bottom. Choose whether the school can see it or only your family.' },
  },
  me: {
    layout: 'Your own page: what the school records about you and what you add yourself.',
    exists: 'Your metrics, your flags as questions, and every fragment you can see. Private fragments are yours alone.',
    navigate: 'Write a fragment or add a photo at the bottom. Choose who can see it: only you, your family, or the school.',
  },
  family: {
    layout: 'Members of the household on the left, linked students on the right.',
    exists: 'The family record and the students it is responsible for.',
    navigate: 'Click a student to open their record.',
    admin: { navigate: 'Link a student with the search box. Click a student to open their record. Create an invite to give this family its own sign-in.' },
    staff: { navigate: 'Link a student with the search box. Click a student to open their record. Create an invite to give this family its own sign-in.' },
    family: { exists: 'Your household and your children. Contact details here are what the school has on file for you.', navigate: 'Click a child to open their record. Tell the school if a member or a phone number is out of date.' },
  },
  onboard: {
    layout: 'A step-by-step wizard: the organization, people, families, records on file, and sharing access. Steps are listed on the left.',
    exists: 'Whatever you have entered so far; every step can be revisited. Nothing is lost between visits.',
    navigate: 'Work top to bottom. Each step saves as you go. Import a vendor export where offered, or add people by hand. Finish by minting invites.',
  },
  compliance: {
    layout: 'Summary tiles (required and recommended), then every check grouped by pack and by who it is about, then the report downloads.',
    exists: 'Live checks over the records on file: immunizations, emergency cards, background checks, drills, plan reviews and more. Each names why it matters and exactly who is missing what.',
    navigate: 'Click a check to see the failing list. Fix opens the right form pre-filled. Reports download as CSV for an auditor or the county.',
    staff: { navigate: 'Click a check to see who is missing what. Fix opens the right form pre-filled for that student. Reports are admin-only downloads.' },
  },
  data: {
    layout: 'The table list on the left with columns and plain-English descriptions; the query editor and results on the right.',
    exists: 'Every table in the relational projection: students, staff, schools, attendance, results, incidents, services, plans, documents. Only rows your scope allows.',
    navigate: 'Click a table for a starter query, click a column to insert it, run with Ctrl or Cmd + Enter. Example chips on the right. Copy as CSV under the results.',
    admin: { exists: 'Every table, every row, names included. The status card shows the projection is in sync with the ledger; Rebuild and Recompute are here too.' },
    student: { exists: 'The same tables the school uses, but every query returns only your own rows and no names. Try SELECT * FROM attendance to see your own attendance.', navigate: 'Click a table for a starter query and run it with Ctrl or Cmd + Enter. Anything outside your record simply comes back empty.' },
    family: { exists: 'The same tables the school uses, but every query returns only your children\'s rows. Try SELECT * FROM attendance.', navigate: 'Click a table for a starter query and run it with Ctrl or Cmd + Enter. Rows about other students never appear.' },
  },
  import: {
    layout: 'Choose a file or paste CSV, then a preview with the detected vendor and column mapping, then apply with a job progress bar.',
    exists: 'Presets for PowerSchool, Aeries, Infinite Campus and OneRoster, plus a generic mapper. Sample files to try before using your own export.',
    navigate: 'Load a sample or your file, check the mapping table (fix any select), run a dry run, then apply. Attendance, grades and discipline files become rows you can query.',
  },
  build: {
    layout: 'A prompt box with example chips, the provider line saying what leaves this machine, a live code area, and a preview of the app once it is written.',
    exists: 'Every app you built, each with its own web address. The model sees only the shape of the data, never a record.',
    navigate: 'Describe the dashboard, page or assignment you want and press Generate. Publish to share the address. Remix to change an existing app.',
    admin: { exists: 'Apps built by anyone, each with its own address. Include names is available to you; the scope badge on each app says what it can see.' },
    staff: { exists: 'Apps you built, each with its own address, reading only what you are allowed to see. Turn on Include names when a roster needs them.' },
    student: { exists: 'Pages about your own work: a portfolio, a reflection page, a project site. Apps you build see only your own record and district totals.', navigate: 'Describe the page you want and press Generate. Publish gives it an address you can share with a teacher or a family member.' },
    family: { exists: 'Pages about your children: a weekly update, a portfolio. Apps you build see only your children\'s records and district totals.', navigate: 'Describe the page you want and press Generate. Publish to get an address.' },
  },
  apps: {
    layout: 'A gallery of apps: title, who built it, what it is allowed to see, published or draft.',
    exists: 'Starter apps installed with this edition plus everything built on the Build page.',
    navigate: 'Open runs the app in its own page. Remix sends it back to Build with its prompt.',
    admin: { navigate: 'Open runs the app. Remix sends it back to Build. You can unpublish or delete any app.' },
    staff: { navigate: 'Open runs the app. Remix sends it back to Build. You can unpublish or delete your own apps.' },
    student: { exists: 'Published apps you can use, and your own drafts. An app only ever shows you your own record.' },
    family: { exists: 'Published apps you can use, and your own drafts. An app only ever shows you your children\'s records.' },
  },
  accounts: {
    layout: 'The account list, the create or edit form, and the open invites.',
    exists: 'Every sign-in: admins, staff, students, families. Staff can be limited to their own caseload. Invites let people create their own account with a code.',
    navigate: 'Create links an account to a record; edit changes role, links or password; deactivate keeps the history but blocks sign-in. Mint invites instead of setting passwords for people.',
  },
  join: {
    layout: 'One form: your invite code, a username, a password.',
    exists: 'Your invite tells the system who you are and which records you may see. Nothing else is set up in advance.',
    navigate: 'Enter the code you were given, pick a username and password, and you are signed in.',
  },
};

const ROLE_LABEL = { admin: 'district admin', staff: 'staff', student: 'student', family: 'family' };

/** Resolve the guide for a page and role: defaults with role overrides. */
function guideFor(page, role) {
  const g = GUIDES[page];
  if (!g) return null;
  const o = (role && g[role]) || {};
  return { layout: o.layout || g.layout, exists: o.exists || g.exists, navigate: o.navigate || g.navigate };
}

/** Build the panel for the current page, or null if the page has no guide. */
export function guideCard() {
  const page = state.route;
  const role = state.user?.role;
  const g = guideFor(page, role);
  if (!g) return null;
  const off = !!hidden()[page];
  const ed = edition();
  const wrap = h('div.guide' + (off ? '.off' : ''), { 'data-page': page });
  const draw = () => {
    wrap.innerHTML = '';
    if (hidden()[page]) {
      wrap.className = 'guide off';
      wrap.appendChild(h('button.linkish.guide-toggle', { onclick: () => { setHidden(page, false); draw(); } }, 'Get started on this page'));
      return;
    }
    wrap.className = 'guide card';
    wrap.append(...[
      h('div.guide-head', h('span', h('span.chip', 'Get started'), role ? h('span.small.muted', { style: 'margin-left:8px' }, t(`as a ${ROLE_LABEL[role] || role}`)) : null), h('button.linkish', { onclick: () => { setHidden(page, true); draw(); } }, 'Got it, hide this')),
      h('div.guide-grid',
        h('div', h('b', t('The layout')), h('p', t(g.layout))),
        h('div', h('b', t("What's here")), h('p', t(g.exists))),
        h('div', h('b', t('How to get around')), h('p', t(g.navigate))),
      ),
      page === 'home' && ed.id !== 'district' ? h('p.small.muted', { style: 'margin:6px 0 0' }, `${ed.name}: ${ed.tagline}`) : null,
    ].filter(Boolean)); // Element.append(null) would print the word "null"
  };
  draw();
  return wrap;
}
