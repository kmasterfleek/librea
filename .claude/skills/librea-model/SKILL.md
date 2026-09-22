---
name: librea-model
description: Connect a text-generation provider to Librea's app builder — offline templates, Ollama (local or cloud tag), or Anthropic — and update the sovereignty statement to match. Use when someone wants better generated apps, asks "can I use Claude with this", asks what happens to their data when a model is involved, or is deciding between local and hosted models.
---

# Connecting a model provider

Librea's app builder has three providers (`src/vibe/providers.js`). Two need no network. Picking one is a sovereignty decision, so state the consequence before changing anything.

**What is sent, in every case:** the prompt the person typed, the field names and dimension labels from `src/core/schema.js`, the SQL table list for their scope, one fabricated example row (`Avery Example`, `STU-EXAMPLE-0001`), and — on a remix — the previous version of that app's HTML.

**What is never sent:** a real student name, a real id, any metric, flag or outcome, and anything a student, family or teacher wrote. The prompt is assembled from schema constants only; nothing in `buildSystemPrompt` reads the store.

## The three providers

### `template` — the default, fully offline

```bash
LIBREA_MODEL_PROVIDER=template
```

No model at all. `src/vibe/templates.js` matches the words in the request against seven hand-written apps (dashboard, submit, profile, search, enrollments, website, roster) plus a generic fallback. Deterministic: the same request always produces the same app. Nothing leaves the machine. This is what a school should pilot on.

### `ollama` — a model on your own hardware

```bash
LIBREA_MODEL_PROVIDER=ollama
LIBREA_OLLAMA_HOST=http://localhost:11434
LIBREA_OLLAMA_MODEL=qwen2.5-coder:7b
```

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

With a local tag, nothing leaves the machine and Librea says so.

**Cloud tags are different and Librea does not hide it.** A model whose tag ends in `:cloud` or `-cloud` runs on Ollama's servers, reached through the local daemon. `providerInfo()` reports `offline: false` and the UI states that your prompt and the field shapes go to Ollama, and that swapping the tag for a local model makes it stop. If someone chooses a cloud tag, make sure they know that before you set it.

### `anthropic` — Claude writes the app

```bash
LIBREA_MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LIBREA_MODEL=claude-opus-5
```

Setting `ANTHROPIC_API_KEY` with no `LIBREA_MODEL_PROVIDER` selects `anthropic` automatically — worth saying out loud, because a key set for something else will silently switch the provider. Put the key in `.env`, never in a commit, never in `edition.json`.

## Verify, do not assume

```bash
curl -s http://127.0.0.1:4321/api/vibe/provider | jq
```

Returns `provider` (`name`, `model`, `offline`, `configured`, `describe`) and `whatLeaves` (`leaves`, `statement`, `sends`, `neverSends`). The Home page's sovereignty panel renders the same thing. Show the adopter this output rather than telling them what you configured — it is the running server's own answer.

Then generate one app and read it. A local 7B model will sometimes break the hard rules in the prompt (an external `<script src>`, a bare `fetch`, a missing `librea.ready()`); `auditHtml` in `src/vibe/routes.js` reports those as warnings on the app rather than rewriting it, and the sandbox blocks them regardless.

## What changes in the sovereignty statement

If you move a school off `template`, the statement in three places must change together:

1. `whatLeaves()` in `src/vibe/providers.js` — it is generated from the provider, so it follows automatically. Confirm it reads true.
2. The sovereignty section of `README.md` — if the school's default is now a hosted provider, say which one and what it receives.
3. `docs/security.md` — the "what leaves the building" paragraph and anything the school tells families.

If an edition's `copy.sovereigntyLineForParents` says "nothing is sent anywhere" and the school then configures Anthropic, that line is now false. Fix it in the same change.

## The embedder is separate and always local

`src/core/embed.js` runs `all-MiniLM-L6-v2` in-process over every fragment. This is the only model that sees student text, and it never leaves the machine. Its weights download once from Hugging Face into `data/models/` (that download is the only network call a default install makes); after that it runs unplugged. `LIBREA_MODELS` moves the cache. Changing the embedding model changes `EMBED_DIM` and invalidates `data/vectors.db` — a rebuild, not a config tweak.

## Files this skill touches

| File | Why |
|---|---|
| `.env` | Provider, host, model, API key. |
| `README.md`, `docs/security.md` | Only if the school's default provider changes. |
| `editions/<id>/edition.json` | Only to correct a `copy` line that is now untrue. |

Do not add a provider that posts records anywhere. If a new provider is needed, it goes in `src/vibe/providers.js` implementing `generate({ system, messages })` and `providerInfo()`, and it must be able to state honestly what leaves.
