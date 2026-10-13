// The worker wire's decoders, fed malformed messages: fixed seeds make
// batches for a connection (remote.js: counts past the buffers, bad splits,
// wrong tables, operations out of range), the same through the shared
// mailbox (a slot write and its bell), and input for a served root
// (worker.js: event counts like Infinity or 'x', answers with costs that are
// not numbers, odd SYNC and viewport values). Every message must end,
// applied or thrown; a batch always hands its buffers back (a mailbox one
// frees its slot and is acknowledged by its own number); the worker's
// budget math stays finite. The body runs in a worker thread
// (fixtures/decoder-fuzz.js) that tells each message before it sends it, so
// one that hangs (5 s of wall clock) is ended from here and reported with
// its seed; a message that takes more than 250 ms of CPU counts as broken
// too (CPU time, so a loaded machine does not make it flake).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

/** The seeds: about 2 s in all. */
const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);
/** How long one message may run before the thread is ended as hung. */
const HANG = 5000;

describe('the worker wire decoders, fed malformed messages', () => {
  it(`end every message and hand every buffer back, over ${SEEDS.length} seeds`, { timeout: 60000 }, async t => {
    const worker = new Worker(new URL('./fixtures/decoder-fuzz.js', import.meta.url), { workerData: { seeds: SEEDS } });
    /** @type {{ close: (() => any) | null }} */
    const slot = { close: () => worker.terminate() };
    t.after(() => {
      const close = slot.close;
      slot.close = null;
      return close?.();
    });
    /** @type {any} */
    let last = null;
    let at = performance.now();
    const result = await new Promise((resolve, reject) => {
      // timer: deadline, ends the thread when one message has run too long (a decoder that loops).
      const guard = setInterval(() => {
        if (performance.now() - at < HANG) return;
        clearInterval(guard);
        void worker.terminate();
        resolve({ broken: [`seed ${last?.seed} ${last?.side}: no end after ${HANG} ms for ${last?.message}`] });
      }, 100);
      worker.on('message', m => {
        if (m.done) {
          clearInterval(guard);
          resolve(m);
          return;
        }
        last = m;
        at = performance.now();
      });
      worker.on('error', error => {
        clearInterval(guard);
        reject(error);
      });
    });
    if (result.broken.length > 0) console.log(result.broken.join('\n'));
    assert.deepEqual(result.broken.map((/** @type {string} */ b) => b.slice(0, 160)), [], 'messages that hung, ran too long, kept their buffers or broke the budget math');
  });
});
