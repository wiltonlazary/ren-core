// Background disposal: when a list clears or a content swap drops a large
// subtree, ren-core detaches the host nodes at once and retires the scopes (rrx-core
// `$retire`: inert at once, one mark per scope); this module is the root's
// Sweeper, which frees the retired work (rrx-core `$sweep`) in slices paced so that
// they never cost a frame:
//
// - `idle` (a main thread with requestIdleCallback): slices in idle periods,
//   each at most the budget and what the idle deadline leaves; the budget
//   halves after a late frame (seen by a requestAnimationFrame probe that
//   runs only while work remains) and grows back by an eighth per on-time
//   frame; pending input (navigator.scheduling.isInputPending) ends the
//   callback. A starved idle queue still gets a 1 ms slice every 250 ms.
// - `frame` (requestAnimationFrame without idle callbacks): one slice right
//   after each frame's work, in a task posted from the frame, with the same
//   budget rule.
// - `task` (a worker, or no frames): slices of the budget in macrotasks, so
//   messages and events run between them.
//
// Each slice ends with a `$flush`, so what a cleanup changed (a host listener
// removed in worker mode, a write) is published. `swept(info)` reports each
// drain: slices, the longest slice and the time from the first retire to the
// last freeing.

import { $sweep, $sweeper, $flush } from 'rrx-core';

/** The rows a list clear or replace, or a content swap, must drop to retire instead of stopping. */
export const RETIRE = 1000;
/** The largest slice, ms. */
const MAX = 4;
/** The smallest slice after late frames, ms. */
const MIN = 0.5;
/** A starved idle queue still sweeps this often, ms. */
const STARVED = 250;

/**
 * A drain's report.
 * @typedef {object} Drain
 * @property {number} slices `$sweep` calls.
 * @property {number} longest The longest slice, ms (the `$sweep` call and its `$flush`).
 * @property {number} busy The time spent sweeping, ms.
 * @property {number} time From the first retire to the last freeing, ms.
 * @property {number} late Late frames seen while draining.
 */

/**
 * @typedef {'idle' | 'frame' | 'task'} Mode
 */

/** A root's disposal state: its threshold, large lists, eager closers and sweep pacing. */
export class Pace {
  /** @param {import('rrx-core/core').Graph} R @param {number} threshold @param {Mode | false} mode @param {((drain: Drain) => void) | null} swept */
  constructor(R, threshold, mode, swept) {
    this.R = R;
    /** Rows from which a drop retires; Infinity never retires. */
    this.threshold = threshold;
    /**
     * Lists holding at least `threshold` rows: a content swap that drops one
     * of them retires. @type {Set<{ scope: import('rrx-core/core').Owner }> | null}
     */
    this.big = null;
    /**
     * What must close when its owner is retired, not when it is swept: a
     * portal's nodes in another container, a nested root. @type {Set<Eager> | null}
     */
    this.eager = null;
    this.mode = mode;
    this.swept = swept;
    this.budget = MAX;
    this.scheduled = false;
    this.closed = false;
    /** @type {any} */
    this.timer = null;
    /** @type {any} */
    this.frame = 0;
    this.last = 0;
    this.period = 1000 / 60;
    // The current drain.
    this.start = 0;
    this.slices = 0;
    this.longest = 0;
    this.busy = 0;
    this.late = 0;
    const g = /** @type {any} */ (globalThis);
    /** @type {any} */
    this.input = g.navigator?.scheduling?.isInputPending !== undefined ? g.navigator.scheduling : null;
    this.slice = this.slice.bind(this);
    this.idle = this.idle.bind(this);
    this.tick = this.tick.bind(this);
    this.posted = this.posted.bind(this);
    /** Whether this pacing installed the root's sweeper, and the one it replaced (undefined: none ever set). */
    this.installed = mode !== false;
    /** @type {any} */
    this.previous = R.sweeper;
    if (this.installed) $sweeper(R, () => this.schedule());
  }

  /** Retired work appeared: start a drain. */
  schedule() {
    if (this.closed || this.scheduled || this.R.closed) return;
    this.scheduled = true;
    if (this.start === 0) {
      this.start = performance.now();
      this.slices = this.longest = this.busy = this.late = 0;
      this.last = 0;
    }
    const g = /** @type {any} */ (globalThis);
    if (this.mode === 'idle') {
      // timer: feature, sweeping in idle periods is the pacing.
      this.timer = g.requestIdleCallback(this.idle, { timeout: STARVED });
      if (this.frame === 0) this.frame = g.requestAnimationFrame(this.tick); // timer: feature, frames measure lateness
    } else if (this.mode === 'frame') {
      this.frame = g.requestAnimationFrame(this.tick); // timer: feature, frame mode: a slice a frame
    } else this.timer = setTimeout(this.slice, 0); // timer: fallback, task mode: no frames to pace by
  }

