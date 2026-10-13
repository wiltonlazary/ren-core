// Direct and worker mode hear the same events. One script of main-thread
// dispatches (each reaches its listeners in order with one event object, as a
// renderer's bubbling does, until a handler stops it) runs on the in-memory
// Tree host in direct mode and in worker mode, and the handler logs must match:
// exactly without coalescing; with it, exactly the direct log of the burst
// with the superseded dispatches left out (test/fixtures/coalesce.js models
// which), and a burst of moves queues one dispatch however long it is.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root, $dispose, $keys, $scrolls } from 'ren-core';
import { mount } from 'ren-core/host';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { Tree, find } from './fixtures/tree.js';
import { closeAfter } from './fixtures/after.js';
import { coalesced } from './fixtures/coalesce.js';

/**
 * One entry of a handler log: who heard what. A handler stops the dispatch
 * when the event's key names it (`stop:<tag>`).
 * @param {any[]} log @param {string} tag @param {string} name
 */
const handler = (log, tag, name) => (/** @type {any} */ e) => {
  const mods = `${e.shiftKey ? 'S' : ''}${e.ctrlKey ? 'C' : ''}${e.altKey ? 'A' : ''}${e.metaKey ? 'M' : ''}`;
  log.push(`${tag} ${name} x=${e.x ?? 0} y=${e.y ?? 0} dy=${e.deltaY ?? 0} b=${e.button ?? -1} ${mods} ${e.key ?? ''}`);
  if (e.key === `stop:${tag}`) e.stopPropagation();
};

/** @param {any[]} log */
const App = log => () => {
  $keys(handler(log, 'root', 'keys'));
  $scrolls(handler(log, 'root', 'scrolls'));
  /** @param {string} tag */
  const on = tag => ({
    onClick: handler(log, tag, 'click'),
    onPointerMove: handler(log, tag, 'pointermove'),
    onWheel: handler(log, tag, 'wheel'),
    onFocus: handler(log, tag, 'focus'),
    onBlur: handler(log, tag, 'blur'),
    onKey: handler(log, tag, 'key'),
    onScroll: handler(log, tag, 'scroll'),
  });
  return (
    <outer {...on('outer')}>
      <inner {...on('inner')} />
    </outer>
  );
};

const CLICK = [['inner', 'click'], ['outer', 'click']];
const MOVE = [['inner', 'pointermove'], ['outer', 'pointermove']];
const KEY = [['inner', 'key'], ['outer', 'key'], ['root', 'keys']];
// A document's capture-phase listener ($scrolls) hears a scroll before its target.
const SCROLL = [['root', 'scrolls'], ['inner', 'scroll']];
/** One frozen object shared by unrelated dispatches, as a renderer's empty event may be. */
const SHARED = Object.freeze({ key: 'stop:inner', stopPropagation() {} });

/**
 * The script: bursts (the worker's messages) of dispatches, each `[path,
 * event init]`, or `{ rewind }`: the worker's dispatch counter goes back, as
 * if it had wrapped (direct mode has no counter).
 * @type {any[][]}
 */
