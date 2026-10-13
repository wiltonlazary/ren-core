// $settle over trees of nested roots, by generated scenarios: fixed seeds
// each build an outer root with nested roots (some shown, some not), tasks
// in each, and then run a random sequence of steps: tasks complete or fail,
// roots are shown, hidden or disposed, effects throw, `$catch` handlers that
// swallow or rethrow are set, more settles start (some from a `$settled`
// callback, inside a flush), and time passes. A small model says which
// failure must reach which settle: one in root X reaches a settle whose tree
// holds X when the settle met X after X's last `$catch` (an earlier boundary
// is displaced by it), unless that handler swallows it. Checked through the
// module-internal probes of settle.js and nested.js (not package exports):
// - a settle finishes once, and its promise then ends;
// - it never resolves while a root of its tree is loading, after a failure
//   the model says reaches it, or while its root is being disposed;
// - it never rejects without a cause: a failure the model says reaches it,
//   its root disposed, or its deadline passed; such a failure ends it by
//   the end of the step that raised it;
// - a settle with a finite timeout has ended by its deadline;
// - none is stuck with nothing pending, none holds a disposed root;
// - no finished settle leaves a `$settled` callback on a live root;
// - at the end no timer, watcher, boundary, handler or `$settled`
//   callback of a settle is left.
// It does not check which pass covers a root joined mid-pass (only that the
// settle ends right). On a failure it prints the seed and the scenario.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsx, Root, $task, $active, $read, $dispose, $settle, $settled, $flush, $write, $signal, $effect, $catch, Show } from 'ren-core';
import { probe } from '../src/settle.js';
import { probe as nested } from '../src/nested.js';
import { Tree } from './fixtures/tree.js';

/**
 * The seeds run: 1 to 40, and seeds pinned because they catch a defect the
 * range misses (found by mutating settle.js): 100, a handled failure that
 * still failed the settle; 224, a nested root rendered mid-pass not joined
 * at once; 1188, a nested root joined again while it was disposed; 1833, a
 * settle resolved while a root it had covered was loading again; 68, a
 * settle that joined a boundary a `$catch` had displaced. About 3 s in
 * all, most of it the scenarios' own time passing.
 */
const SEEDS = [...Array.from({ length: 40 }, (_, i) => i + 1), 68, 100, 224, 1188, 1833];

const start = globalThis.setTimeout;
const stop = globalThis.clearTimeout;
/** Lets `ms` of the scenario's time pass: the time a deadline under test needs. @param {number} ms */
const elapse = ms => new Promise(done => start(done, ms)); // timer: feature, the scenario's time passing (its deadlines are under test)

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

/** A root and its live nested roots. @param {any} r @param {any[]} [out] @returns {any[]} */
function tree(r, out = []) {
  if (r.closed) return out;
  out.push(r);
  for (const k of nested.kids.get(r) ?? []) tree(k, out);
  return out;
}

/**
 * One scenario; returns the invariants it broke.
 * @param {number} seed @param {string[]} log
 * @returns {Promise<string[]>}
 */
