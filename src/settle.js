// Waiting for a root to settle, for renders that happen once (ren-html,
// ren-json): the view is built, every task it started completes (a nested
// `<Root>`'s too), and what the completions queued has run.
//
// The model. A settle covers a tree: its root and the live nested roots of
// the direct runtime below it, at any depth (their graphs run here; a
// worker-runtime nested root runs elsewhere and is not covered).
//
// - Boundaries. The settles waiting on one root share one boundary: a record
//   installed as the root's handler by the first of them, holding the
//   handler it replaced (`base`) and the waits of the settles it serves. A
//   settle joins the boundary of each root of its tree and holds it until
//   the whole settle ends, so a failure in any of its roots, at any time
//   before the end, reaches it. It watches each root it joined: a nested
//   root that appears under one while it waits (rendered mid-pass) joins
//   at once, its subtree too. The last wait to leave a boundary restores
//   `base`, if the boundary is still the root's handler. A `$catch` set
//   meanwhile displaces the boundary; a later settle then starts a new one
//   over it.
// - Passes. A pass asks each root of the tree to settle (a `$settled`
//   callback, and a flush). A root's settling resolves only its own part of
//   the pass. When every part is in, the settle ends, unless a root of the
//   tree has a pending task again or a root joined that the pass did not
//   cover: then another pass runs.
// - Failure. One failure for the whole settle: the first failure any of its
//   boundaries meets, the deadline (one timer for the settle), or the
//   disposal of its root. It ends the settle whatever pass is running. A
//   nested root disposed while the settle waits left the view: its part of
//   the pass counts as settled and its boundary is left.
// - Cleanup runs exactly once, at the end, whatever the end: every wait
//   leaves its boundary, every `$settled` callback of the settle leaves its
//   root, the timer stops. One dispose cleanup per root, registered once,
//   serves every settle of that root.
// - Observation. `probe` (module-internal: no package entry exports it)
//   lets test/settle.fuzz.test.js see each settle start and end and read
//   the boundary tables, to check that a settle ends once and leaves
//   nothing behind. It calls nothing unless a test set it.

import { $settled, $flush, $catch, $cleanup } from 'rrx-core';
import { nestedRoots, watchNested } from './nested.js';

/**
 * @typedef {(error: any) => void} Handler
 * @typedef {{ root: import('rrx-core').Graph, base: Handler | null, handler: Handler, waits: Set<Wait> }} Boundary
 */

/** A settle over a tree of roots. */
class Settle {
  /** @param {import('rrx-core').Graph} root */
  constructor(root) {
    this.root = root;
    /** @type {(value?: any) => void} */
    this.resolve = () => {};
    /** @type {(error: any) => void} */
    this.reject = () => {};
    /** Its wait on each root it joined. @type {Map<import('rrx-core').Graph, Wait>} */
    this.waits = new Map();
    /** Parts of the current pass still out, and the pass's number. */
    this.out = 0;
    this.pass = 0;
    this.done = false;
    /** @type {any} */
    this.timer = null;
    probe.made?.(this);
  }
}

/** A settle's wait on one root of its tree: its place in that root's boundary, and its part of the pass. */
class Wait {
  /** @param {Settle} settle @param {Boundary} b */
  constructor(settle, b) {
    this.settle = settle;
    this.b = b;
    /** Whether its part of the current pass is still out, and the last pass it took part in. */
    this.part = false;
    this.pass = 0;
    this.settled = () => part(this);
    // A nested root that appears under this one while the settle waits joins it.
    this.unwatch = watchNested(b.root, child => {
      if (!settle.done) for (const r of tree(child, [])) join(settle, r);
    });
  }
}

/** The boundary a root's newest settles share. @type {WeakMap<import('rrx-core').Graph, Boundary>} */
const boundaries = new WeakMap();

/** A root's boundaries with a wait in them, once its dispose cleanup is registered. @type {WeakMap<import('rrx-core').Graph, Set<Boundary>>} */
const live = new WeakMap();

/**
 * Test-only observation (see the contract above): `made(settle)` and
 * `finished(settle, ok, error)` when set, and the boundary tables.
 * @type {{ made: ((s: Settle) => void) | null, finished: ((s: Settle, ok: boolean, error: any) => void) | null, boundaries: typeof boundaries, live: typeof live }}
 */
export const probe = { made: null, finished: null, boundaries, live };

