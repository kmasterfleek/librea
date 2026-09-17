# Librea

**A student information system that stays in the building.**

This page is written for the person who has to say yes or no: a principal, a
superintendent, a district technology director, a board member. It assumes you
have been sold software before, that some of it did not do what the deck said,
and that you would rather read what a thing actually does than what it hopes
to do. Everything below is checkable against the code in this repository, and
the last section tells you how.

---

## The claim, in one paragraph

Librea runs on one computer your district owns. Student records go in, stay
on that computer, and are read by the people your district says may read
them. Staff, students, and families can build their own pages, dashboards,
and reports by describing them in plain language. When an outside AI model is
involved in that, it is shown the description and a fixed list of layout
parts. It is never shown a student, a name, an ID, a grade, or even the names
of the tables and fields your data lives in. If you unplug the network cable,
everything keeps working.

## What a skeptic should ask, and what the answer is

**Where is the data?**
In a folder on the machine you install it on. The record of what happened
is an append-only ledger file. A local SQLite database is built from it for
fast queries. There is no cloud account, no vendor database, no sync. If you
copy the folder, you have copied the district.

**Who can see what?**
Four roles: admin, staff, student, family. A student sees their own record.
A family sees their children. Staff and admins see the school. This is
enforced on the server, per request, before any page or app gets a row. The
same rule is enforced twice for the SQL layer: the database itself only
exposes filtered views to a query, so a query cannot widen its own access no
matter how it is written.

**What does an AI model see?**
Two different things, depending on which path you use.

- *Build* (the original path) sends your description, the field names, and
  one made-up example student named Avery Example. No real record ever leaves.
- *Design* (new, described below) sends your description, the page name, and
  the fixed vocabulary of six layout parts. Not the field names. Not the
  table names. Not an example row. The model designs a page without knowing
  what your data looks like.

Both paths can also run with no outside model at all, using layouts built
into the software. Then nothing leaves.

**Can I see exactly what left?**
Yes. The Build and Design pages state, on screen, what will be sent and what
will never be sent, before you click anything. The wording comes from the
code, not from marketing copy, so it changes if the code changes.

**Can a page built by a teacher leak data?**
A generated page runs inside a locked frame. It cannot make network requests
of any kind: no fetch, no external script, no font, no image from the
internet. Its only way to reach data is through a broker on the same server,
which applies the viewer's permissions to every call. The page can ask; it
cannot take.

**What about small groups?**
Charts for students and families are aggregates only. Any group smaller than
five students is withheld and the page is told how many were withheld. A
chart cannot be used to read one child out of a bar.

**Is there an audit trail?**
Every write is an event in a hash-chained ledger. Each entry carries the hash
of the one before it. Editing history after the fact breaks the chain, and
the software detects that. Every app, every version, every change to what an
app may see is in the same ledger. Every mistake an app makes talking to the
broker is logged with the argument *names*, never the values.

**What happens when you go away?**
The software is plain files: JavaScript, HTML, CSS, one SQLite database, one
ledger file. There is no build step and no proprietary format. A district
technician with no relationship to us can read it, run it, and export from
it. There is an export endpoint for that purpose.

**What does it need?**
One computer with Node 20 or newer. Optionally, the first time it runs with a
network, it downloads one small open-source text-embedding model (about 23
megabytes) that powers "find students who wrote about building things." After
that download it runs offline. No API key is required for anything.

## The Design → Data flow

This is the newest part and the one most worth understanding, because it
changes what an outside model is allowed to know.

The old way to build a page was to ask one model to do two jobs at once:
make it look right, and make it read the right data. That meant the model had
to know the data's shape. It never saw a real record, but it saw the names of
the tables and columns.

The new way splits the job in two.

**Step one, design.** You describe the page. A model (or a built-in layout, if
you prefer no model) returns a design: layout, typography, color, and a small
list of empty regions. Each region declares what *shape* of thing goes in it,
from a closed list of six: a number, a bar chart, a line, a table, a list, a
paragraph. Each region carries a one-sentence hint in plain words, like
"percent of days absent, one bar per school." The design contains no code
that runs. It is inert markup and style. It is checked for that before it is
saved, and rejected if it contains a script, a form, or a link to the
internet.

