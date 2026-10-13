// The body of test/decoder.fuzz.test.js, run in a worker thread so a
// decoder that loops can be ended from outside: for each seed it sends
// malformed messages to a connection (remote.js) and to a served root
// (worker.js). Before each message it posts its seed and the message to the
// parent, which ends the thread when one takes too long; at the end it posts
// the invariants broken.

import { parentPort, workerData } from 'node:worker_threads';
import { connect } from '../../src/remote.js';
import { Mailbox } from '../../src/mailbox.js';
import { serve } from '../../src/worker.js';
import { Tree } from './tree.js';
import { PROTOCOL } from '../../src/port.js';

/** A deterministic generator in [0, 1). @param {number} seed */
function random(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** A message as text, for the report (buffers as their words). @param {any[]} m */
const show = m => JSON.stringify(m, (_k, v) => (v instanceof ArrayBuffer ? `buf[${[...new Int32Array(v, 0, Math.floor(v.byteLength / 4))].join(',')}]` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));

/**
 * The most CPU time a message may take, in ms, before it counts as broken.
 * CPU time, not the wall clock: a loaded machine stretches the wall clock
 * of a message that does little, and that must not read as a hang.
 */
const SLOW = 250;

/** @type {string[]} */
const broken = [];

/** Sends one message through `send`, telling the parent first, and times it. @param {number} seed @param {string} side @param {any[]} m @param {(m: any[]) => void} send */
function deliver(seed, side, m, send) {
  const text = show(m);
  parentPort?.postMessage({ seed, side, message: text });
  const t0 = process.cpuUsage();
  try {
    send(m);
  } catch {
    // Throwing is allowed; what matters is that it ends and hands its buffers back.
  }
  const used = process.cpuUsage(t0);
  const ms = (used.user + used.system) / 1000;
  if (ms > SLOW) broken.push(`seed ${seed} ${side}: ${Math.round(ms)} ms of CPU for ${text}`);
}

/** Malformed batches to a connection: each must be acknowledged with its buffers, applied or not. @param {number} seed */
function remote(seed) {
  const r = random(seed);
  const pick = (/** @type {number} */ k) => Math.floor(r() * k);
  /** @type {any[][]} */
  const acks = [];
  /** @type {any} */
  let listener = null;
  // A copy, as a real port clones: the connection reuses its acknowledgement array.
  const port = { postMessage: (/** @type {any[]} */ m) => void (m[0] === 2 && acks.push([...m])), addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l), removeEventListener() {} };
  const c = connect(/** @type {any} */ (port), Tree(), {}, { schedule: 'now', mailbox: false });
  try {
    for (let k = 0; k < 4; k++) {
      const words = 4 + pick(20);
      const a = new Int32Array(words);
      a[0] = pick(5);
      a[1] = 1 | (pick(2) ? 4 : 0);
      a[2] = pick(3) ? words : pick(words + 4) - 2;
      a[3] = seed;
      for (let i = 4; i < words; i++) a[i] = pick(4) ? pick(24) : pick(4) - 2;
      const counts = [words, words, words + pick(5) - 2, -1, Infinity, NaN, 'x', 2 ** 31];
      const n = counts[pick(counts.length)];
      const nums = pick(3) === 0 ? null : new Float64Array(pick(3)).buffer;
      const ms = [0, 1, 2, 5, -1, NaN];
      const m = nums === null ? 0 : ms[pick(ms.length)];
      const table = () => [null, ['a', 'b'], 'not a table', 7][pick(4)];
      const msg = [1, pick(12) === 0 ? 'not a buffer' : a.buffer, n, nums, m, table(), [null, ['value', 'x', 'div'], 5][pick(3)], table()];
      const before = acks.length;
      deliver(seed, 'remote', msg, d => listener({ data: d }));
      if (acks.length !== before + 1) broken.push(`seed ${seed} remote: ${acks.length - before} acknowledgements for ${show(msg)}`);
      else if (msg[1] instanceof ArrayBuffer && acks[acks.length - 1][1] !== msg[1]) broken.push(`seed ${seed} remote: its ops buffer not handed back for ${show(msg)}`);
    }
  } finally {
    c.close();
  }
}