/** The longest delay a timer takes; a longer one would fire at once. */
const LONGEST = 2 ** 31 - 1;

/**
 * Resolves once no task of `root` or of its live nested roots (direct
 * runtime, at any depth) is pending and nothing is queued. Rejects with a
 * failure raised in any of them while it waits, when the root is disposed,
 * or after `timeout` milliseconds (10,000 by default; 0, or more than
 * 2**31-1 such as Infinity, waits forever).
 *
 * While it waits it is the error boundary of each root of the tree, from
 * when it meets the root until it ends. A failure no scope handled goes
 * first to the handler the root had (`$catch`); if that handler handles
 * it, the wait goes on, otherwise the settle rejects with what it left
 * unhandled. Overlapping settles with no `$catch` set between them share a
 * root's boundary, and such a failure rejects them all. When the last one
 * ends, the root's handler is again the one it had before the first.
 *
 * A `$catch` set while settles wait ends their boundary role on that root:
 * that handler stays and takes the failures from then on, and one it leaves
 * unhandled is raised by the flush that met it. A settle started after the
 * `$catch` has a boundary of its own, over that handler.
 *
 * It settles in passes: each root of the tree settles its part, and a pass
 * repeats while a root has a pending task again or a nested root appeared
 * that the pass did not cover. A nested root disposed while it waits no
 * longer counts.
 *
 * A failure after it is done is never swallowed: it reaches the handler then
 * current or, left unhandled, is raised by the flush that met it, as any
 * flush raises. When that flush is the one `$settle` starts, `$settle` throws
 * it. Called inside a flush, the flush it starts runs in a microtask, where
 * such a failure is uncaught, as any auto flush's.
 *
 * Called inside a flush (from a `$settled` callback, say), it checks once
 * in a microtask after that flush ends, and flushes the root if the wait is
 * still live and no task is pending.
 *
 * A root disposed before the call or while it waits rejects at once with a
 * "disposed" error. Whatever the end (settled, failed, disposed or the
 * deadline), no timer and no handler of it is left behind; a root keeps
 * one dispose cleanup for all its settles.
 *
 * It needs the roots to flush automatically (`$auto`, the default of a Root
 * mounted from options): a root that only flushes by hand runs no completion
 * and never settles while a task is pending. With nothing pending it resolves.
 * @param {import('rrx-core').Graph} root
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<void>}
 */
export function $settle(root, options = {}) {
  const timeout = options.timeout ?? 10000;
  if (root.closed || root.closing) return Promise.reject(disposed(root));
  const s = new Settle(root);
  const promise = new Promise((resolve, reject) => {
    s.resolve = resolve;
    s.reject = reject;
  });
  if (timeout > 0 && timeout <= LONGEST)
    // timer: deadline, rejects a tree that never settles.
    s.timer = setTimeout(() => fail(s, new Error(`REN: the root "${root.id}" did not settle within ${timeout} ms`)), timeout);
  pass(s);
  return promise;
}

/** The live roots of a settle's tree: its root, then its nested roots, depth first. @param {import('rrx-core').Graph} root @param {import('rrx-core').Graph[]} out */
function tree(root, out) {
  // A root being disposed is leaving: joining it again would leave its boundary behind.
  if (root.closed || root.closing) return out;
  out.push(root);
  for (const kid of nestedRoots(root)) tree(kid, out);
  return out;
}

/** Runs one pass: each root of the tree settles its part. @param {Settle} s */
function pass(s) {
  const roots = tree(s.root, []);
  const number = ++s.pass;
  /** @type {Wait[]} */
  const parts = [];
  for (const r of roots) {
    const wait = join(s, r);
    wait.part = true;
    wait.pass = number;
    parts.push(wait);
  }
  s.out = parts.length;
  for (let i = 0; i < parts.length && !s.done; i++) {
    const wait = parts[i];
    const r = wait.b.root;
    if (!wait.part) continue;
    $settled(r, wait.settled);
    if (!r.flushing) flush(s, r);
    else
      // Inside a flush, its settled callbacks may already have run (a settle
      // started from one of them): then this part waits for a flush that
      // nothing may start. One check once the flush has ended starts it.
      queueMicrotask(() => {
        if (!s.done && wait.part && !r.flushing && !r.closed && r.loading === 0) flush(s, r);
      });
  }
}

