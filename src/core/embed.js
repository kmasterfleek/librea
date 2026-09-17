// Local embeddings: all-MiniLM-L6-v2 (384 dims), mean-pooled and normalized.
// Primary backend is @huggingface/transformers on onnxruntime-node (~3 ms per
// text on a laptop); fallback is ruvector's bundled WASM embedder (same model,
// ~350 ms per text). The model is downloaded once into data/models and then
// runs with the network unplugged. This is the only "model" that ever touches
// a student record.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EMBED_DIM = 384;
export const EMBED_MODEL = 'all-MiniLM-L6-v2';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_DIR = process.env.LIBREA_MODELS || path.join(ROOT, 'data', 'models');

let backend = null;
let initPromise = null;

async function initTransformers() {
  const { pipeline, env } = await import('@huggingface/transformers');
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  env.cacheDir = MODEL_DIR;
  env.allowLocalModels = true;
  const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
  const run = async (texts) => {
    const out = await fe(texts, { pooling: 'mean', normalize: true });
    const [n, d] = out.dims;
    const vecs = [];
    for (let i = 0; i < n; i++) vecs.push(Float32Array.from(out.data.slice(i * d, (i + 1) * d)));
    return vecs;
  };
  return { name: 'transformers', embedMany: run };
}

async function initRuvector() {
  const { OnnxEmbedder } = await import('ruvector');
  const e = new OnnxEmbedder();
  await e.init();
  return { name: 'ruvector-wasm', embedMany: async (texts) => (await e.embedPassageBatch(texts)).map((v) => Float32Array.from(v)) };
}

export async function getEmbedder() {
  if (backend) return backend;
  if (!initPromise) {
    initPromise = (async () => {
      try { backend = await initTransformers(); }
      catch (err) {
        console.warn('transformers embedder unavailable (' + err.message.split('\n')[0] + '); falling back to ruvector WASM embedder');
        backend = await initRuvector();
      }
      return backend;
    })();
  }
  return initPromise;
}

export function embedderInfo() { return { model: EMBED_MODEL, dims: EMBED_DIM, backend: backend?.name || 'not loaded', modelDir: MODEL_DIR }; }

const clip = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n) || ' ';

export async function embedBatch(texts, { batchSize = 64 } = {}) {
  const e = await getEmbedder();
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) out.push(...(await e.embedMany(texts.slice(i, i + batchSize).map((t) => clip(t, 4000)))));
  return out;
}

export async function embedPassage(text) { return (await embedBatch([text]))[0]; }
export async function embedQuery(text) { return (await embedBatch([clip(text, 2000)]))[0]; }

/** L2-normalized mean of vectors. Returns null for an empty list. */
export function meanVector(vectors) {
  if (!vectors.length) return null;
  const n = vectors[0].length;
  const out = new Float32Array(n);
  for (const v of vectors) for (let i = 0; i < n; i++) out[i] += v[i];
  let norm = 0;
  for (let i = 0; i < n; i++) { out[i] /= vectors.length; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) out[i] /= norm;
  return out;
}
