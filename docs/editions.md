# Editions

One codebase, several flavours. An edition changes what Librea is called, what it calls the people in it, which features are on, which compliance packs apply, how onboarding runs, and what the home page says — without a fork and without a single string hard-coded in `src/`.

## The mechanism

`src/core/edition.js`, 64 lines.

- **Selection.** `LIBREA_EDITION` (lowercased, stripped to `[a-z0-9-]`). Default `district`.
- **Loading.** `loadEdition(id)` reads `editions/<id>/edition.json` and merges it over `BASE_EDITION`. Top-level keys replace; `vocabulary`, `features`, `compliance`, `onboarding`, `theme` and `copy` are merged key by key, so an edition overrides only what it names. A missing folder falls back to the base with no error. The result is cached per id and carries a `dir` pointing at the edition folder.
- **Listing.** `listEditions()` returns `district` plus every folder under `editions/` that has an `edition.json`, each with `id`, `name`, `tagline` and `audience`.
- **Vocabulary substitution.** `t(text)` replaces each vocabulary key and its trailing-`s` plural with the edition's word, preserving a leading capital. Keys that map to themselves are skipped.

Served to the browser by `GET /api/edition` (the merged edition) and `GET /api/editions` (the list plus the active id), both in `src/api/routes-onboard.js`. `public/js/edition.js` applies the theme and exposes `t()` to every page, which is why renaming one word renames the whole application.

`src/server.js` passes the loaded edition to every optional feature module, so import, vibe and compliance can all read it.

## `BASE_EDITION`

The district edition, defined inline in `src/core/edition.js`:

```js
{
  id: 'district',
  name: 'Librea',
  tagline: 'The student information system you own.',
  audience: 'Public school districts',
  vocabulary: { district, school, student, family, staff, teacher, class, grade, principal },  // each maps to itself
  roles: ['admin', 'staff', 'student', 'family'],
  features: { import: true, vibe: true, sql: true, compliance: true, onboarding: true, timeline: true, invites: true },
  compliance: { packs: ['core'] },
  onboarding: { mode: 'import-or-manual', steps: ['organization', 'people', 'families', 'compliance', 'apps'] },
  theme: { accent: '#3d6b8e', accent2: '#c97b4a', logoText: 'Librea' },
  seed: 'data/seed/district.json',
  templates: null,
  copy: {},
}
```

These are the top-level keys an edition may set. Within the merged objects an edition may add its own sub-keys — Alt adds `onboarding.labels` and `onboarding.hints` — because those objects merge key by key and a page simply reads what it finds. But if a school needs a new *top-level* key, add it to `BASE_EDITION` with a sensible default first, so every other edition keeps working.

## The two editions that ship

### Librea Micro (`editions/micro/`)

For microschools, learning pods, homeschool co-ops, forest schools and parent-run community schools of 5–60 learners.

- **Vocabulary:** district→community, school→pod, student→learner, staff→guides, teacher→guide, class→group, grade→age band, principal→lead guide.
- **Onboarding:** `manual-first`, with steps `community → learners → families → guides → records → drills → share`. There is no vendor export to import, so the flow assumes forty minutes of typing.
- **Compliance packs:** `core` + `micro`.
- **Theme:** terracotta `#a8622f` and sage `#6d8f6a`.
- **Copy:** the fullest example in the repository — home headline and subhead, an onboarding intro that says you do not need an IT department, a sovereignty line written for parents rather than for administrators, a compliance intro that defines "more than legit" as answering the ordinary questions on the ordinary day, and two complete invite emails (family and guide) with `{pod}` / `{learner}` / `{url}` / `{code}` / `{inviter}` placeholders.

`editions/micro/` also carries `seed.js`, `apps/` and its own `README.md`.

```bash
LIBREA_EDITION=micro node editions/micro/seed.js
LIBREA_EDITION=micro npm start
```

### Librea Alt (`editions/alt/`)

For charters, continuation and credit-recovery programs, independent study, therapeutic and day-treatment schools, court and community schools, and culturally-rooted schools. Tagline: *"Credits, attendance, and the students who came back."*

- **Vocabulary:** mostly the district's words, with teacher→advisor, class→section, principal→director. Alternative schools use the state's vocabulary because they report to the state; what changes is what the school pays attention to.
- **Onboarding:** `import-or-manual`, with steps `school → students → advisors → plans → credits → share`, each carrying a `label` and a `hint` — extra `onboarding` sub-keys that merge cleanly because `onboarding` is merged key by key. Mid-year enrollment is treated as the normal case.
- **Compliance packs:** `core` + `alt` — plans and their review dates, credits, enrollment events.
- **Theme:** deep green `#2f5d50` and rust `#b5652f`.

```bash
LIBREA_EDITION=alt node editions/alt/seed.js
LIBREA_EDITION=alt npm start
```

`editions/alt/` also carries `seed-data.js`, `seed-apps.js`, `apps/` and its own `README.md`.

## Making your own

1. `mkdir -p editions/<id>` — lowercase letters, digits and hyphens only.
2. Write `editions/<id>/edition.json` with the subset of keys you want to change. `editions/micro/edition.json` is the worked example.
3. Optionally add `editions/<id>/seed.js` (demo data in this edition's shape, respecting `LIBREA_DATA`) and `editions/<id>/apps/` (app templates).
4. `LIBREA_EDITION=<id> npm start`, then read the home page, the people list, an empty state and an invite. Any word still saying "district" is a page that did not call `t()`.
5. `npm test` — `tests/onboard.test.js` covers loading, fallback and case-preserving substitution.

Vocabulary caveats worth knowing before you choose words: substitution is textual and matches whole words plus a trailing `s`, so irregular plurals (`child` → `children`) come out wrong, and a word that also appears in an id, a URL or a SQL column should not be renamed in copy that is used to build one. The `librea-brand` skill walks through the rest.
