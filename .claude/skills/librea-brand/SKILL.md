---
name: librea-brand
description: Rename and rebrand Librea for a specific school through an edition — vocabulary (district/student/teacher → their words), colours, logo text, home page copy, invite emails, enabled features, and onboarding steps. Use when someone wants Librea to say "learners" instead of "students", wants their own name and colours, or asks how to make it not look like a demo.
---

# Branding Librea as an edition

Never hard-code a school's name into `src/` or `public/`. One JSON file renames the whole application, in the browser and on the server, because every page asks `t()` for its words (`public/js/edition.js`) and `src/core/edition.js` does the substitution with case preserved.

## 1. Create the edition

```bash
mkdir -p editions/<id>          # id: lowercase letters, digits, hyphens
```

Write `editions/<id>/edition.json`. Every key is optional and deep-merges over `BASE_EDITION` in `src/core/edition.js`. Use `editions/micro/edition.json` as the worked example.

```jsonc
{
  "id": "<id>",
  "name": "Your School",
  "tagline": "One sentence someone would actually say.",
  "audience": "Who this edition is for",
  "vocabulary": {
    "district": "network", "school": "campus", "student": "scholar",
    "family": "family", "staff": "faculty", "teacher": "advisor",
    "class": "seminar", "grade": "year", "principal": "head"
  },
  "roles": ["admin", "staff", "student", "family"],
  "features": { "import": true, "vibe": true, "sql": true, "compliance": true,
                "onboarding": true, "timeline": true, "invites": true },
  "compliance": { "packs": ["core"] },
  "onboarding": { "mode": "import-or-manual", "steps": ["organization", "people", "families", "compliance", "apps"] },
  "theme": { "accent": "#3d6b8e", "accent2": "#c97b4a", "logoText": "Your School" },
  "copy": { "homeHeadline": "...", "homeSubhead": "...", "exportLine": "..." },
  "seed": "editions/<id>/seed.js",
  "templates": "editions/<id>/apps"
}
```

## 2. Vocabulary rules that matter

`t()` replaces whole words and their simple plural, preserving leading capitals. So:

- Use the **singular, lowercase** form as the key. `"student": "learner"` also handles `Students` → `Learners`.
- A key that maps to itself is skipped — leave `"family": "family"` in place for readability.
- Irregular plurals do not work (`"child"` → `"children"` will produce `childs`). Pick a word whose plural is a trailing `s`.
- Substitution is textual. Do not rename a word that also appears in an id, a URL or a SQL column — `grade` as a *vocabulary word* is safe because the column is `grade` in SQL and never passed through `t()`, but check any copy you write.

## 3. Copy

`copy` is free-form; pages read the keys they know. The ones in use, from `editions/micro/edition.json`: `homeHeadline`, `homeSubhead`, `onboardingIntro`, `sovereigntyLineForParents`, `complianceIntro`, `inviteEmailFamily`, `inviteEmailGuide`, `emptyLearners`, `exportLine`. Invite email templates use `{pod}`, `{learner}`, `{url}`, `{code}`, `{inviter}` placeholders — keep whichever the calling page substitutes.

Write copy the way the school speaks. The point of an edition is that a parent reading it does not feel like they are using district software.

## 4. Theme

`theme.accent`, `theme.accent2` and `theme.logoText` are read by `public/js/edition.js` and applied as CSS custom properties. Anything deeper belongs in `public/app.css`, which uses custom properties throughout — change the tokens, not the rules.

## 5. Check it

```bash
LIBREA_EDITION=<id> npm start
```

`GET /api/edition` returns the merged edition; `GET /api/editions` lists every edition folder that has an `edition.json`. Then read the home page, the people list, an empty state and an invite with a colleague's eyes: any word still saying "district" is a page that did not call `t()`, and that is a bug worth fixing in `public/js/`.

Run `npm test` — `tests/onboard.test.js` covers edition loading, fallback to base, and case-preserving substitution.

## Files this skill touches

| File | Why |
|---|---|
| `editions/<id>/edition.json` | Everything above. |
| `editions/<id>/seed.js` | Optional: demo data in this edition's shape. |
| `editions/<id>/apps/` | Optional: app templates shipped with the edition. |
| `public/app.css` | Only if the accent tokens are not enough. |
| `.env` | `LIBREA_EDITION=<id>`. |

Do not edit `src/core/edition.js` to add a school. If a school needs a key that `BASE_EDITION` does not have, add the key to `BASE_EDITION` with a sensible default first, so every edition keeps working.
