---
name: librea-import
description: Map a school's own SIS export (PowerSchool, Aeries, Infinite Campus, OneRoster or any spreadsheet) onto Librea's importer, check the guessed column mapping, and apply it. Use when someone has a CSV of students, staff, attendance, grades or discipline and wants it in Librea, or when a preset guesses a column wrong and needs fixing.
---

# Importing a district's own export

The importer never erases: a CSV that does not carry a field leaves that field alone. A bad row is skipped with a reason rather than failing the batch. Preview before you apply, always.

## 1. Look at the file first

```bash
head -3 /path/to/export.csv
```

Note the delimiter, whether there is a BOM, and whether the header names look like a vendor's (PowerSchool uses `Student_Number`/`Grade_Level`, Aeries uses two-letter STU codes like `FN`/`LN`/`GR`/`SC`, Infinite Campus uses camelCase `studentNumber`/`personID`, OneRoster uses `sourcedId`/`givenName`).

## 2. Preview

Admin session required. Either through the UI (Import page: paste, pick a file, or "try a sample"), or:

```bash
curl -s -X POST http://127.0.0.1:4321/api/import/preview \
  -H 'content-type: application/json' -b cookies.txt \
  -d "{\"csv\": $(jq -Rs . < export.csv)}" | jq
```

The response gives `preset`, `confidence`, `kind`, `mapping`, `unmapped`, `sampleRows`, `factTables` and `warnings`. Read all of it:

- **`kind: "unknown"`** — the importer cannot tell what the file is. Pass `kind` explicitly; the valid kinds are in `CANONICAL_FIELDS` in `src/import/presets.js` (`students`, `staff`, `attendance`, `grades`, `discipline`, `orgs`, `academicSessions`, `courses`, `classes`, `enrollments`, `lineItems`, `results`).
- **`confidence < 0.3`** — the preset guess is weak. Check every mapped field against `sampleRows`.
- **`unmapped`** — columns that will be silently ignored. Decide for each whether it matters.
- **no column mapped to `id`** — nothing will import. Find the stable identifier and map it.

## 3. Correct the mapping

Pass a `mapping` object of `{ canonicalField: "Exact Header Name" }` in the body. Only headers that actually exist in the file are honoured (`sanitizeMapping` in `src/import/mapper.js`); everything else is dropped. Re-preview after correcting.

Do this in the request, not in the code, unless the same correction will be needed every time this district imports — then it belongs in a preset.

## 4. Apply

```bash
curl -s -X POST 'http://127.0.0.1:4321/api/import/apply' \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"csv": "...", "preset": "aeries", "kind": "students", "mapping": {...}, "dryRun": true}' | jq
```

Run with `"dryRun": true` first and read `created` / `updated` / `skipped` / `errors`. Then apply for real. A student import returns a `jobId`; poll `GET /api/import/jobs/:id` until `status` is `done` — that background job writes and embeds one `record` fragment per student, re-importing replaces rather than duplicates it.

Import order when you have several files: `orgs` → `students` and `staff` → `academicSessions` → `courses` → `classes` → `enrollments` → `lineItems` → `results`, then `attendance` / `discipline`. Fact imports trigger `deriveAll`, which recomputes each student's metrics from the rows themselves rather than trusting a vendor's summary column.

## 5. Teach the importer this district's export permanently

Edit `src/import/presets.js`:

1. Add an alias dictionary: `{ canonicalField: ['TheirHeader', 'TheirOtherHeader', ...] }`. Be generous; matching is case- and punctuation-insensitive via `normalizeHeader`.
2. Add a signature array of columns that are distinctive to this vendor — used by `detectPreset` to pick it automatically.
3. Register it: `myvendor: build('myvendor', 'My Vendor', MY_VENDOR, MY_VENDOR_SIG)` in `PRESETS`.
4. Drop a small, synthetic sample at `data/seed/samples/myvendor-students.csv` so the UI can offer it.
5. Add a detection test in `tests/import.test.js` and run `npm test`.

If the problem is a *value* rather than a *column* — a lunch status Librea does not recognise, a date format, an attendance code — the fix belongs in `src/import/values.js` (`toFrl`, `toEllLevel`, `toSpecialEd`, `toDate`, `toAttendanceCode`), and every one of those has tests to extend.

## Files this skill touches

| File | Why |
|---|---|
| `src/import/presets.js` | New vendor dictionary, signature, registration. |
| `src/import/values.js` | A value this district writes that Librea does not yet coerce. |
| `data/seed/samples/*.csv` | A synthetic sample of the new shape. Never a real export. |
| `tests/import.test.js` | Detection and coercion tests. |

Never commit a real district export, not even a few rows. Samples are fabricated.