const SCRIPT = [
  // Clicks bubble; a stop at each level.
  [[CLICK, {}], [CLICK, { key: 'stop:inner' }], [CLICK, { key: 'stop:outer' }], [CLICK, { shiftKey: true, button: 2 }]],
  // Focus and blur (no bubbling) with a stop in the handler: later ones are heard.
  [[[['inner', 'focus']], { key: 'stop:inner' }], [[['inner', 'blur']], { key: 'stop:inner' }], [[['outer', 'focus']], {}], [[['outer', 'blur']], {}]],
  [[[['inner', 'focus']], SHARED], [[['inner', 'blur']], SHARED], [[['inner', 'focus']], SHARED]],
  [[[['inner', 'focus']], {}]],
  // Keys: the focused item and its ancestors, then the root's $keys.
  [[KEY, { key: 'a', ctrlKey: true }], [KEY, { key: 'stop:inner' }], [KEY, { key: 'stop:outer', altKey: true, metaKey: true }], [KEY, { key: 'b' }]],
  // Scrolls: $scrolls first; the item's stop cannot reach it.
  [[SCROLL, { key: 'stop:inner' }], [SCROLL, {}]],
  [[SCROLL, { key: 'stop:root' }]],
  // Moves: the parent first, then a move its child stops, in one burst.
  [[[['outer', 'pointermove']], { x: 1 }], [MOVE, { x: 2, key: 'stop:inner' }]],
  [[MOVE, { x: 3 }], [MOVE, { x: 4, key: 'stop:inner' }]],
  [[MOVE, { x: 5, key: 'stop:inner' }], [CLICK, {}], [MOVE, { x: 6 }]],
  // A dispatch stopped at its first listener, then another reaching that
  // listener: the stopped dispatch's later listener still hears nothing.
  [[SCROLL, { key: 'stop:root' }], [[['root', 'scrolls'], ['outer', 'scroll']], {}]],
  [[MOVE, { x: 10, key: 'stop:inner' }], [[['inner', 'pointermove']], { x: 11 }]],
  // Wheels add up their deltas only with the same modifier keys and button.
  [[[['outer', 'wheel']], { deltaY: 100 }], [[['outer', 'wheel']], { deltaY: 3, ctrlKey: true }], [[['outer', 'wheel']], { deltaY: 4, ctrlKey: true, button: 1 }]],
  // The latest move's modifiers and button win.
  [[[['outer', 'pointermove']], { x: 1, y: 1, shiftKey: false, button: 0 }], [[['outer', 'pointermove']], { x: 2, y: 3, shiftKey: true, ctrlKey: true, button: 1 }]],
  [[MOVE, { x: 7, altKey: true, button: 0 }], [MOVE, { x: 8, metaKey: true, button: 2, key: 'stop:inner' }], [MOVE, { x: 9, shiftKey: true }]],
  // A stopped dispatch, another, then the counter gives the stopped one's number again.
  [[CLICK, { key: 'stop:inner' }], [CLICK, { key: 'plain' }], { rewind: 2 }, [[['outer', 'click']], { key: 'again' }]],
  // Many dispatches in one burst, stops varying.
  Array.from({ length: 300 }, (_, n) => [n % 5 === 0 ? KEY : CLICK, { key: ['stop:inner', 'stop:outer', 'none'][n % 3], x: n }]),
];

/** Runs one dispatch: its listeners in order, one event, until a handler stops it. @param {any} box @param {any[]} path @param {any} init */
function fire(box, path, init) {
  let stopped = false;
  const event = Object.isFrozen(init) ? init : { ...init, stopPropagation: () => void (stopped = true) };
  for (const [tag, name] of path) {
    if (stopped) break;
    const node = tag === 'root' ? box : find(box, tag)[0];
    node.on[name]?.(event);
  }
}

/** A burst of the script as the coalescing model's steps. @param {any[]} burst */
const stepsOf = burst => burst.map(step => (Array.isArray(step) ? { path: step[0], init: step[1], frozen: Object.isFrozen(step[1]), split: -1 } : { flush: true }));

/**
 * Direct mode's log, by burst, of dispatches given record by record (each
 * record with its own event values; a stop skips the dispatch's later ones).
 * @param {{ records: { at: string[], init: any }[], frozen: boolean }[][]} bursts
 */
function replay(bursts) {
  const H = Tree();
  const box = H.element('box', null);
  const R = Root('app');
  /** @type {string[]} */
  const log = [];
  const dispose = mount(H, App(log), box, { root: R });
  const out = [];
  for (const burst of bursts) {
    for (const dispatch of burst) {
      let stopped = false;
      for (const { at, init } of dispatch.records) {
        if (stopped) break;
        const event = dispatch.frozen ? Object.freeze({ ...init, stopPropagation() {} }) : { ...init, stopPropagation: () => void (stopped = true) };
        const node = at[0] === 'root' ? box : find(box, at[0])[0];
        node.on[at[1]]?.(event);
      }
    }
    out.push(log.splice(0));
  }
  dispose();
  $dispose(R);
  return out;
}

