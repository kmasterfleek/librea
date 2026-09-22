# Librea Micro

For microschools, learning pods, homeschool co-ops, forest schools, and
parent-run community schools. Five learners or sixty. Mixed ages. A few guides
instead of a staff hierarchy. Families who are co-owners, not customers. No IT
department, and usually nothing to import from because you started this
yourselves.

Librea Micro is the same Librea as every other edition — the same ledger, the
same local vectors, the same SQLite projection — wearing your words. It says
learners and guides and pod and community, because that is what you say. It
starts from an empty room rather than a vendor export.

It runs on one computer you own. Not a cloud you rent, not an account you can be
locked out of. Nothing about a child leaves the building unless you carry it out
yourself.

## The 60-minute path

You need one semi-technical person, a laptop, and [Node 20 or
newer](https://nodejs.org). All of this happens on that laptop.

**Minutes 0–10 — see it working.** Look at a pretend pod before you type a
single real name.

```bash
npm install
LIBREA_EDITION=micro node editions/micro/seed.js
LIBREA_EDITION=micro npm start
```

Open http://127.0.0.1:3000 and log in as `admin` / `librea-admin`. You are
looking at Willow Creek Learning Community: 22 invented learners, 15 invented
families, five guides, a month of attendance, and a compliance checklist that is
deliberately not all green. Click into a learner. Open the attendance register.
Find the immunization gap. Get a feel for where things live.

Other demo logins: `theo` / `librea-guide`, `nneka` / `librea-learner`,
`okonkwo.family` / `librea-family`. The seed prints them, along with three open
invite codes, every time it runs.

**Minutes 10–15 — clear the pretend pod out.** Nothing from Willow Creek should
survive into your real records.

```bash
rm -rf data
LIBREA_EDITION=micro npm start
```

The first screen asks you to make the real admin account. Use a real password;
this is the key to every record you are about to create.

**Minutes 15–45 — put your pod in.** Onboarding walks you through it in the
order a pod actually thinks:

1. **Your community** — the pod's name, where it meets.
2. **Learners** — a name and a birthday is enough to start. The age band is
   worked out from the birthday; you can override it.
3. **Families** — a family holds one or more learners, so siblings are entered
   once. Add each guardian's name, phone, and the language they'd rather read.
4. **Guides** — the adults, and the dates on their background checks, CPR cards,
   and mandated-reporter training.
5. **Records on file** — tick off which paperwork you actually hold for each
   learner. Missing is a legitimate answer; the point is knowing.
6. **Drills** — when you last practiced fire, earthquake, lockdown.
7. **Share** — invite codes for families and guides.

Twenty-two learners takes about twenty minutes of typing. Two people at two
laptops halves it.

**Minutes 45–60 — send the invites, take the register.** Give every family their
code. Take attendance once. You now have a pod that can answer questions about
itself.

If you do have an export from something else, the importer is still there under
Import — but it is not the first path in this edition, because most pods have
nothing to import.

## What "more than legit" means here

Legit is not a certificate. It is being able to answer the ordinary questions on
an ordinary Tuesday, without a scramble. Librea Micro keeps a checklist of them:

- **Who was here?** An attendance register per learner per day, printable.
- **Who may collect this child?** Emergency contacts and custody or release
  authorizations, on file and current.
- **Has this child had their shots, or a signed exemption?** Immunization
  records, with exemptions recorded as exemptions rather than as blanks.
- **Did anyone check the adults?** Background check, fingerprinting, CPR, and
  mandated-reporter training per guide, with expiry dates that warn you before
  they lapse.
- **Can you get everyone out?** Fire, earthquake, and lockdown drills, with the
  date, who led it, and how long it took.
- **What is each learner working toward?** An individual learning plan with
  goals and a review date, so reviews get scheduled instead of forgotten.
- **Are you registered to do this?** In California a private school files an
  annual affidavit; other states want other things, or nothing. Librea holds the
  document and its expiry date whatever it is called where you are.
- **Enrollment paperwork, consents, residency** — held per learner, with status
  `on-file`, `missing`, `expired`, or `waived`.

Two honest caveats. **Requirements vary enormously by state**, and some states
ask a microschool for almost nothing while others treat it as a private school
with real filings. **This is a tool for keeping your own house in order, not
legal advice.** Find out what your state asks, then use this to stay on top of
it. A green checklist here means your records are complete, not that a regulator
agrees with you.

## How invites work

Nobody is asked to create an account out of thin air.

An admin or a guide makes an invite code (Share, or the Invites page). A code
carries a role — family, guide, learner — and can be tied in advance to the
records it should see, so an Okonkwo code arrives already attached to Nneka and
Obi. You send the code however you already talk to people: email, a printed
slip, a message in the group thread. The edition ships wording for both a family
invite and a guide invite, which you can edit.

The person goes to your address, enters the code, and picks their own username
and password. Codes expire (30 days by default), are single-use, and can be
revoked before they're used.

What each role sees is decided by the role, not by the invite: a family sees
their own children's records in full and nothing about anyone else's child; a
guide sees the pod; a learner sees themselves, including a private journal that
no adult can read.

## Your data, and how to leave with it

Everything lives in `data/`, next to the code:

- `ledger.jsonl` — every change ever made, hash-chained. This is the truth.
- `vectors.db` — the local semantic index. Rebuildable from the ledger.
- `librea.sqlite` — the relational projection you can query with SQL.
- `snapshot.json` — a cache so startup is fast. Also rebuildable.
- `apps/` — the HTML of every app anyone in the pod has made.
- `documents/` — the paperwork you uploaded.

Copy that folder and you have copied the school. Back it up the way you back up
anything else that matters — a nightly copy to an external drive is enough for a
pod this size. Restore by putting the folder back.

To take an export in a form other software will read, use Export: CSV per table,
or the whole thing as JSON, or just open `librea.sqlite` in any SQLite browser.
There is no export fee, no locked field, no "contact sales." It is yours in the
plain sense: it is on your disk.

The one moment data can leave is if you connect a hosted model to the app
builder. Librea ships with offline templates so you never have to, and it tells
you on screen when a provider is involved.

## The four starter apps

The seed installs these; they also work on an empty pod, degrading to an honest
empty state.

| App | What it's for |
| --- | --- |
| **Weekly family update** | One learner's week: days here, anything new written, where the plan goals stand. |
| **Learner portfolio** | The work and the voices as a timeline, plus the shape of what's been recorded. |
| **Co-op roster and groups** | Who's in the pod, in real groups if you've made them, in age bands if you haven't. |
| **Attendance register** | The printable monthly grid. This is the page for when someone official asks. |

They are ordinary HTML in `editions/micro/apps/`. Open one, change it, keep it.
Or describe a new one in your own words on the Apps page and let the builder
write it.
