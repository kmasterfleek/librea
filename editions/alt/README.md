# Librea Alt

For alternative schools: continuation and credit-recovery programs, independent
study, charters, therapeutic and day-treatment schools, court and community
schools, and indigenous or culturally-rooted schools. Typically 60 to 400
students, grades 6-12 and mostly 9-12, students arriving and leaving all year,
heavy IEP / 504 / behavior-support work, and two numbers that matter every
single day: **credits toward a diploma** and **attendance**.

This edition is the same Librea as every other edition. It changes the words
(teachers are **advisors**, the principal is the **director**, classes are
**sections**), the starting screens, the compliance checks, and the four apps
you get on day one. Your data and your ledger are identical in shape to any
other Librea install, so nothing here locks you in.

There are two people this file is written for: the director, who needs to know
what this does and what it will show an authorizer, and the one technical
person — staff or contractor — who will actually run it.

---

## What you get

- A record of every student that is **yours**: one folder on one machine, a
  hash-chained ledger as the source of truth, a SQLite copy for reporting.
- **Credits** as a first-class number. Courses carry credits, sections carry a
  credit line item, and a student's total is a single SQL sum — not a
  spreadsheet somebody maintains by hand.
- **Attendance** recorded per student per day, with days-enrolled counted from
  the day the student actually enrolled. Mid-year enrollment does not distort
  the rate.
- **Plans** — IEP, 504, behavior support, transition, credit recovery — each
  with a review date, so an overdue annual is visible before it is a finding.
- **Enrollment history**: enrolled, withdrawn, transferred, re-enrolled, with a
  reason. Mobility is the normal case here, and the record is built for it.
- Four starter apps, and an app builder for the fifth one you think of at 9pm.

## From download to running with your own data

You need Node 20 or newer. Nothing else, and no internet connection after the
first `npm install`.

```bash
git clone <your copy of librea> && cd librea
npm install

# Look around first, with the demo school (140 synthetic students, no real people):
LIBREA_EDITION=alt LIBREA_DATA=./data-demo node editions/alt/seed.js
LIBREA_EDITION=alt LIBREA_DATA=./data-demo PORT=4407 npm start
# http://127.0.0.1:4407 — sign in as admin / librea-admin
```

When you are ready to run it for real, start with an empty data folder:

```bash
LIBREA_EDITION=alt LIBREA_DATA=./data PORT=4407 npm start
```

The first screen walks the six steps this edition sets up: your school, your
students, advisors and caseloads, plans on file, credits and courses, and
sharing the record.

### Bringing in your vendor export

Most alternative schools have an export from something — PowerSchool, Aeries,
Infinite Campus, or plain OneRoster CSVs — and also enroll students by hand in
the middle of a Tuesday. This edition expects both.

1. Ask your district or your outgoing vendor for a **OneRoster CSV export** if
   they will give you one: `orgs`, `users`, `courses`, `classes`, `enrollments`,
   `academicSessions`, `lineItems`, `results`. That is the cleanest path.
2. If you get a PowerSchool or Aeries report instead, that is fine. The importer
   guesses the column mapping and shows you its guesses before anything is
   written. Fix the wrong ones and apply.
3. **Transcripts and prior credits matter more here than anywhere else.** A
   student who transferred in with 85 credits is not a new student. Import the
   historical results, or enter them as line items on a prior-term section,
   before you tell anyone their credit total.
4. Then add the students who walked in this week by hand. Onboarding → add a
   student takes about thirty seconds each and writes the same enrollment event
   an import would.

Everything an import writes goes through the same ledger as everything you type.
If a number looks wrong, the row that produced it is still there.

## What the compliance pack checks

This edition runs the `core` and `alt` compliance packs. In plain words, they
look for the things an authorizer, a county office, or a state review asks about
in a school like yours:

- **Enrollment and withdrawal.** Does every student have an enrollment event with
  a date and a reason? Is anyone marked active who stopped attending months ago?