async function scenario(seed, log) {
  const rand = random(seed);
  /** @template T @param {T[]} a @returns {T} */
  const pick = a => a[Math.floor(rand() * a.length)];
  /** @type {string[]} */
  const broken = [];
  /** @type {Map<any, any>} */
  const settles = new Map();
  /** @type {any} */
  let made = null;
  /** The `$settled` callbacks of finished settles, by root. @type {[any, any, number][]} */
  const callbacks = [];
  probe.made = s => {
    made = s;
    settles.set(s, { n: 0, finished: false, ok: undefined, mustFail: null, settled: 'pending', timeout: 0, at: 0, deadline: Infinity });
  };
  probe.finished = (s, ok, error) => {
    const rec = settles.get(s);
    if (!rec) return;
    if (rec.finished) broken.push(`settle #${rec.n} finished twice`);
    rec.finished = true;
    rec.ok = ok;
    for (const [r, wait] of s.waits) callbacks.push([r, wait.settled, rec.n]);
    if (!ok) {
      const cause = rec.mustFail || s.root.closing || s.root.closed || Date.now() >= rec.deadline - 1;
      if (!cause) broken.push(`settle #${rec.n} rejected without a cause: ${error?.message}`);
      return;
    }
    if (s.root.closing || s.root.closed) broken.push(`settle #${rec.n} resolved while its root "${s.root.id}" is disposed`);
    for (const r of tree(s.root)) if (!r.closing && r.loading > 0) broken.push(`settle #${rec.n} resolved with root "${r.id}" loading`);
    if (rec.mustFail) broken.push(`settle #${rec.n} resolved after ${rec.mustFail}`);
  };
  /** @type {Set<any>} */
  const timers = new Set();
  globalThis.setTimeout = /** @type {any} */ ((/** @type {any} */ fn, /** @type {any} */ ms) => {
    const id = start(() => {
      timers.delete(id);
      fn();
    }, ms); // timer: feature, passes the settles' own deadlines through, counted
    timers.add(id);
    return id;
  });
  globalThis.clearTimeout = /** @type {any} */ ((/** @type {any} */ id) => {
    timers.delete(id);
    stop(id);
  });
  try {
    let next = 0;
    /** @param {number} depth @returns {any} */
    const gen = depth => ({
      id: 'r' + next++,
      tasks: Math.floor(rand() * 3),
      shown: rand() < 0.7,
      kids: depth < 3 ? Array.from({ length: Math.floor(rand() * (depth === 0 ? 3 : 2)) }, () => gen(depth + 1)) : [],
    });
    const spec = gen(0);
    // Half the scenarios give their settles no short deadline, so they end by what happens, not by time.
    const patient = rand() < 0.5;
    log.push(JSON.stringify(spec, (k, v) => (k === 'shown' ? (v ? 1 : 0) : v)) + (patient ? ' (patient)' : ''));
    /** @type {Map<string, any>} */
    const state = new Map();
    /** @type {Set<any>} */
    const roots = new Set();
    /** Each root's last `$catch`: the step it was set at, and whether it swallows. @type {Map<any, { at: number, swallows: boolean }>} */
    const caught = new Map();
    /** The step each root was built at. @type {Map<any, number>} */
    const born = new Map();
    let now = 0;
    const Body = (/** @type {{ spec: any }} */ { spec }) => {
      const R = $active();
      roots.add(R);
      born.set(R, now);
      const s = { root: R, spec, sig: $signal(R, 0), boom: $signal(R, false), shown: new Map(), done: /** @type {any[]} */ ([]) };
      state.set(spec.id, s);
      $effect(R, () => {
        if ($read(s.boom)) throw new Error('boom ' + spec.id);
      });
      const tasks = [];
      for (let i = 0; i < spec.tasks; i++) tasks.push($task(R, () => $read(s.sig), (_v, d) => void (s.done[i] = d)));
      const kids = spec.kids.map((/** @type {any} */ k) => {
        const shown = $signal(R, k.shown);
        s.shown.set(k.id, shown);
        return jsx(Show, { when: shown, children: jsx(Root, { id: k.id, storage: null, locks: null, children: () => jsx(Body, { spec: k }) }) });
      });
      return jsx('n', { children: [...kids, ...tasks.map(t => jsx('b', { children: () => String($read(t) ?? '') }))] });
    };
    const O = Root({ id: spec.id, renderer: Tree(), storage: null, locks: null, children: () => jsx(Body, { spec }) });
    const live = () => [...state.values()].filter(s => !s.root.closed && !s.root.closing);
    let n = 0;
    let longest = 0;
    const begin = (/** @type {any} */ r) => {
      const timeout = patient ? pick([0, 10000]) : pick([0, 0, 5, 15, 40, 10000]);
      if (timeout !== 10000) longest = Math.max(longest, timeout);
      made = null;
      const p = $settle(r, { timeout });
      const rec = made !== null ? settles.get(made) : { finished: true, settled: 'pending' };
      Object.assign(rec, { n: ++n, timeout, at: now, deadline: timeout > 0 && timeout < 10000 ? Date.now() + timeout : Infinity });
      p.then(
        () => void (rec.settled = 'resolved'),
        e => void (rec.settled = 'rejected: ' + e.message),
      );
      log.push(`settle #${rec.n} on ${r.id} timeout ${timeout}`);
    };
    // A failure in X: every live settle whose tree holds X and whose boundary on X
    // is still X's handler (it met X after X's last $catch) fails, unless that handler swallows it.
    const fails = (/** @type {any} */ X, /** @type {string} */ why) => {
      const c = caught.get(X);
      for (const [s, rec] of settles) {
        if (rec.finished || !tree(s.root).includes(X)) continue;
        const met = Math.max(rec.at, born.get(X) ?? 0);
        if (c !== undefined && (met < c.at || c.swallows)) continue;
        rec.mustFail ??= why;
        failing.push(rec);
      }
    };
    /** The settles a failure of this step reaches: each must have ended by the step's end. @type {any[]} */
    const failing = [];
    begin(O);
    const steps = 10 + Math.floor(rand() * 25);
    for (let i = 0; i < steps; i++) {
      now = i + 1;
      const L = live();
      if (L.length === 0) break;
      const s = pick(L);
      const kind = pick(['complete', 'complete', 'complete', 'fail', 'fail', 'restart', 'restart', 'toggle', 'toggle', 'toggle', 'boom', 'unboom', 'dispose', 'dispose', 'catch', 'rethrow', 'settle', 'settle', 'settled', 'wait', 'wait', 'turn', 'disposeOuter']);
      let step = `${kind} ${s.spec.id}`;
      try {
        if (kind === 'complete' || kind === 'fail') {
          const at = s.done.findIndex((/** @type {any} */ d) => d);
          if (at < 0) {
            log.push(step + ' (none)');
            continue;
          }
          const d = s.done[at];
          s.done[at] = null;
          step += ' #' + at;
          if (kind === 'fail') fails(s.root, `a failure of task ${s.spec.id}#${at}`);
          log.push(step);
          d(kind === 'fail' ? { ok: false, error: new Error('task ' + s.spec.id) } : { ok: true, value: i });
          continue;
        }
        log.push(step);
        if (kind === 'restart') {
          s.done = [];
          $write(s.sig, $read(s.sig) + 1);
        } else if (kind === 'toggle') {
          const ks = [...s.shown.keys()];
          if (ks.length) {
            const shown = s.shown.get(pick(ks));
            log[log.length - 1] += ' -> ' + !$read(shown);
            $write(shown, !$read(shown));
          }
        } else if (kind === 'boom') {
          if (!$read(s.boom)) {
            fails(s.root, 'boom ' + s.spec.id);
            $write(s.boom, true);
          }
        } else if (kind === 'unboom') $write(s.boom, false);
        else if (kind === 'dispose') {
          if (s.root !== O) $dispose(s.root);
        } else if (kind === 'catch') {
          caught.set(s.root, { at: now, swallows: true });
          $catch(s.root, () => {});
        } else if (kind === 'rethrow') {
          caught.set(s.root, { at: now, swallows: false });
          $catch(s.root, e => {
            throw e;
          });
        } else if (kind === 'settle') begin(s.root);
        else if (kind === 'settled') {
          // A settle started inside a flush, from a $settled callback.
          const R = s.root;
          $settled(R, () => {
            if (!R.closed && !R.closing) begin(R);
          });
          $write(s.sig, $read(s.sig));
          $flush(R);
        }
        else if (kind === 'wait') await elapse(Math.floor(rand() * 12));
        else if (kind === 'turn') await Promise.resolve();
        else if (kind === 'disposeOuter' && rand() < 0.3) {
          for (const [st, rec] of settles) if (!rec.finished && tree(O).includes(st.root)) rec.mustFail ??= 'the outer root was disposed';
          $dispose(O);
        }
      } catch (e) {
        log.push('  threw ' + /** @type {any} */ (e).message);
      }
      // A failure that reaches a settle ends it at once.
      await Promise.resolve();
      for (const rec of failing) if (!rec.finished) broken.push(`settle #${rec.n} still waits after ${rec.mustFail}`);
      failing.length = 0;
    }
    await elapse(3);
    for (const [st, rec] of settles) {
      if (rec.finished || st.done) continue;
      for (const [r] of st.waits) if (r.closed) broken.push(`settle #${rec.n} holds a wait on disposed root "${r.id}"`);
      if (!st.root.closed && tree(st.root).every(r => r.loading === 0 && !r.flushing)) broken.push(`settle #${rec.n} stuck with nothing pending`);
    }
    // Every settle with a finite timeout has ended by its deadline.
    await elapse(longest + 30);
    for (const [, rec] of settles) if (rec.timeout > 0 && rec.timeout < 10000 && !rec.finished) broken.push(`settle #${rec.n} (timeout ${rec.timeout}) still pending past its deadline`);
    // No finished settle left a $settled callback on a live root.
    for (const [r, cb, k] of callbacks) if (!r.closed && r.settled.includes(cb)) broken.push(`settle #${k} left its $settled callback on "${r.id}"`);
    // The end: every root goes, so every settle ends, failing.
    for (const [st, rec] of settles) if (!rec.finished && !st.root.closed) rec.mustFail ??= 'its root was disposed at the end';
    try {
      $dispose(O);
    } catch (e) {
      log.push('final dispose threw ' + /** @type {any} */ (e).message);
    }
    for (const r of roots)
      if (!r.closed)
        try {
          $dispose(r);
        } catch {
          // A root's own failure on the way out is not what this checks.
        }
    await Promise.resolve();
    await Promise.resolve();
    for (const [, rec] of settles) {
      if (!rec.finished) broken.push(`settle #${rec.n} never ended`);
      if (rec.mustFail && rec.ok) broken.push(`settle #${rec.n} resolved though ${rec.mustFail}`);
      if (rec.finished && rec.settled === 'pending') broken.push(`settle #${rec.n} finished, its promise pending`);
    }
    if (timers.size) broken.push(`${timers.size} timer(s) left`);
    for (const r of roots) {
      if ((nested.watchers.get(r)?.size ?? 0) > 0) broken.push(`a watcher left on ${r.id}`);
      if ((probe.live.get(r)?.size ?? 0) > 0) broken.push(`a boundary left live on ${r.id}`);
      if (probe.boundaries.has(r)) broken.push(`a boundary record left on ${r.id}`);
      if (!caught.has(r) && r.errorHandler !== null) broken.push(`a handler left on ${r.id}`);
      if (caught.has(r) && r.errorHandler !== null && probe.boundaries.get(r)?.handler === r.errorHandler) broken.push(`a boundary handler left on ${r.id}`);
      if (r.settled.length) broken.push(`$settled callbacks left on ${r.id}`);
    }
    return broken;
  } finally {
    globalThis.setTimeout = start;
    globalThis.clearTimeout = stop;
    probe.made = probe.finished = null;
  }
}

describe('$settle scenarios', () => {
  it(`keeps its invariants over ${SEEDS.length} seeded scenarios`, { timeout: 60000 }, async () => {
    /** @type {string[]} */
    const report = [];
    for (const seed of SEEDS) {
      /** @type {string[]} */
      const log = [];
      const broken = await scenario(seed, log);
      if (broken.length > 0) report.push(`seed ${seed}:\n  ${broken.join('\n  ')}\n  scenario:\n    ${log.join('\n    ')}`);
    }
    if (report.length > 0) console.log(report.join('\n\n'));
    assert.deepEqual(report.map(r => r.split('\n')[0]), [], 'the seeds that broke an invariant (their scenarios are printed above)');
  });
});