/** Flushes a root for a settle. @param {Settle} s @param {import('rrx-core').Graph} r */
function flush(s, r) {
  try {
    $flush(r);
  } catch (error) {
    // Raised while it waits, the failure is this settle's; after, the caller's.
    if (!fail(s, error)) throw error;
  }
}

/** A root's part of the pass is in; the last one ends the pass. @param {Wait} wait */
function part(wait) {
  if (!wait.part) return;
  wait.part = false;
  arrive(wait.settle);
}

/** One part of the pass is in; the last one ends the pass, and the settle unless another pass is due. @param {Settle} s */
function arrive(s) {
  if (--s.out > 0 || s.done) return;
  // Its root going (the last part in may be a nested root it took down) fails it.
  if (s.root.closing) return void fail(s, disposed(s.root));
  // Another pass while a root of the tree is pending again, or one joined that this pass did not cover.
  const roots = tree(s.root, []);
  for (const r of roots) if (r.loading > 0 || s.waits.get(r)?.pass !== s.pass) return pass(s);
  finish(s, true);
}

/** The settle's wait on `root`, joining the root's boundary the first time. @param {Settle} s @param {import('rrx-core').Graph} root */
function join(s, root) {
  let wait = s.waits.get(root);
  if (wait === undefined) {
    const b = boundary(root);
    wait = new Wait(s, b);
    b.waits.add(wait);
    s.waits.set(root, wait);
  }
  return wait;
}

/** The boundary a new wait joins: the root's current one, or a new one over its handler. @param {import('rrx-core').Graph} root */
function boundary(root) {
  const current = boundaries.get(root);
  if (current !== undefined && root.errorHandler === current.handler) return current;
  /** @type {Boundary} */
  const b = { root, base: root.errorHandler, handler: () => {}, waits: new Set() };
  b.handler = error => {
    if (b.waits.size > 0) {
      if (typeof b.base === 'function')
        try {
          b.base(error);
          return;
        } catch (next) {
          error = next;
        }
      for (const wait of [...b.waits]) fail(wait.settle, error);
      return;
    }
    // Ended but kept by someone who read `errorHandler`: pass through.
    if (typeof b.base === 'function') b.base(error);
    else throw error;
  };
  let set = live.get(root);
  if (set === undefined) {
    const waiting = (set = new Set());
    live.set(root, set);
    $cleanup(root.home, () => {
      for (const b of [...waiting]) for (const wait of [...b.waits]) gone(wait);
    });
  }
  set.add(b);
  boundaries.set(root, b);
  $catch(root, b.handler);
  return b;
}

/** A root of a settle's tree is disposed: its own root fails the settle; a nested one leaves it. @param {Wait} wait */
function gone(wait) {
  const s = wait.settle;
  const root = wait.b.root;
  if (root === s.root) {
    fail(s, disposed(root));
    return;
  }
  if (s.done) return;
  const out = wait.part;
  leave(wait);
  s.waits.delete(root);
  if (out) arrive(s);
}

/** Ends a settle with a failure; false when it had already ended. @param {Settle} s @param {any} error */
function fail(s, error) {
  if (s.done) return false;
  finish(s, false, error);
  return true;
}

/** Ends a settle, once: every wait leaves its boundary, the timer stops. @param {Settle} s @param {boolean} ok @param {any} [error] */
function finish(s, ok, error) {
  probe.finished?.(s, ok, error);
  s.done = true;
  if (s.timer !== null) clearTimeout(s.timer);
  for (const wait of s.waits.values()) leave(wait);
  s.waits.clear();
  if (ok) s.resolve();
  else s.reject(error);
}

/** A wait leaves its boundary (and its root's `$settled` list); the last puts the root's handler back. @param {Wait} wait */
function leave(wait) {
  const b = wait.b;
  wait.part = false;
  wait.unwatch();
  const at = b.root.settled.indexOf(wait.settled);
  if (at !== -1) b.root.settled.splice(at, 1);
  if (!b.waits.delete(wait) || b.waits.size > 0) return;
  if (b.root.errorHandler === b.handler) $catch(b.root, b.base);
  live.get(b.root)?.delete(b);
  if (boundaries.get(b.root) === b) boundaries.delete(b.root);
}

/** @param {import('rrx-core').Graph} root */
function disposed(root) {
  return new Error(`REN: the root "${root.id}" was disposed before it settled`);
}