- **Attendance and apportionment.** Days enrolled and days present per student
  per month, with the school-wide rate, and the students whose attendance is low
  enough that a truancy or SART process should already have started.
- **Credits toward graduation.** Credits earned per student, distance from the
  diploma, and who is far enough behind pace that a recovery plan should exist
  and does not.
- **Plans on file.** Every active IEP, 504, behavior support and transition plan,
  and its review date. Overdue reviews are called out first. Seniors with an IEP
  and no transition plan are called out by name.
- **Required paperwork.** Enrollment forms, emergency cards, residency,
  transcript requests, work permits — on file, missing, or expired.
- **Staff clearances.** Background checks, mandated-reporter training, CPR, and
  credentials, with expiry dates.
- **Safety drills.** What was run, when, how long, who led it.

Each check produces a list you can read, hand over, or print. The numbers come
from your own rows, and where a record is missing the report says *missing*
rather than quietly excluding it — that is the difference between a report you
can defend and a dashboard you cannot.

**Requirements vary by state, by authorizer, and by program type.** An
independent-study attendance claim in California and a seat-time claim in Ohio
are not the same thing. Use these checks as a working checklist against your own
rules. **This is not legal advice**, and Librea does not file anything for you.

## Caseload scoping (advisors seeing their own students)

Alternative schools run on caseloads. An advisor should open Librea and see the
twenty-two students who are theirs.

Librea does this. Turn on the `caseload` flag for a staff account and that
account stops seeing the whole school:

```
PUT /api/users/advisor   { "caseload": true }
```

A caseloaded advisor sees a student when any one of three things is true: the
student is enrolled in one of their current sections, the advisor is named as
`owner` on one of the student's active plans, or the student's
`advisorSourcedId` points at them. Prior-year sections do not count, so a
caseload is this year's work and not everyone you have ever taught. Admin
accounts are never scoped.

Decide per account, not per role. In the demo school the `advisor` account is
caseloaded and sees 75 of the 140 students; the case manager and the director
are not, because those two jobs genuinely need the whole school. At a school
this size an advisor who teaches two sections that most of the school rotates
through will legitimately see half of it — the scope is doing its job, the
building is just small.

Student and guardian accounts are scoped tightly either way: a guardian sees
their own student and nothing else.

## Your data stays yours

- Everything lives in the data folder you pointed `LIBREA_DATA` at: the ledger,
  the vectors, the SQLite file, the apps. Back up that folder and you have
  backed up the school.
- The server binds to `127.0.0.1` unless you tell it otherwise. Nothing phones
  home. There is no account to create, no licence to renew, and no vendor who
  can raise the price or shut the service off.
- The app builder works offline from templates. If you connect a model provider,
  Librea tells you exactly what would leave the building before it sends
  anything — and you can decline and keep using the templates.
- Apps run in a sandboxed frame with no network access at all. They read data
  through a broker that enforces the viewer's scope, so an app cannot show a
  student something about another student.
- Export is a first-class operation, not a favour. You can take your data out in
  OneRoster CSV form at any time, including to a competitor.

## The demo school

`editions/alt/seed.js` builds **Eastside Continuation & Independent Study**: 140
synthetic students in grades 8-12, 12 staff, courses and credits going back
three years, 30 school days of attendance, plans (some overdue), behavior
incidents, mid-year enrollments, transfers, withdrawals, one student who came
back. Names and records are invented; no real person is in there.

```bash
LIBREA_DATA=/tmp/alt LIBREA_EDITION=alt node editions/alt/seed.js
```

It is deterministic — same anchor date, same school every time. Set
`LIBREA_SEED_TODAY=2026-09-22` to pin the dates. Pass `--keep` to add it to an
existing folder instead of wiping.

The four starter apps it installs are in `editions/alt/apps/`: **Credit
tracker**, **ADA attendance report**, **Plan review calendar**, and
**Re-engagement list**. They are single HTML files with no dependencies. Read
them, copy them, break them — that is what they are for.