**Step two, data.** Back on your own machine, someone in the district fills
each region. The software proposes a query for the common cases from a fixed
catalog. A person can accept it, edit it, or write their own. Before anything
is saved, the query runs against the real data under the page's permissions,
and the real rows appear on screen. A query that does not fit its region is
named and refused. A page cannot be published until every region has a
source.

The model in step one never learns what you chose in step two. The queries
live in the ledger on your machine, not in the page, and not anywhere the
model can see.

Two consequences you get for free:

- A design can be reused. One "board attendance report" design, made once,
  can be filled in by every school, or by a student for their own record,
  with no outside call at all. The gallery on the Design page does this.
- Sample data shown during design review is generic placeholder text like
  "School A." It is visible only to the page's editor, only while a region is
  unfilled, and never to anyone reading a published page. The test suite
  checks this.

## What it does not do, stated plainly

- **Interactive pages in the Design flow are not here yet.** A designed page
  is a fixed report: every region is filled by a fixed query. Filters,
  drill-downs, and "click a school to see its students" are on the Build
  path, where one model writes the whole page. They are the next piece of
  work on the Design path and will need the region contract to grow.
- **A student's SQL sees only the student.** For students and families, the
  database views contain only their own rows. This is the safe default, but
  it means a student's designed page cannot show a district-wide chart
  through SQL. It can through the aggregate path, which is what the software
  proposes for those users.
- **It is not a full replacement for your SIS today.** It imports from
  OneRoster, PowerSchool, and Aeries CSV exports and holds attendance,
  grades, enrollments, discipline, services, and contacts. It does not do
  scheduling, billing, state reporting, or transcripts.
- **It is one process on one machine.** That is the point, but it also means
  your district owns backups and uptime. Copy the data folder somewhere safe
  on a schedule.
- **Outside models are only as private as their operator.** When you use
  the Design path with a cloud model, the description you typed does leave.
  Do not type a child's name into it. The software strips quoted text from
  its own logs for this reason, but it cannot stop a person from typing.

## How to check any of this yourself

You do not have to take our word for it. A district technician can verify
each claim in under an hour.

```bash
git clone https://github.com/kmasterfleek/librea
cd librea
npm install
npm run build     # imports every module; fails if any file is over 500 lines
npm test          # runs the suite
```

Then read, in this order. Each file is short.

| Claim | Where it lives |
|---|---|
| What a model is told on the Design path, and what it is not | `src/vibe/design-prompt.js` |
| The six region kinds, and the rule that a design contains no code | `src/vibe/design.js` |
| Queries are run and checked before they are saved | `src/vibe/routes-design.js` |
| The database only exposes filtered views to a query | `src/sql/query.js` |
| Groups under five are withheld for student and family apps | `src/vibe/query.js` (search for `K_ANON`) |
| A generated page cannot reach the network | `src/vibe/routes.js` (search for `CSP`) |
| The ledger is hash-chained and detects tampering | `src/core/ledger.js` |
| Error logs never contain a value, only argument names | `src/vibe/routes.js` (search for `scrub`) |

The tests in `tests/design.test.js` and `tests/vibe.test.js` exercise every
row of that table over real HTTP, including a student being refused another
student's record, a query being refused for the wrong shape, and a sample
never reaching a reader.

One honest note about the test run: eight tests need the small embedding
model mentioned above. On a machine that cannot reach the internet the first
time, those eight fail with a download error and the rest pass. Once the
model is on disk, all of them pass offline.

## Running it

```bash
npm start                  # http://127.0.0.1:4321
npm run seed               # optional: a fictional district to explore
```

Open the address in a browser, create the first admin account, and go to
*Design*. Describe a page. Fill in the regions. Publish it to your building.
Nothing left.

---

*Librea is developed in the open. The name means "free" in the sense of
sovereign: the district is the only party in the room.*
