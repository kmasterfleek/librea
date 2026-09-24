// "Get started" panel for every view: the layout, what exists, how to navigate.
// Dismissed per page (remembered in this browser); a small link brings it back.
import { h, state } from '/app.js';
import { t, edition } from '/js/edition.js';

const KEY = 'librea-guides-hidden';
const hidden = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const setHidden = (page, v) => { try { const o = hidden(); o[page] = v; localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* fine */ } };

/** Per-page guide text. Each entry: layout, exists, navigate (strings; run through t()). */
const GUIDES = {
  home: {
    layout: 'Headline numbers up top, then outcomes and the 15-signal radar for the whole district, the schools, and the sovereignty panel at the bottom.',
    exists: 'Everything is computed on this machine from the records in your own folder. Numbers are live; nothing is cached elsewhere.',
    navigate: 'Use the menu for People, Data, Build, Apps. Click a school card to see its students. Admins see a Set up card until the district has records.',
  },
  people: {
    layout: 'A filter bar (school, grade, outcome, flag), a plain-language search box, and a table of students. A Families tab lists households.',
    exists: 'Every student record, with its outcome label and flags. Search reads what people wrote about a student, not just the numbers: try "kids who love building things".',
    navigate: 'Click a row to open the student. Filters and search combine. Families tab, then a family, to see its linked students.',
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
  },
  me: {
    layout: 'Your own page: what the school records about you and what you add yourself.',
    exists: 'Your metrics, your flags as questions, and every fragment you can see. Private fragments are yours alone.',
    navigate: 'Write a fragment or add a photo at the bottom. Choose who can see it: only you, your family, or the school.',
  },
  family: {
    layout: 'Members of the household on the left, linked students on the right.',
    exists: 'The family record and the students it is responsible for. Invites for this family are minted from here.',
    navigate: 'Link a student with the search box. Click a student to open their record. Create an invite to give this family its own sign-in.',
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
  },
  data: {
    layout: 'The table list on the left with columns and plain-English descriptions; the query editor and results on the right.',
    exists: 'Every table in the relational projection: students, staff, schools, attendance, results, incidents, services, plans, documents. Only rows your scope allows.',
    navigate: 'Click a table for a starter query, click a column to insert it, run with Ctrl or Cmd + Enter. Example chips on the right. Copy as CSV under the results.',
  },
  import: {
    layout: 'Choose a file or paste CSV, then a preview with the detected vendor and column mapping, then apply with a job progress bar.',
    exists: 'Presets for PowerSchool, Aeries, Infinite Campus and OneRoster, plus a generic mapper. Sample files to try before using your own export.',
    navigate: 'Load a sample or your file, check the mapping table (fix any select), run a dry run, then apply. Attendance, grades and discipline files become rows you can query.',
  },
  build: {
    layout: 'A prompt box with example chips, the provider line saying what leaves this machine, a live code area, and a preview of the app once it is written.',
    exists: 'Every app you or others built, each with its own web address. The model sees only the shape of the data, never a record.',
    navigate: 'Describe the dashboard, page or assignment you want and press Generate. Publish to share the address. Remix to change an existing app.',
  },
  apps: {
    layout: 'A gallery of apps: title, who built it, what it is allowed to see, published or draft.',
    exists: 'Starter apps installed with this edition plus everything built on the Build page.',
    navigate: 'Open runs the app in its own page. Remix sends it back to Build with its prompt. Owners and admins can unpublish or delete.',
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

/** Build the panel for the current page, or null if the page has no guide. */
export function guideCard() {
  const page = state.route;
  const g = GUIDES[page];
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
    wrap.append(
      h('div.guide-head', h('span.chip', 'Get started'), h('button.linkish', { onclick: () => { setHidden(page, true); draw(); } }, 'Got it, hide this')),
      h('div.guide-grid',
        h('div', h('b', t('The layout')), h('p', t(g.layout))),
        h('div', h('b', t("What's here")), h('p', t(g.exists))),
        h('div', h('b', t('How to get around')), h('p', t(g.navigate))),
      ),
      page === 'home' && ed.id !== 'district' ? h('p.small.muted', { style: 'margin:6px 0 0' }, `${ed.name}: ${ed.tagline}`) : null,
    );
  };
  draw();
  return wrap;
}
