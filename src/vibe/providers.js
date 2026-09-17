// Text-generation providers. Three of them, and two need no network at all.
// A provider is: async *generate({ system, messages }) yielding string chunks,
// plus providerInfo() -> { name, model, offline }.
import { renderTemplate } from './templates.js';

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
const OLLAMA_HOST = process.env.LIBREA_OLLAMA_HOST || 'http://localhost:11434';

/** Which provider is configured right now. */
export function providerName() {
  const explicit = String(process.env.LIBREA_MODEL_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'template';
}

export function providerInfo() {
  const name = providerName();
  if (name === 'anthropic') {
    return {
      name: 'anthropic',
      model: process.env.LIBREA_MODEL || DEFAULT_ANTHROPIC_MODEL,
      offline: false,
      configured: !!process.env.ANTHROPIC_API_KEY,
      describe: 'Claude writes the app. Your prompt and the field shapes go out; student records never do.',
    };
  }
  if (name === 'ollama') {
    const model = process.env.LIBREA_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
    // Ollama cloud tags (":cloud" / "-cloud") run on Ollama's servers through the local daemon.
    const cloud = /(:|-)cloud$/i.test(model);
    return {
      name: 'ollama',
      model,
      offline: !cloud,
      configured: true,
      describe: cloud
        ? `${model} runs on Ollama's cloud through the local daemon at ${OLLAMA_HOST}. Your prompt and the field shapes go to Ollama; student records never do. Swap the tag for a local model and nothing leaves.`
        : `A local model at ${OLLAMA_HOST} writes the app. Nothing leaves this machine.`,
    };
  }
  return {
    name: 'template',
    model: 'librea-templates',
    offline: true,
    configured: true,
    describe: 'No model at all. Librea assembles the app from built-in templates. Nothing leaves this machine.',
  };
}

/** Plain-language statement of what, if anything, leaves the building. */
export function whatLeaves() {
  const info = providerInfo();
  if (info.offline) {
    return {
      leaves: 'nothing',
      statement: `Nothing leaves this machine. ${info.describe}`,
      sends: [],
      neverSends: ['student names', 'student ids', 'grades, metrics, or flags', 'anything a student, family, or teacher wrote'],
    };
  }
  return {
    leaves: 'your prompt and the data schema',
    statement: 'Only your description of the app and the shape of the data (field names, dimension labels, and one made-up example row) are sent to the model provider. No student record, no name, no id, and nothing anyone wrote about a child is ever included.',
    sends: ['your prompt', 'field names and dimension labels', 'one synthetic example row with a made-up name', 'the prior version of this app when you remix it'],
    neverSends: ['student names', 'student ids', 'grades, metrics, or flags', 'anything a student, family, or teacher wrote'],
  };
}

export function getProvider(name = providerName()) {
  if (name === 'anthropic') return anthropicProvider();
  if (name === 'ollama') return ollamaProvider();
  if (name === 'template') return templateProvider();
  throw new Error(`unknown provider: ${name}. Set LIBREA_MODEL_PROVIDER to anthropic, ollama, or template.`);
}

// ---------------------------------------------------------------- anthropic

function anthropicProvider() {
  const model = process.env.LIBREA_MODEL || DEFAULT_ANTHROPIC_MODEL;
  return {
    info: providerInfo(),
    async *generate({ system, messages }) {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Set LIBREA_MODEL_PROVIDER=template or =ollama to build apps without a key.');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic();
      const stream = client.messages.stream({
        model,
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new Error('The model declined to write this app. Rephrase the request, or switch to the offline template provider.');
      if (final.stop_reason === 'max_tokens') throw new Error('The app was cut off at the length limit. Ask for something smaller, or split it into two apps.');
    },
  };
}

// ------------------------------------------------------------------- ollama

function ollamaProvider() {
  const model = process.env.LIBREA_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  return {
    info: providerInfo(),
    async *generate({ system, messages }) {
      const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
      let res;
      try {
        res = await fetch(`${OLLAMA_HOST}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, system, prompt, stream: true, options: { num_ctx: 16384 } }),
        });
      } catch (e) {
        throw new Error(`Cannot reach Ollama at ${OLLAMA_HOST}: ${e.message}. Start it with "ollama serve", or set LIBREA_MODEL_PROVIDER=template.`);
      }
      if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.error) throw new Error(`Ollama: ${obj.error}`);
          if (obj.response) yield obj.response;
          if (obj.done && obj.done_reason === 'length') throw new Error('The local model hit its length limit before finishing the app.');
        }
      }
    },
  };
}

// ----------------------------------------------------------------- template

/**
 * The offline generator. No model: it matches the words in the request against
 * a handful of hand-written apps that exercise the runtime API. Deterministic,
 * so the same request always produces the same app.
 */
function templateProvider() {
  return {
    info: providerInfo(),
    template: true,
    async *generate({ messages, title }) {
      const last = messages[messages.length - 1];
      const ask = typeof last?.content === 'string' ? last.content : '';
      const { html } = renderTemplate(stripRemixWrapper(ask), title);
      // Stream it in chunks so the caller's SSE path is the same for every provider.
      const size = 900;
      for (let i = 0; i < html.length; i += size) {
        yield html.slice(i, i + size);
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}

/** A remix message carries the prior document; only the instruction matters here. */
function stripRemixWrapper(text) {
  const m = /Change it as follows:\s*([\s\S]*?)\s*Reply with the FULL rewritten/.exec(text);
  if (m) return m[1];
  return text.replace(/^Build this app:\s*/i, '');
}
