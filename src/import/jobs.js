// A tiny in-process job runner.
//
// Upserting entities is instant; embedding a sentence is not (~350ms each).
// So applyImport writes the records synchronously and hands the entity ids to
// this queue, which writes one 'record' fragment per student in the background
// while the HTTP response has already gone out.
//
// Re-importing the same roster must not pile up fragments, so each student's
// previous import-authored 'record' fragment is removed before the new one
// goes in.
import { randomUUID } from 'node:crypto';
import { describeStudent } from './describe.js';

const MAX_JOBS = 50;
const BATCH = 16;

export class ImportJobs {
  constructor(store, { batch = BATCH } = {}) {
    this.store = store;
    this.batch = batch;
    this.jobs = new Map();
    this.queue = [];
    this.draining = false;
  }

  /** Queue record fragments for these students. Returns the job immediately. */
  enqueue({ entityIds = [], preset = 'generic', actor = 'import', label = '' } = {}) {
    const ids = entityIds.filter((id) => this.store.getEntity(id)?.type === 'student');
    const job = {
      id: randomUUID(), label: label || `record fragments (${preset})`, preset,
      total: ids.length, done: 0, errors: [],
      status: ids.length ? 'running' : 'done',
      startedAt: new Date().toISOString(), finishedAt: ids.length ? null : new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    while (this.jobs.size > MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value);
    if (ids.length) {
      this.queue.push({ job, ids, actor, preset });
      this.drain();
    }
    return job;
  }

  get(id) { return this.jobs.get(id) || null; }

  list() {
    return [...this.jobs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Wait for the queue to empty. Handy in tests; nothing calls it in serving. */
  async idle() {
    while (this.draining || this.queue.length) {
      await (this.drainPromise || new Promise((r) => setTimeout(r, 5)));
    }
    return true;
  }

  drain() {
    if (this.draining) return this.drainPromise;
    this.draining = true;
    this.drainPromise = this._loop().finally(() => { this.draining = false; });
    return this.drainPromise;
  }

  async _loop() {
    while (this.queue.length) {
      const task = this.queue[0];
      for (let i = 0; i < task.ids.length; i += this.batch) {
        await this._chunk(task, task.ids.slice(i, i + this.batch));
      }
      finish(task.job);
      this.queue.shift();
    }
  }

  async _chunk(task, ids) {
    const inputs = [];
    for (const entityId of ids) {
      try {
        const input = await this._prepare(entityId, task);
        if (input) inputs.push(input);
        else task.job.errors.push({ entityId, message: 'nothing to describe' });
      } catch (err) {
        task.job.errors.push({ entityId, message: err.message });
      }
    }
    try {
      if (inputs.length) await this._write(inputs, task.actor);
    } catch (err) {
      for (const f of inputs) task.job.errors.push({ entityId: f.entityId, message: err.message });
    }
    task.job.done = Math.min(task.job.total, task.job.done + ids.length);
  }

  /** Drop the previous import-written record, build the new fragment input. */
  async _prepare(entityId, task) {
    const entity = this.store.getEntity(entityId);
    if (!entity || entity.type !== 'student') throw new Error('not a student entity');
    for (const f of this.store.getFragments(entityId)) {
      if (f.kind === 'record' && String(f.source || '').startsWith('import:')) {
        await this.store.removeFragment(f.id, task.actor);
      }
    }
    const school = entity.schoolId ? this.store.getEntity(entity.schoolId) : null;
    const text = describeStudent(entity, { schoolName: school?.name });
    if (!text) return null;
    return {
      entityId, kind: 'record', visibility: 'school', text,
      author: { id: task.actor, role: 'system' }, source: `import:${task.preset}`,
    };
  }

  async _write(inputs, actor) {
    if (typeof this.store.addFragments === 'function') return this.store.addFragments(inputs, actor);
    for (const input of inputs) await this.store.addFragment(input, actor);
    return inputs;
  }
}

function finish(job) {
  job.status = job.total && job.errors.length >= job.total ? 'failed' : 'done';
  job.finishedAt = new Date().toISOString();
}