/** The direct mode's log, by burst. */
function direct() {
  const H = Tree();
  const box = H.element('box', null);
  const R = Root('app');
  /** @type {string[]} */
  const log = [];
  const dispose = mount(H, App(log), box, { root: R });
  const bursts = [];
  for (const burst of SCRIPT) {
    for (const step of burst) if (Array.isArray(step)) fire(box, step[0], step[1]);
    bursts.push(log.splice(0));
  }
  dispose();
  $dispose(R);
  return bursts;
}

/** The worker mode's log, by burst. @param {any} t @param {boolean} coalesce */
async function worker(t, coalesce) {
  const H = Tree();
  const box = H.element('box', null);
  const W = Root('app');
  /** @type {string[]} */
  const log = [];
  const { port1, port2 } = new MessageChannel();
  const connection = connect(port2, H, box, { schedule: 'now', coalesce });
  const session = serve(App(log), { port: port1, root: W });
  closeAfter(t, () => {
    connection.close();
    session.close();
    port1.close();
    port2.close();
    $dispose(W);
  });
  await connection.idle();
  const bursts = [];
  for (const burst of SCRIPT) {
    for (const step of burst) {
      if (Array.isArray(step)) fire(box, step[0], step[1]);
      else {
        // Sent first: the records before the rewind keep their numbers.
        connection.flushEvents();
        connection.dispatch -= step.rewind;
      }
    }
    await connection.idle();
    bursts.push(log.splice(0));
  }
  return bursts;
}

describe('ren-core event parity', () => {
  it('hears the same events in worker mode as in direct mode, without coalescing', { timeout: 30000 }, async t => {
    const expected = direct();
    const heard = await worker(t, false);
    for (let b = 0; b < SCRIPT.length; b++) assert.deepEqual(heard[b], expected[b], `burst ${b}`);
  });

  it('hears the direct events without the superseded dispatches, with coalescing', { timeout: 30000 }, async t => {
    const expected = replay(SCRIPT.map(burst => coalesced(stepsOf(burst))));
    const heard = await worker(t, true);
    for (let b = 0; b < SCRIPT.length; b++) assert.deepEqual(heard[b], expected[b], `burst ${b}`);
    // Direct mode hears inner 3, outer 3, inner 4 there: the stopped latest move replaces the whole earlier one.
    const moves = SCRIPT.findIndex(burst => burst.length === 2 && Array.isArray(burst[1]) && burst[1][1].x === 4);
    assert.deepEqual(heard[moves], ['inner pointermove x=4 y=0 dy=0 b=-1  stop:inner']);
  });
});

/** A three-deep chain of move listeners that stop when the event's key names them. @param {string[]} log */
const Chain = log => () => {
  /** @param {string} tag */
  const h = tag => (/** @type {any} */ e) => {
    log.push(`${tag} x=${e.x}`);
    if (e.key === tag) e.stopPropagation();
  };
  return (
    <a onPointerMove={h('a')}>
      <b onPointerMove={h('b')}>
        <c onPointerMove={h('c')} />
      </b>
    </a>
  );
};

/**
 * Moves `steps` (`{ x, key, from, split }`) through the chain, bubbling from
 * `from` (c), in one burst (a `split` sends the records before that listener
 * first); returns the worker's log and connection totals.
 * @param {any} t @param {any[]} steps @param {boolean} coalesce
 */