/** Malformed batches through the shared mailbox: each frees its slot and is acknowledged by its own number. @param {number} seed */
function mailbox(seed) {
  const r = random(seed ^ 0x27d4eb2d);
  const pick = (/** @type {number} */ k) => Math.floor(r() * k);
  /** @type {any[][]} */
  const acks = [];
  /** @type {any} */
  let listener = null;
  /** @type {any} */
  let shared = null;
  const port = {
    postMessage: (/** @type {any[]} */ m) => {
      if (m[0] === 2) acks.push([...m]);
      if (m[0] === 8) shared = m[1];
    },
    addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l),
    removeEventListener() {},
  };
  const c = connect(/** @type {any} */ (port), Tree(), {}, { schedule: 'now', mailbox: 1 << 16 });
  try {
    if (shared === null) return void broken.push(`seed ${seed} mailbox: no mailbox offered`);
    const box = new Mailbox(shared);
    for (let k = 0; k < 4; k++) {
      const number = seed * 8 + k + 1;
      const words = pick(12);
      const ops = new Int32Array(Math.max(words, 1));
      if (words > 0) ops[0] = pick(3);
      if (words > 1) ops[1] = 1 | (pick(2) ? 4 : 0);
      if (words > 2) ops[2] = pick(3) ? words : pick(words + 4) - 2;
      if (words > 3) ops[3] = number;
      for (let i = 4; i < words; i++) ops[i] = pick(4) ? pick(24) : pick(4) - 2;
      const m = pick(3);
      if (!box.write(number, ops, words, new Float64Array(m), m, pick(2) ? ['a'] : [], pick(2) ? ['value'] : [])) {
        broken.push(`seed ${seed} mailbox: the slot is not free for message ${number}`);
        break;
      }
      const before = acks.length;
      deliver(seed, 'mailbox', [6, number, `ops ${[...ops.subarray(0, words)].join(',')}`], () => listener({ data: [6, number] }));
      if (box.waiting() !== -1) broken.push(`seed ${seed} mailbox: slot not freed after message ${number} (${words} words)`);
      if (acks.length !== before + 1) broken.push(`seed ${seed} mailbox: ${acks.length - before} acknowledgements for message ${number}`);
      else if (acks[acks.length - 1][6] !== number) broken.push(`seed ${seed} mailbox: message ${number} acknowledged as ${acks[acks.length - 1][6]}`);
    }
  } finally {
    c.close();
  }
}

/** Malformed input to a served root: it must end each message, and keep its budget math finite. @param {number} seed */
function worker(seed) {
  const r = random(seed ^ 0x5bd1e995);
  const pick = (/** @type {number} */ k) => Math.floor(r() * k);
  /** @type {any} */
  let listener = null;
  const port = { postMessage() {}, addEventListener: (/** @type {string} */ _t, /** @type {any} */ l) => void (listener = l), removeEventListener() {}, start() {} };
  const session = serve(() => 'hi', { port: /** @type {any} */ (port), id: 'main', locks: null });
  try {
    deliver(seed, 'worker', [5, null, null, undefined, null, PROTOCOL], d => listener({ data: d }));
    const odd = [Infinity, -Infinity, NaN, 'x', 2 ** 31, -1, 0, 3, null, undefined];
    for (let k = 0; k < 4; k++) {
      const kind = pick(4);
      /** @type {any[]} */
      let msg;
      if (kind === 0) msg = [1, odd[pick(odd.length)], ...Array.from({ length: pick(30) }, () => odd[pick(odd.length)])];
      else if (kind === 1) msg = [2, null, null, odd[pick(odd.length)], odd[pick(odd.length)], odd[pick(odd.length)], odd[pick(odd.length)], pick(2) === 0];
      else if (kind === 2) msg = [3, odd[pick(odd.length)]];
      else msg = [9, odd[pick(odd.length)], odd[pick(odd.length)], odd[pick(odd.length)]];
      deliver(seed, 'worker', msg, d => listener({ data: d }));
      const host = /** @type {any} */ (session).host;
      for (const [name, v] of Object.entries(session.counters)) if (typeof v === 'number' && !Number.isFinite(v)) broken.push(`seed ${seed} worker: counter ${name} is ${v} after ${show(msg)}`);
      for (const name of ['perRecord', 'perPresent', 'limit']) if (!Number.isFinite(host[name])) broken.push(`seed ${seed} worker: ${name} is ${host[name]} after ${show(msg)}`);
    }
  } finally {
    session.close();
  }
}

for (const seed of workerData.seeds) {
  remote(seed);
  mailbox(seed);
  worker(seed);
  if (broken.length >= 10) break;
}
parentPort?.postMessage({ done: true, broken });