  /** A frame: note lateness; in frame mode, post the slice after this frame's work. @param {number} time */
  tick(time) {
    this.frame = 0;
    if (this.closed) return;
    const gap = this.last === 0 ? 0 : time - this.last;
    this.last = time;
    if (gap > 0) {
      if (gap < this.period) this.period = Math.max(4, gap);
      if (gap > 1.5 * this.period) {
        this.late++;
        this.budget = Math.max(MIN, this.budget / 2);
      } else this.budget = Math.min(MAX, this.budget + MAX / 8);
    }
    const g = /** @type {any} */ (globalThis);
    // timer: fallback, frame mode (no idle callbacks): the slice in a task after the frame.
    if (this.mode === 'frame') this.timer = setTimeout(this.posted, 0);
    else if (this.scheduled) this.frame = g.requestAnimationFrame(this.tick); // timer: feature, frames pace the idle sweep
  }

  /** Frame mode: the slice after a frame. */
  posted() {
    this.timer = null;
    this.run(this.budget);
  }

  /** Idle mode: sweep while the idle period lasts and no input waits. @param {{ timeRemaining: () => number, didTimeout: boolean }} deadline */
  idle(deadline) {
    this.timer = null;
    if (this.closed) return;
    if (deadline.didTimeout) return this.run(Math.min(1, this.budget));
    let left = 1;
    try {
      for (;;) {
        const time = deadline.timeRemaining();
        if (time < MIN || (this.input !== null && this.input.isInputPending())) break;
        if ((left = this.step(Math.min(this.budget, time))) === 0) break;
      }
    } finally {
      this.next(left);
    }
  }

  /** Task mode: one slice. */
  slice() {
    this.timer = null;
    this.run(this.budget);
  }

  /**
   * One slice, then the next one scheduled or the drain reported. A failure
   * no boundary handled is raised after the next slice is scheduled.
   * @param {number} budget
   */
  run(budget) {
    if (this.closed) return;
    let left = 1;
    try {
      left = this.step(budget);
    } finally {
      this.next(left);
    }
  }

  /** @param {number} left */
  next(left) {
    if (this.closed) return;
    if (left === 0) return this.done();
    this.scheduled = false;
    this.schedule();
  }

  /** Sweeps for `budget` ms and publishes; returns the retired scopes left. @param {number} budget */
  step(budget) {
    const R = this.R;
    if (R.closed) return 0;
    const t = performance.now();
    let left = 0;
    try {
      left = $sweep(R, budget);
    } finally {
      // What the cleanups changed shows (and crosses, in worker mode).
      if (!R.closed && !R.flushing) $flush(R);
      const spent = performance.now() - t;
      this.slices++;
      this.busy += spent;
      if (spent > this.longest) this.longest = spent;
    }
    return left;
  }

  /** The drain is over. */
  done() {
    this.scheduled = false;
    const g = /** @type {any} */ (globalThis);
    if (this.frame !== 0) {
      g.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const time = performance.now() - this.start;
    this.start = 0;
    const swept = this.swept;
    if (swept !== null) swept({ slices: this.slices, longest: this.longest, busy: this.busy, time, late: this.late });
  }

  /** Stops pacing (the root is disposed; rrx-core's `$dispose` finishes the teardown at once). */
  close() {
    this.closed = true;
    const g = /** @type {any} */ (globalThis);
    if (this.timer !== null) {
      if (this.mode === 'idle') g.cancelIdleCallback(this.timer);
      else clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.frame !== 0) {
      g.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    // The root's sweeper goes back to what it was, and only when this pacing replaced it.
    if (this.installed && !this.R.closed) $sweeper(this.R, this.previous);
  }
}

/** Something that closes when its owner retires: a portal, a nested root. */
export class Eager {
  /** @param {import('rrx-core/core').Owner} owner @param {() => void} close */
  constructor(owner, close) {
    this.owner = owner;
    this.close = close;
  }
}

/** The pacing mode this environment supports best. @returns {Mode} */
export function modeOf() {
  const g = /** @type {any} */ (globalThis);
  if (typeof g.requestIdleCallback === 'function' && typeof g.requestAnimationFrame === 'function') return 'idle';
  if (typeof g.requestAnimationFrame === 'function' && typeof g.document === 'object') return 'frame';
  return 'task';
}