async function chain(t, steps, coalesce) {
  const H = Tree();
  const box = H.element('box', null);
  const W = Root('app');
  /** @type {string[]} */
  const log = [];
  const { port1, port2 } = new MessageChannel();
  const connection = connect(port2, H, box, { schedule: 'now', coalesce });
  const session = serve(Chain(log), { port: port1, root: W });
  closeAfter(t, () => {
    connection.close();
    session.close();
    port1.close();
    port2.close();
    $dispose(W);
  });
  await connection.idle();
  const events = connection.totals.events;
  for (const step of steps) {
    const event = { x: step.x, key: step.key, stopPropagation() {} };
    const path = ['c', 'b', 'a'].slice(['c', 'b', 'a'].indexOf(step.from ?? 'c'));
    for (let i = 0; i < path.length; i++) {
      if (i === step.split) connection.flushEvents();
      find(box, path[i])[0].on.pointermove(event);
    }
  }
  await connection.idle();
  return { log, records: connection.totals.events - events, merged: connection.totals.merged };
}

describe('ren-core worker coalescing', () => {
  it('drops a superseded dispatch whole, so a stop of the latest is exact', { timeout: 30000 }, async t => {
    // Direct mode hears c 1, b 1, a 1, c 2 (c stops the second).
    assert.deepEqual((await chain(t, [{ x: 1, key: 'none' }, { x: 2, key: 'c' }], false)).log, ['c x=1', 'b x=1', 'a x=1', 'c x=2']);
    assert.deepEqual((await chain(t, [{ x: 1, key: 'none' }, { x: 2, key: 'c' }], true)).log, ['c x=2']);
    assert.deepEqual((await chain(t, [{ x: 1, key: 'c' }, { x: 2, key: 'none' }], true)).log, ['c x=2', 'b x=2', 'a x=2']);
    assert.deepEqual((await chain(t, [{ x: 1, key: 'none' }, { x: 2, key: 'b' }, { x: 3, key: 'none' }], true)).log, ['c x=3', 'b x=3', 'a x=3']);
    // Different paths stay apart.
    assert.deepEqual((await chain(t, [{ x: 1, key: 'none' }, { x: 2, key: 'none', from: 'b' }], true)).log, ['c x=1', 'b x=1', 'a x=1', 'b x=2', 'a x=2']);
    // A dispatch split across messages is delivered whole: its rest is not replaced by a later move with the same rest.
    assert.deepEqual((await chain(t, [{ x: 1, key: 'none', split: 1 }, { x: 2, key: 'none', from: 'b' }], true)).log, ['c x=1', 'b x=1', 'a x=1', 'b x=2', 'a x=2']);
  });

  it('queues one dispatch for a burst of moves, however long', { timeout: 30000 }, async t => {
    const steps = Array.from({ length: 1000 }, (_, x) => ({ x, key: 'none' }));
    const run = await chain(t, steps, true);
    assert.equal(run.records, 3, 'the burst carries one record per listener');
    assert.equal(run.merged, 3 * 999);
    assert.deepEqual(run.log, ['c x=999', 'b x=999', 'a x=999']);
  });

  it('queues one dispatch for a burst of moves through six listeners', { timeout: 30000 }, async t => {
    const H = Tree();
    const box = H.element('box', null);
    const W = Root('app');
    let heard = 0;
    const listen = () => void heard++;
    const App = () => (
      <n0 onPointerMove={listen}>
        <n1 onPointerMove={listen}>
          <n2 onPointerMove={listen}>
            <n3 onPointerMove={listen}>
              <n4 onPointerMove={listen}>
                <n5 onPointerMove={listen} />
              </n4>
            </n3>
          </n2>
        </n1>
      </n0>
    );
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, H, box, { schedule: 'now', coalesce: true });
    const session = serve(App, { port: port1, root: W });
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
      $dispose(W);
    });
    await connection.idle();
    const path = ['n5', 'n4', 'n3', 'n2', 'n1', 'n0'].map(tag => find(box, tag)[0]);
    const events = connection.totals.events;
    for (let k = 0; k < 1000; k++) {
      const event = { x: k, y: k };
      for (const node of path) node.on.pointermove(event);
    }
    await connection.idle();
    assert.equal(connection.totals.events - events, 6, 'D = 6, K = 1000: six records');
    assert.equal(heard, 6);
  });
});
